# EmojiEvolutionTracker

Tracks emoji usage across your servers over time and surfaces which emoji are on the rise, which are fading out, and a per-server trend.

## Features

- Tracks both custom (`<:name:id>`) and (optionally) Unicode emoji
- Per-server daily usage buckets
- A settings-page dashboard with the top emoji across all servers and the trend for the server you're currently viewing
- Configurable history retention

## Settings

- **Track Unicode emoji** - also count non-custom emoji
- **Retention days** - how long usage history is kept before pruning
- **Min count** - threshold for an emoji to appear in the leaderboard

> Data is stored locally in IndexedDB and is never uploaded anywhere.
