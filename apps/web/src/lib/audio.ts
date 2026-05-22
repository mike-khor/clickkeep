let realCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let proxyCtx: AudioContext | null = null;
let muted = false;

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
      get(target, prop, receiver) {
        if (prop === 'destination') {
          return masterGain;
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
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
