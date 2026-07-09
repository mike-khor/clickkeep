import { afterEach, describe, expect, it, vi } from 'vitest';
import { pulse, setHapticImpl } from './haptic.js';

describe('haptic adapter', () => {
  afterEach(() => {
    setHapticImpl(null);
    vi.unstubAllGlobals();
  });

  it('calls installed impl instead of navigator.vibrate', () => {
    const impl = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    setHapticImpl(impl);
    pulse(42);
    expect(impl).toHaveBeenCalledWith(42);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('falls back to navigator.vibrate when no impl installed', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    pulse(30);
    expect(vibrate).toHaveBeenCalledWith(30);
  });

  it('setHapticImpl(null) restores the fallback', () => {
    const impl = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    setHapticImpl(impl);
    setHapticImpl(null);
    pulse(30);
    expect(impl).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(30);
  });
});
