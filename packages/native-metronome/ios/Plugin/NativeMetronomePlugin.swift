import Foundation
import Capacitor
import AVFoundation

/// Native metronome that keeps clicking when the WKWebView is backgrounded
/// or the screen is locked. Web Audio suspends the moment the app leaves
/// the foreground, so we hand the click over to AVAudioEngine and drive
/// it from a DispatchSourceTimer on a dedicated high-priority queue.
///
/// AVAudioSession is configured to `.playback` with `.mixWithOthers` inside
/// `beginScheduling` — we deliberately claim the session only when the user
/// actually starts the metronome, so a concurrent recording app is not
/// blocked at app launch. Paired with `UIBackgroundModes = ["audio"]` in
/// Info.plist, this keeps AVAudioEngine producing sound in the background.
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
    /// True between `beginScheduling` and `endScheduling`. Used by the
    /// interruption handler to decide whether to auto-resume when audio
    /// becomes available again.
    private var isScheduling: Bool = false

    // MARK: - Plugin lifecycle

    public override func load() {
        // Observe audio-session interruptions (phone calls, Siri, other apps
        // taking exclusive audio). Registered once per plugin lifetime; the
        // handler dispatches onto `timerQueue` for state mutation.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioSessionInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Plugin methods

    @objc public func start(_ call: CAPPluginCall) {
        guard let bpmValue = call.getDouble("bpm") else {
            call.reject("start requires a numeric 'bpm'")
            return
        }
        let beats = call.getInt("beatsPerBar") ?? 4
        let pattern = call.getArray("accentPattern", String.self)
        let anchor = call.getDouble("anchorEpochMs")
        timerQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                try self.beginScheduling(
                    bpm: bpmValue,
                    beatsPerBar: beats,
                    accentPattern: pattern,
                    anchorEpochMs: anchor
                )
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
        let anchor = call.getDouble("anchorEpochMs")
        timerQueue.async { [weak self] in
            guard let self = self else { return }
            // MVP: full restart. The DispatchSourceTimer fires again after
            // `restartTimer` so the caller hears a fresh tick within one
            // period of the new tempo — no perceptible pause.
            do {
                try self.beginScheduling(
                    bpm: bpmValue,
                    beatsPerBar: beats,
                    accentPattern: pattern,
                    anchorEpochMs: anchor
                )
                call.resolve()
            } catch {
                NSLog("ClickKeep native metronome: updateTempo failed: \(error)")
                call.reject("updateTempo failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Internals

    private func beginScheduling(
        bpm: Double,
        beatsPerBar: Int,
        accentPattern: [String]?,
        anchorEpochMs: Double?
    ) throws {
        // All mutation runs on timerQueue — the serial queue is the sole synchronization mechanism.

        let clampedBpm = max(30.0, min(300.0, bpm))
        let clampedBeats = max(1, min(16, beatsPerBar))

        // Claim the audio session lazily. Failure is non-fatal — we still try
        // to start the engine; the user gets audio if iOS lets us have it.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            NSLog("ClickKeep native metronome: failed to configure AVAudioSession: \(error)")
        }

        try ensureAudioReady()

        self.bpm = clampedBpm
        self.beatsPerBar = clampedBeats
        self.accentPattern = accentPattern

        // Fire the nearest beat immediately at handoff. Waiting for the next
        // grid instant (ceil) can pause audio for up to a full period — at
        // 120 BPM that's 500 ms of silence, which reads as a "strong lag"
        // between locking the phone and hearing the click resume. Rounding
        // to the nearest beat cuts that to at most period/2 of grid drift
        // while giving instant audio.
        //
        // Accent still lands on the correct beat *position* in the bar,
        // because `beatIndex % beatsPerBar` (or the accent pattern lookup)
        // uses the anchor-derived beat number. On foreground handoff the
        // Web Audio scheduler re-locks to the true grid.
        if let anchor = anchorEpochMs, anchor.isFinite {
            let periodMs = 60_000.0 / clampedBpm
            let nowMs = Date().timeIntervalSince1970 * 1000
            let elapsed = nowMs - anchor
            let nearestBeatFloat = (elapsed / periodMs).rounded()
            self.beatIndex = max(0, Int(nearestBeatFloat))
        } else {
            self.beatIndex = 0
        }

        self.isScheduling = true
        restartTimer()
    }

    private func endScheduling() {
        // All mutation runs on timerQueue — the serial queue is the sole synchronization mechanism.

        timer?.cancel()
        timer = nil
        isScheduling = false

        accentPlayer.stop()
        normalPlayer.stop()
        // Keep the engine around — cheaper to keep it warm for the next
        // start() than to tear it down. Stopping the players stops audio.

        // Release the audio session so other apps regain audio control when
        // the metronome stops. `.notifyOthersOnDeactivation` lets a paused
        // music app resume automatically.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
    /// Must be called from `timerQueue`. The first tick fires immediately —
    /// callers seed `beatIndex` beforehand so the accent lands on the right
    /// beat position in the bar.
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
        // Read state without a lock — the timer is the only writer of
        // beatIndex and the only reader of these during a tick. start()/
        // stop() serialize onto the same queue.
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

    // MARK: - AVAudioSession interruption handling

    /// Called on the main thread by NotificationCenter when a phone call,
    /// Siri, or a competing playback session takes exclusive audio. We hop
    /// onto `timerQueue` so all state mutation stays on the serial queue.
    @objc private func handleAudioSessionInterruption(_ notification: Notification) {
        guard
            let userInfo = notification.userInfo,
            let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else { return }

        timerQueue.async { [weak self] in
            guard let self = self else { return }
            switch type {
            case .began:
                // Audio can't play through an interruption. Cancel the timer
                // but leave `beatIndex` intact so we resume from the correct
                // position when the interruption ends.
                self.timer?.cancel()
                self.timer = nil
            case .ended:
                // Only auto-resume if the user hadn't already stopped us.
                guard self.isScheduling else { return }
                let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                guard options.contains(.shouldResume) else { return }
                do {
                    try AVAudioSession.sharedInstance().setActive(true)
                    if !self.engine.isRunning {
                        try self.engine.start()
                    }
                    self.restartTimer()
                } catch {
                    // Give up gracefully — the next explicit start() from JS
                    // will retry the whole activation path.
                    NSLog("ClickKeep native metronome: resume after interruption failed: \(error)")
                }
            @unknown default:
                break
            }
        }
    }
}
