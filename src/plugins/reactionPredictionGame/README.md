# ReactionPredictionGame

Tries to predict which emoji reaction you will give to new messages and keeps score of how often you match.

## Features

- Predicts your next reaction per message (sentiment-based by default, or based on your recent reaction history)
- Scores accuracy over time, persisted between sessions
- Toasts on a hit (and occasionally on a miss)
- Settings dashboard with reset button
- Predictions expire after an inactivity window

## Settings

- **Auto predict** - enable/disable predictions
- **Predict by sentiment** - use message sentiment; otherwise uses your recent reactions
- **Prediction expiry** - how long a prediction stays valid
- **Toast on match** - celebrate hits

> Predictions are heuristic and meant for fun. Accuracy is tracked globally across servers.
