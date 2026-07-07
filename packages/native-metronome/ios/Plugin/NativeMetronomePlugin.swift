import Foundation
import Capacitor
import AVFoundation

/// Native metronome that keeps clicking when the WKWebView is backgrounded
/// or the screen is locked. Web Audio suspends the moment the app leaves
/// the foreground, so we hand the click over to AVAudioEngine and drive
/// it from a DispatchSourceTimer on a dedicated high-priority queue.
///
/// AVAudioSession is configured to `.playback` at app launch (see
/// `AppDelegate.swift`) and `UIBackgroundModes` includes `audio`, so
/// AVAudioEngine keeps producing sound in the background.
@objc(NativeMetronomePlugin)
public class NativeMetronomePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMetronomePlugin"
    public let jsName = "NativeMetronome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateTempo", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - Audio graph

    private let engine = AVAudioEngine()
    private let accentPlayer = AVAudioPlayerNode()
    private let normalPlayer = AVAudioPlayerNode()
    private var accentBuffer: AVAudioPCMBuffer?
    private var normalBuffer: AVAudioPCMBuffer?
    private var audioLoaded = false

    // MARK: - Timer

    /// Dedicated serial queue at userInteractive QoS. The main queue can be
    /// throttled behind other work; a private queue with the highest QoS
    /// keeps the beat jitter to a minimum.
    private let timerQueue = DispatchQueue(
        label: "app.clickkeep.native-metronome.timer",
        qos: .userInteractive
    )
    private var timer: DispatchSourceTimer?

    // MARK: - Scheduling state (mutated only on `timerQueue` after start)

    private var bpm: Double = 120
    private var beatsPerBar: Int = 4
    private var accentPattern: [String]? = nil
    private var beatIndex: Int = 0

    // Reentrancy guard for start/stop against the timer callback.
    private let stateLock = NSLock()

    // MARK: - Plugin methods

    @objc public func start(_ call: CAPPluginCall) {
        guard let bpmValue = call.getDouble("bpm") else {
            call.reject("start requires a numeric 'bpm'")
            return
        }
        let beats = call.getInt("beatsPerBar") ?? 4
        let pattern = call.getArray("accentPattern", String.self)
        timerQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                try self.beginScheduling(bpm: bpmValue, beatsPerBar: beats, accentPattern: pattern)
                call.resolve()
            } catch {
                NSLog("ClickKeep native metronome: start failed: \(error)")
                call.reject("start failed: \(error.localizedDescription)")
            }
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        timerQueue.async { [weak self] in
            self?.endScheduling()
            call.resolve()
        }
    }

    @objc public func updateTempo(_ call: CAPPluginCall) {
        guard let bpmValue = call.getDouble("bpm") else {
            call.reject("updateTempo requires a numeric 'bpm'")
            return
        }
        let beats = call.getInt("beatsPerBar") ?? 4
        let pattern = call.getArray("accentPattern", String.self)
        timerQueue.async { [weak self] in
            guard let self = self else { return }
            // MVP: full restart. The DispatchSourceTimer fires again after
            // `restartTimer` so the caller hears a fresh tick within one
            // period of the new tempo — no perceptible pause.
            do {
                try self.beginScheduling(bpm: bpmValue, beatsPerBar: beats, accentPattern: pattern)
                call.resolve()
            } catch {
                NSLog("ClickKeep native metronome: updateTempo failed: \(error)")
                call.reject("updateTempo failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Internals

    private func beginScheduling(bpm: Double, beatsPerBar: Int, accentPattern: [String]?) throws {
        stateLock.lock()
        defer { stateLock.unlock() }

        let clampedBpm = max(30.0, min(300.0, bpm))
        let clampedBeats = max(1, min(16, beatsPerBar))

        try ensureAudioReady()

        self.bpm = clampedBpm
        self.beatsPerBar = clampedBeats
        self.accentPattern = accentPattern
        self.beatIndex = 0

        restartTimer()
    }

    private func endScheduling() {
        stateLock.lock()
        defer { stateLock.unlock() }

        timer?.cancel()
        timer = nil

        accentPlayer.stop()
        normalPlayer.stop()
        // Keep the engine around — cheaper to keep it warm for the next
        // start() than to tear it down. Stopping the players stops audio.
    }

    private func ensureAudioReady() throws {
        if audioLoaded {
            if !engine.isRunning {
                try engine.start()
            }
            return
        }

        let bundle = Bundle(for: NativeMetronomePlugin.self)
        guard
            let accentURL = bundle.url(forResource: "accent", withExtension: "wav"),
            let normalURL = bundle.url(forResource: "normal", withExtension: "wav")
        else {
            throw NSError(
                domain: "NativeMetronome",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Missing accent.wav / normal.wav in plugin bundle"]
            )
        }

        let accentFile = try AVAudioFile(forReading: accentURL)
        let normalFile = try AVAudioFile(forReading: normalURL)
        let accentBuf = try loadBuffer(from: accentFile)
        let normalBuf = try loadBuffer(from: normalFile)

        accentBuffer = accentBuf
        normalBuffer = normalBuf

        engine.attach(accentPlayer)
        engine.attach(normalPlayer)
        // Both files were generated with the same format so we can reuse it.
        engine.connect(accentPlayer, to: engine.mainMixerNode, format: accentBuf.format)
        engine.connect(normalPlayer, to: engine.mainMixerNode, format: normalBuf.format)

        engine.prepare()
        try engine.start()
        audioLoaded = true
    }

    private func loadBuffer(from file: AVAudioFile) throws -> AVAudioPCMBuffer {
        let frames = AVAudioFrameCount(file.length)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else {
            throw NSError(
                domain: "NativeMetronome",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Failed to allocate AVAudioPCMBuffer"]
            )
        }
        try file.read(into: buffer)
        return buffer
    }

    /// Cancel any existing timer and start a new one at the current BPM.
    /// Must be called from `timerQueue` (or with `stateLock` held).
    private func restartTimer() {
        timer?.cancel()

        let periodSec = 60.0 / bpm
        let intervalNs = Int(periodSec * 1_000_000_000)

        let source = DispatchSource.makeTimerSource(queue: timerQueue)
        source.schedule(
            deadline: .now(),
            repeating: .nanoseconds(intervalNs),
            leeway: .milliseconds(2)
        )
        source.setEventHandler { [weak self] in
            self?.tick()
        }
        timer = source
        source.resume()
    }

    private func tick() {
        // Read state without the lock — the timer is the only writer of
        // beatIndex and the only reader of these during a tick, so no
        // contention. start()/stop() serialize onto the same queue.
        let state = self.beatStateForCurrentBeat()
        beatIndex &+= 1

        switch state {
        case .accent:
            play(player: accentPlayer, buffer: accentBuffer)
        case .normal:
            play(player: normalPlayer, buffer: normalBuffer)
        case .mute:
            return
        }
    }

    private enum ClickState { case accent, normal, mute }

    private func beatStateForCurrentBeat() -> ClickState {
        if let pattern = accentPattern, !pattern.isEmpty {
            let raw = pattern[((beatIndex % pattern.count) + pattern.count) % pattern.count]
            switch raw {
            case "accent": return .accent
            case "mute": return .mute
            default: return .normal
            }
        }
        return (beatIndex % max(1, beatsPerBar)) == 0 ? .accent : .normal
    }

    private func play(player: AVAudioPlayerNode, buffer: AVAudioPCMBuffer?) {
        guard let buffer = buffer else { return }
        if !engine.isRunning {
            // Engine can get shut down by a route change or interruption; try to bring it back.
            do { try engine.start() } catch {
                NSLog("ClickKeep native metronome: re-start engine failed: \(error)")
                return
            }
        }
        // `.interrupts` cancels any previous scheduled buffer on this player
        // so back-to-back ticks at high tempo don't stack up.
        player.scheduleBuffer(buffer, at: nil, options: [.interrupts], completionHandler: nil)
        if !player.isPlaying {
            player.play()
        }
    }
}
