let ctx: AudioContext | null = null;

/**
 * Lazily create the AudioContext. Browsers require a user gesture before audio,
 * so this should be called from a click handler.
 */
export function getAudioContext(): AudioContext {
  if (ctx === null) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  return ctx;
}
