# UnreadPeek

Right-click any channel and choose **Peek Unreads** to view cached unread messages in a modal without leaving your current view.

## Features

- Adds a "Peek Unreads" entry to the channel context menu
- Shows cached unread messages from the oldest unread marker to the latest
- Optionally filter to only messages that mention you
- Fallback to the most recent cached messages when no unread marker exists
- Click "Mark channel read" to jump to the channel and mark it (Discord doesn't expose a client-side mark-read for the modal, so you are prompted to navigate)

## Settings

- **Max messages** - cap on how many unreads are loaded into the peek
- **Mentions only** - hide messages that don't @-mention you
