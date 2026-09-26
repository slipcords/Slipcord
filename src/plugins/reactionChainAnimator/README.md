# ReactionChainAnimator

Animates incoming reactions as a growing, popping chain of emoji anchored to the message that received the reaction.

## Features

- Listens for new reactions and spawns an animated emoji burst above the message
- Chain length caps at a configurable maximum
- Respects the "only animate in the channel you're viewing" preference
- Self-cleaning overlay element

## Settings

- **Chain length** - max emoji per burst
- **Animation duration** - how long each burst lasts
- **Only in current channel** - restrict to the actively viewed channel
