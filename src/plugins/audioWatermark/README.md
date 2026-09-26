# AudioWatermark

Issues a rotating voice-channel watermark token while you're in voice chat, keeps a local log of issued tokens, and provides a reference tone to verify audibility.

## Features

- Rotating per-channel voice watermark token (changes every configurable interval)
- Local log of issued tokens (stored in IndexedDB, never uploaded)
- "Play reference tone" button using the Web Audio API to verify the tone you'd pair with a token
- Settings-page dashboard showing status, active token, and user

## Settings

- **Enabled** - generate/log tokens while in voice
- **Token rotation** - how often the token changes
- **Play reference tone** - emit a local test tone
- **Tone frequency / volume** - control the reference tone

> **Limitations:** True outbound-audio watermarking (embedding the tone into your microphone stream sent to Discord) requires native audio access that client modifications cannot perform. This plugin provides the verifiable token log and local reference tone for workflows that combine a client-side token with an out-of-band tone.
