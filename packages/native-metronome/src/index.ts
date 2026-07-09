import { registerPlugin } from '@capacitor/core';
import type { NativeMetronomePlugin } from './definitions.js';

/**
 * Registered under `NativeMetronome` on the JS bridge. The native side
 * exposes the same `jsName`, so callers who prefer runtime lookup can
 * reach it via `window.Capacitor.Plugins.NativeMetronome` without
 * importing this package (see `apps/web/src/lib/platform-native-audio.ts`).
 */
export const NativeMetronome = registerPlugin<NativeMetronomePlugin>('NativeMetronome');

export type { NativeMetronomePlugin, StartOptions, UpdateTempoOptions, BeatState } from './definitions.js';
