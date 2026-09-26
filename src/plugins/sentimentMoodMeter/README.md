# SentimentMoodMeter

Scores message sentiment to track a per-channel mood and surfaces the most polarized conversations on the settings page.

## Features

- Lightweight positive/negative word scoring per message
- Rolling window of recent messages per channel, with time-based decay
- Settings dashboard showing the mood of the channel you are in and a leaderboard of the most polarized channels
- Bot/webhook filtering

## Settings

- **Window size** - how many recent messages are scored per channel
- **Decay hours** - messages older than this are ignored
- **Ignore bots** - skip bot and webhook messages

> Scoring uses a small built-in word list and is intentionally simple. It is not a replacement for real NLP.
