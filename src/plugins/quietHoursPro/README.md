# QuietHoursPro

Schedule quiet hours that automatically mute all of your servers (and restore them afterwards) on a per-day basis.

## Features

- Configurable start/end hours (24h) on a repeating schedule
- Per-day scheduling: every day, weekdays, weekends, or single day of week
- Mutes message notifications (`muted` + "Nothing") and optionally role/`@everyone`/`@mentions` suppression
- Optional voice activity notification muting
- Snapshots your existing per-guild notification settings and restores them when quiet hours end
- Survives plugin reload via persisted snapshot

## Settings

- **Start / End hour** - window during which quiet hours are active
- **Active days** - which weekdays the schedule applies to
- **Mute mentions too** - also suppress `@mentions` and role pings
- **Mute voice** - also mute voice channel activity notifications
