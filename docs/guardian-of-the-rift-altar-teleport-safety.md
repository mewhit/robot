# Guardian of the Rift Altar Teleport Safety Notes

Date: 2026-05-06

## Problem Observed

During one run, the bot logged:

```text
Teleport confirmed: region changed from 14484 to 14741, chunk=935080, matched='3649,9542,0'.
Searching for altar marker.
Altar marker not visible in region 14741...
```

It then rotated several times, never found the altar marker, and stopped.

The suspected issue is that the coordinate read was a bad teleport confirmation. The tile `3649,9542` is still near the Guardians of the Rift arena, even though the `regionId` changed. The bot treated that as a real altar teleport, but visually it was probably still in or near the GOTR arena.

## Current Safety Change

The bot now rejects altar-teleport confirmation if the coordinate is still near the GOTR arena bounds:

```text
x: 3560..3665
y: 9470..9565
```

So a coordinate like:

```text
3649,9542
```

does not count as a successful altar teleport anymore, even if the region changes away from `14484`.

If this happens, the bot should treat the previous teleport confirmation as a bad read and return to guardian re-click checks instead of stopping after failed altar-marker searches.

## False Negative Risk

The risk is that a real altar teleport could be incorrectly rejected if an altar coordinate happens to fall inside the GOTR-area safety bounds above.

What to watch in logs:

```text
Altar search safety recheck no longer confirms altar region...
coordinate is still near the GOTR arena
Treating the previous teleport confirmation as a bad read
```

If this appears while the character is actually at a real altar, then the safety bounds are too broad or the coordinate assumptions are wrong.

## How To Diagnose

If the bot refuses a real altar teleport, capture these details from the log:

```text
matched='x,y,z'
region=...
chunk=...
altar marker candidates=...
```

Then compare the `x,y` against the safety bounds:

```text
GOTR arena safety bounds:
x 3560..3665
y 9470..9565
```

If the real altar coordinate is inside those bounds, reduce or replace the bounds. If the real altar coordinate is outside those bounds but still rejected, inspect the `hasLeftGuardianCraftingChunk` logic.

## Related Code

Main file:

```text
src/main/automate-bots/runecrafting-guardian-of-the-rift-bot.ts
```

Important constants/functions:

```text
GUARDIAN_CRAFTING_AREA_MIN_X
GUARDIAN_CRAFTING_AREA_MAX_X
GUARDIAN_CRAFTING_AREA_MIN_Y
GUARDIAN_CRAFTING_AREA_MAX_Y
isNearGuardianCraftingAreaLocation
hasLeftGuardianCraftingChunk
runWaitAfterGuardianClickTick
```

## TODO: Rare Red-Portal Recovery OCR Loop

Observed on 2026-05-08: during salmon/recovery flow, the bot clicked the red recovery portal repeatedly because every post-click coordinate revalidation still read outside `regionId=14484`, even though the player was visually back at the uncharged-cell/crafting area.

This seems rare, so do not rush a broad rewrite. Track it as a recovery hardening item.

- Add diagnostics to each red recovery warning:
  - full coordinate debug via `formatGuardianCoordinateDebug`
  - whether `isNearGuardianCraftingAreaLocation(location)` is true
  - visible crafting-area signals, such as uncharged cell table, workbench marker, guardian UI, or inventory/mining state
- Add a loop guard for repeated red recovery clicks:
  - count repeated outside-region reads after red portal clicks
  - if the read is stable but crafting-area visual signals are present, stop re-clicking red portal
  - resume the expected flow instead of staying in `wait-after-guardian-return-click`
- Avoid trusting OCR region alone in recovery paths:
  - `regionId !== 14484` should be treated as suspicious when coordinates or visuals still look like the GOTR arena
  - require a second signal before deciding that the player is still outside the crafting area
- Keep the first implementation diagnostic-first:
  - log enough data to confirm the failure mode before changing the recovery decision broadly
