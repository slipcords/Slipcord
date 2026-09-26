# DynamicThemeTwilight

Shifts Discord's color temperature with the sun - warmer in the evenings, neutral during the day - computed from real sunrise/sunset times for your location.

## Features

- Compact NOAA-style sunrise/sunset calculation (no external lookup needed)
- Optional automatic geolocation via the browser
- Configurable max warmth and transition window
- Smooth 3-second color filter ramp via a managed style
- Settings dashboard showing sunrise/sunset and the next transition

## Settings

- **Latitude / Longitude** - your position (east-positive, north-positive)
- **Use system location** - fetch coordinates on startup
- **Night warmth** - maximum warmness at night
- **Transition minutes** - how long the filter ramps around sunrise/sunset

> This applies a CSS color-temperature filter to Discord's app surface. It does not replace Discord's built-in light/dark theme, and the `.app-1Yzh6` selector is tied to Discord's current class names.
