# ReplyDigest

Collects @-mentions you miss while away from Discord and delivers them as a grouped daily digest at a time you choose.

## Features

- Captures messages that mention you while you're idle or away (configurable inactivity threshold)
- Groups the digest by conversation (channel)
- Persists pending entries across sessions via IndexedDB
- Delivers at a scheduled daily time and rolls over to the next day automatically
- Optional "DM only" scope

## Settings

- **Digest time** - `HH:MM` (24h) delivery time
- **Away threshold** - seconds of inactivity before messages count as "missed"
- **Max entries** - cap per delivery
- **DM only** - restrict to direct-message mentions
- **Show empty notice** - still notify when there were no missed mentions
