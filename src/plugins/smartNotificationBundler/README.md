# SmartNotificationBundler

Groups notifications from the same channel received within a short time window into a single toast, reducing notification spam in busy servers.

## Features

- Bundles notifications sharing a channel into one summary toast
- Configurable bundle window (0-30 seconds)
- Burst protection: flushes immediately when a configurable max is reached
- Channel-aware: switches between channel summaries instantly

## Settings

- **Bundle window** - how long to wait before collapsing similar notifications
- **Max per bundle** - threshold at which pending notifications are flushed immediately
