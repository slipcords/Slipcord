# ThreadContinuationSuggester

Detects when a conversation's topic drifts and suggests continuing the new sub-topic in a thread, keeping discussions organized.

## Features

- Tracks a rolling window of recent messages per channel
- Computes keyword overlap between the latest message and the recent conversation
- When overlap drops below a sensitivity threshold, surfaces a "consider a thread" suggestion toast
- Per-channel cooldown to avoid suggestion spam

## Settings

- **Sensitivity** - how different a message must be to trigger (lower = more suggestions)
- **Cooldown** - minimum seconds between suggestions per channel
- **Min messages** - how many recent messages are needed before suggestions appear
- **Window size** - number of recent messages compared against
