# @clickkeep/native-metronome

Capacitor iOS plugin that keeps the ClickKeep metronome clicking while the
app is backgrounded or the screen is locked.

## Why it exists

Web Audio in an iOS WKWebView is suspended the moment the app leaves the
foreground — the `AudioContext` freezes and any queued events replay in a
burst on resume. `UIBackgroundModes = ["audio"]` and an `AVAudioSession`
set to `.playback` are necessary but not sufficient: the WebView-owned
audio graph is still put to sleep.

This plugin hands the click over to a native AVAudioEngine driven from a
high-priority `DispatchSourceTimer`, so audio keeps firing until the JS
side calls `stop()`. Solo mode only — group sessions rely on the existing
Zustand state propagation to keep tempo current.

## Layout

```
ios/Plugin/
  NativeMetronomePlugin.swift  # CAPBridgedPlugin implementation
  accent.wav                    # ~1500 Hz pitched click, 70 ms
  normal.wav                    # ~1000 Hz pitched click, 70 ms
src/
  definitions.ts                # TypeScript surface
  index.ts                      # registerPlugin('NativeMetronome')
scripts/
  generate-wavs.mjs             # Reproduces the two WAVs from voices.ts params
```

## Usage from JS (runtime lookup)

`apps/web` does not depend on this package. Instead it reaches the plugin
at runtime through the Capacitor global so the web bundle stays free of
native deps. See `apps/web/src/lib/platform-native-audio.ts`.

## Regenerating WAVs

```
pnpm --filter @clickkeep/native-metronome generate:wavs
```

Uses Node stdlib only — no npm deps.

## Known limitations

- **Single tone profile.** The native side plays the "pitched" voice only;
  the five Web Audio tone profiles fall back to pitched when the app is
  backgrounded. Adding profiles = adding more prerendered WAV pairs.
- **Beat-phase drift on handoff.** The JS scheduler is anchored to a
  server-clock instant; the native scheduler starts at `beatIndex = 0`
  when `start()` is called. Solo mode users don't notice; group mode
  should never background because losing sync mid-song is worse.
- **Haptics stay silent in background.** iOS blocks the Taptic Engine
  when the app isn't foregrounded. Sound is the only signal.
