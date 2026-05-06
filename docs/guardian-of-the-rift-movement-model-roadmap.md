# Guardian of the Rift Movement Model Roadmap

Date: 2026-05-06

## Context

The current problem is travel ETA. Long-distance clicks, especially toward altars like cosmic, can be misestimated because the RuneLite camera is not a true top-down view. Tiles near the top of the screen are visually smaller than tiles near the bottom, so one average `tilePx` value is not precise enough for every direction and screen position.

## Current Implementation

The bot now has a persistent movement model history:

```text
guardian-of-the-rift-movement-model-history.json
```

The model is profile-specific:

```text
host + monitor tier + Windows scale + capture size
```

It starts basic and promotes itself as the bot records more validated movement observations.

## Current Versions

`v1`: basic conservative model.

- Uses fixed movement buckets.
- Adds wait buffer for long distance, very long distance, top-screen targets, and mostly-one-axis movement.

`v2`: learned bucket model.

- Activates after enough movement observations.
- Learns whether each bucket needs more or less buffer:
  - long distance
  - very long distance
  - top screen
  - mostly X/Y movement

`v3`: learned Y-band bucket model.

- Activates after more observations.
- Adds learned screen position bands:
  - top
  - middle
  - bottom

Important: `v3` is still not homography. It is smarter bucket learning, but it is still an approximation.

## When To Revisit

Revisit this if `v3` is still not precise enough and logs still show:

- re-clicking before the player reaches the destination
- long altar travel being early or late
- cosmic or other far altars needing different timing than closer altars
- movement errors that depend strongly on screen Y position

Useful log fields to inspect:

```text
distance=...
dx=...
dy=...
tiles~...
tilePx=...
movement=v...
y=...
axis=...
reason=...
```

## Future Version: v4 Homography

If `v3` is not enough, the next step should be a `v4` homography-based model.

Homography means learning a mathematical transform between screen pixels and game-world tile coordinates. Instead of treating pixels as one average scale, the bot would learn how screen perspective bends the tile grid.

The goal:

```text
screen pixel point -> estimated world/tile point
```

Then movement ETA can be based on estimated tile distance instead of rough pixel distance.

## Data Needed For Homography

The bot needs reliable paired observations:

```text
screen click point
player coordinate before click
player coordinate after arrival
camera/profile info
success/late outcome
```

Good candidates:

- guardian click to altar teleport confirmation
- altar click to inventory change
- deposit click to inventory change
- salmon portal click to confirmed mining tile

Do not train from obvious misclicks, for example salmon portal clicking a guardian and landing in an altar region.

## Practical v4 Plan

1. Keep `v3` as fallback.
2. Start collecting homography training samples without using them for decisions.
3. Once enough reliable samples exist for the same profile, compute a candidate transform.
4. Compare candidate ETA vs current `v3` ETA in logs only.
5. Promote to active `v4` only if it beats `v3` consistently.
6. Roll back to `v3` automatically if late/miss rate gets worse.

## Code References

Main bot:

```text
src/main/automate-bots/runecrafting-guardian-of-the-rift-bot.ts
```

Current movement model:

```text
src/main/automate-bots/guardian-of-the-rift-movement-model.ts
```
