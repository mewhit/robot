# Motherlode V2 Movement ETA Notes

Last updated: 2026-04-19

## Context

- Deposit phase click spam was reduced by using progress-gated retries.
- Next goal discussed: estimate travel time and avoid re-clicking while player is still moving.
- Concern: tile OCR parsing may be too expensive to run frequently.

## Question: Can player magenta box estimate tile size in pixels?

Short answer: yes, as an approximation.

You can use the player box as a local scale proxy and estimate tile distance in pixels:

1. Estimate `tilePx` from player box dimensions (or from calibration screenshots).
2. Estimate `distanceTiles ~= distancePx / tilePx`.
3. Convert to expected ticks:
   - Running: `etaTicks = ceil(distanceTiles / 2)`
   - Walking: `etaTicks = ceil(distanceTiles / 1)`

## Known limitations of pixel-only estimate

- Perspective distortion: px per tile changes with Y position on screen.
- Camera zoom/angle changes alter scale.
- Box detector jitter adds noise to distance measurements.
- Obstacles/pathing detours break straight-line estimates.

So this is usable for approximate wait windows, not exact movement timing.

## Practical approach options

1. Pixel-only heuristic (fastest runtime)
   - No OCR in movement loop.
   - Use magenta/player-box distance trend + estimated `tilePx`.
   - Good for reducing spam, less precise.

2. Hybrid (recommended)
   - Use pixel heuristic each tick.
   - Refresh with OCR tile occasionally (for example every 5-10 ticks or only when movement appears stalled).
   - Better precision without OCR every tick.

3. Full tile-based ETA
   - OCR tile each tick.
   - Most precise, highest OCR overhead.

## Resume checklist

- Decide initial strategy: Pixel-only or Hybrid.
- If Pixel-only:
  - Define `tilePx` estimator from player box.
  - Add `etaWaitTicks` gate before re-clicks.
  - Add fallback retry when no progress for `N` ticks.
- If Hybrid:
  - Add low-frequency OCR sampling and correction.
  - Compare estimated vs observed movement and auto-tune `tilePx`.

## Open questions to revisit

- How stable is the player box width/height in your usual camera setup?
- Is run mode always on in this route?
- What max acceptable extra wait before retry click (in ticks)?

