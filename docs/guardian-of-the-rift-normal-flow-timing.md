# Guardian of the Rift normal-flow timing notes

Source log: `automate-bot-logs/20260506-200335-runecrafting-guardian-of-the-rift.log`

This analysis ignores exception/recovery paths as much as possible and focuses on normal flow segments that regularly consume time.

## Main finding

The most interesting normal-flow optimization target is the segment between charged cell deposit and rune deposit.

Observed charged cell -> rune deposit sequences:

| Sequence | Charged click -> charged verified | Charged click -> rune wait | Rune stability wait -> rune click | Charged click -> rune click | Rune click -> verified | Charged click -> rune verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20:07:59 | 3.8s | 5.0s | 3.9s | 9.0s | 5.6s | 14.6s |
| 20:10:39 | 3.0s | 3.9s | 2.2s | 6.1s | 6.9s | 13.0s |

One charged-cell click was interrupted by the open portal flow before rune deposit, so it is not counted as a normal charged -> rune sequence.

## Charged cell -> rune deposit

Current normal costs:

- Charged cell click -> charged inventory verified: about `3.0-3.8s`
- Rune deposit marker stability wait: about `2.2-3.9s`
- Rune deposit click -> rune inventory verified: about `5.6-6.9s`
- Total charged cell click -> rune verified: about `13-15s`

Possible improvements:

- Reduce rune deposit marker stability from `3 ticks` to `2 ticks` when the marker is clear, centered, and not near the edge.
- Start looking for rune deposit marker while charged-cell inventory verification is still pending, then click as soon as the expected inventory delta confirms.
- After rune deposit click, check inventory more aggressively and exit early as soon as free-space increases, instead of effectively waiting close to the travel deadline.

## Other normal-flow costs

| Segment | Observed normal range | Notes |
| --- | ---: | --- |
| Guardian click -> altar click | about `5-13s`, sometimes higher | Long distance and top-screen clicks dominate. |
| Altar click -> altar baseline | about `1.6-11.4s` | Long altar travel can be slow; second altar click is usually much faster. |
| Red portal click -> arena return | about `1.7-10s` | Includes camera-north wait and travel confirmation. |
| Great Guardian click -> verified | about `3.8-6.3s` | Inventory delta often confirms before the full travel wait. |
| Salmon portal click -> mining marker click | about `5.7-7.3s` | Includes salmon validation buffer. |

## Priority

1. Optimize charged cell -> rune deposit.
2. Add early altar scanning during guardian -> altar travel so the bot clicks altar as soon as it is visible.
3. Tighten rune deposit post-click verification to exit earlier.
4. Review red portal return waits after normal portal clicks.
5. Revisit salmon portal validation buffer once false salmon clicks are handled.
