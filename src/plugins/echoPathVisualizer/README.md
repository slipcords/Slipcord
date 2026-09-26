# EchoPathVisualizer

Visualizes who can hear whom in your current voice channel - helpful for debugging audio routing, mute/deafen states, and push-to-talk suppression.

## Features

- Opens a modal from the plugin settings showing everyone in your voice channel
- Computes both directions: "you hear them" and "they hear you"
- Flags self-mute, deafen, and suppression state
- Live-re-renders when voice states change
- Optional hide for fully-deafened members

## Settings

- **Show microphone state** - include mute/deafen/suppress columns
- **Hide fully deafened** - omit members who can neither hear nor be heard
