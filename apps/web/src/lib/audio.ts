let realCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let proxyCtx: AudioContext | null = null;
let muted = false;

interface BeatRecord {
  beat: number;
  audioTime: number;
  recordedAt: number;
}

const recentBeats: BeatRecord[] = [];
const RECENT_BEATS_MAX = 32;
let beatsScheduled = 0;
let lastBeatAt: number | null = null;
let lastError: { message: string; at: number } | null = null;

/**
 * Lazily create the AudioContext. Browsers require a user gesture before audio,
 * so this should be called from a click handler.
 *
 * The returned object is a Proxy around the real AudioContext whose `destination`
 * is rerouted through a master GainNode we control. This lets us mute the click
 * (set gain to 0) without touching the Tier-3 click-engine scheduler, which
 * connects oscillators to `ctx.destination` directly.
 */
export function getAudioContext(): AudioContext {
  if (realCtx === null) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    realCtx = new Ctor();
    masterGain = realCtx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(realCtx.destination);
    proxyCtx = new Proxy(realCtx, {
      get(target, prop) {
        if (prop === 'destination') {
          return masterGain;
        }
        // Why `target` (not the proxy) as the receiver: Web API getters like
        // `currentTime` and `state` brand-check `this` against an internal slot
        // and throw `TypeError: Illegal invocation` when invoked with a Proxy
        // as the receiver. Functions are bound to `target` for the same reason.
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    installDebugBridge();
  }
  if (realCtx.state === 'suspended') {
    void realCtx.resume();
  }
  return proxyCtx as AudioContext;
}

/**
 * Mute or unmute the click audio. Visual flash + haptic continue to fire because
 * those are driven from the React layer, not from the audio graph.
 *
 * Switching is seamless mid-playback: we ramp the master gain over ~10ms to avoid
 * pops, but already-scheduled audio nodes keep playing through the (silent) gain.
 */
export function setMuted(next: boolean): void {
  muted = next;
  if (masterGain !== null && realCtx !== null) {
    const target = next ? 0 : 1;
    const now = realCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(target, now + 0.01);
  }
}

export function isMuted(): boolean {
  return muted;
}

/**
 * Record a beat that the scheduler scheduled. Called from the engine driver
 * (see SoloMetronome) so the debug bridge has a live signal of "is the click
 * engine actually firing?" — an agent or human can read window.__clickkeep
 * without listening for sound.
 */
export function recordBeat(beat: number, audioTime: number): void {
  beatsScheduled += 1;
  lastBeatAt = performance.now();
  recentBeats.push({ beat, audioTime, recordedAt: lastBeatAt });
  if (recentBeats.length > RECENT_BEATS_MAX) recentBeats.shift();
}

export function recordEngineError(err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  lastError = { message, at: performance.now() };
}

export function resetEngineStats(): void {
  recentBeats.length = 0;
  beatsScheduled = 0;
  lastBeatAt = null;
}

interface DebugSnapshot {
  audioContext: {
    created: boolean;
    state: AudioContextState | null;
    currentTime: number | null;
    sampleRate: number | null;
  };
  output: { muted: boolean; masterGain: number | null };
  engine: {
    beatsScheduled: number;
    lastBeatAt: number | null;
    msSinceLastBeat: number | null;
    recentBeats: BeatRecord[];
    lastError: { message: string; at: number } | null;
  };
}

function snapshot(): DebugSnapshot {
  return {
    audioContext: {
      created: realCtx !== null,
      state: realCtx?.state ?? null,
      currentTime: realCtx?.currentTime ?? null,
      sampleRate: realCtx?.sampleRate ?? null,
    },
    output: { muted, masterGain: masterGain?.gain.value ?? null },
    engine: {
      beatsScheduled,
      lastBeatAt,
      msSinceLastBeat: lastBeatAt === null ? null : performance.now() - lastBeatAt,
      recentBeats: [...recentBeats],
      lastError,
    },
  };
}

/** Heartbeat: true if a beat fired recently. Threshold is wider than the slowest tempo (30 BPM = 2s/beat). */
function isRunning(): boolean {
  if (lastBeatAt === null) return false;
  return performance.now() - lastBeatAt < 2500;
}

declare global {
  interface Window {
    __clickkeep?: {
      snapshot: () => DebugSnapshot;
      isRunning: () => boolean;
    };
  }
}

function installDebugBridge(): void {
  if (typeof window === 'undefined') return;
  if (window.__clickkeep !== undefined) return;
  window.__clickkeep = { snapshot, isRunning };
  window.addEventListener('error', (e) => {
    if (e.error !== undefined) recordEngineError(e.error);
    else recordEngineError(e.message);
  });
  window.addEventListener('unhandledrejection', (e) => recordEngineError(e.reason));
}
