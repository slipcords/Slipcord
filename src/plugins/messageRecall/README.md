# MessageRecall

Adds a chat-bar toggle (and an auto-recall mode) that sends messages which delete themselves after a configurable countdown.

## Features

- Toggleable "recall mode" via a chat-bar button
- Auto-recall option for every outgoing message
- Configurable deletion delay
- Pending-recall timers are cleaned up when the plugin stops

## Settings

- **Delay** - seconds before the message self-deletes
- **Auto recall** - always recall outgoing messages
- **Confirm on send** - reserved for future confirmation flow
- **Show timer** - surface a countdown toast

> Deleting messages requires the standard Discord message-delete permission. Recall happens client-side locally; other clients will see the message arrive then disappear once deleted.
