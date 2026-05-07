# Guardian of the Rift - Stabilization Stats

Version name: `stabilization`
Date: 2026-05-07

Dataset: 13 logged runs, read from each log footer `Run stats:`.

- `clean_complete`: bot logged `End-of-round rune deposit complete`.
- `manual_complete`: user confirmed the run completed, but the bot was stopped before final confirmation.
- `stopped/incomplete`: logged run without a clean or manually confirmed completion; shown in the table but excluded from baseline averages.

## Run Summary

| Run | Status | Duration | Great Guardian | Workbench fallback | WB outliers | Red misses | Salmon retry | Charged retry | Guardian no-target | Guardian reclick |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `20260507-093046 run-01` | clean | 10:35 | 4/8 | 0 / 0.0s | 2 | 2 | 5 | 1 | 2 | 2 |
| `20260507-095047 run-01` | clean | 10:10 | 4/5 | 6 / 51.2s | 5 | 0 | 2 | 1 | 1 | 2 |
| `20260507-102156 run-01` | clean | 9:05 | 4/6 | 5 / 35.1s | 3 | 2 | 2 | 0 | 1 | 3 |
| `20260507-111954 run-01` | clean | 9:40 | 5/5 | 2 / 4.0s | 1 | 0 | 4 | 0 | 2 | 1 |
| `20260507-113950 run-01` | clean | 9:32 | 4/5 | 5 / 34.9s | 4 | 7 | 4 | 0 | 1 | 2 |
| `20260507-114922 run-02` | manual | 9:05 | 5/5 | 0 / 0.0s | 2 | 1 | 4 | 0 | 3 | 2 |
| `20260507-120908 run-01` | clean | 9:21 | 5/5 | 1 / 2.7s | 1 | 6 | 2 | 0 | 2 | 4 |
| `20260507-121830 run-02` | clean | 9:41 | 5/5 | 1 / 7.8s | 0 | 0 | 5 | 0 | 0 | 1 |
| `20260507-122811 run-03` | clean | 9:47 | 5/5 | 3 / 13.6s | 0 | 0 | 3 | 0 | 1 | 3 |
| `20260507-123904 run-01` | stopped/incomplete | 8:52 | 5/6 | 9 / 21.8s | 0 | 8 | 2 | 1 | 1 | 1 |
| `20260507-124756 run-02` | clean | 9:40 | 5/5 | 1 / 2.7s | 0 | 4 | 6 | 0 | 4 | 1 |
| `20260507-125736 run-03` | clean | 9:52 | 4/5 | 1 / 3.5s | 0 | 0 | 5 | 1 | 3 | 1 |
| `20260507-130727 run-04` | clean | 9:25 | 4/4 | 0 / 0.0s | 0 | 4 | 8 | 0 | 1 | 1 |

`WB outliers` counts workbench travel estimates with `distance >= 700px`, which catches the impossible nearby-distance reads that the stable player anchor is meant to remove.

## Baseline

Baseline excludes `20260507-123904 run-01` because it did not record a clean end-of-round rune deposit and was not manually confirmed complete.

| Metric | Value |
| --- | ---: |
| Logged runs | 13 |
| Baseline runs | 12 |
| Clean complete | 11 |
| Manual complete | 1 |
| Excluded stopped/incomplete | 1 |
| Average duration | 9:39 |
| Best duration | 9:05 |
| Worst duration | 10:35 |
| Great Guardian success | 54/63 |
| Great Guardian success rate | 86% |
| Great Guardian success per run | 4.5 |
| Great Guardian clicks per run | 5.2 |

Great Guardian score scale:

| Success count | Rating |
| ---: | --- |
| 0-2 | very poor |
| 3 | poor |
| 4 | okay |
| 5 | good |
| 6 | excellent |

Current `stabilization` average is `4.5`, so the baseline is between `okay` and `good`.

## Optimization Ranking

### 1. Workbench fallback and pouch threshold (#1 + #8)

Observed impact in the 12-run baseline:

- Workbench fallback count: 25
- Runs affected: 9/12
- Observed fallback wait: 155.5s total
- Average fallback wait: 6.2s
- Average cost per baseline run: 13.0s
- Workbench pouch-fill then reclick cycles: 35
- Workbench distance outliers >= 700px: 18

This is still the strongest current optimization target. The logs show repeated cases where the bot waits for inventory movement after workbench, times out, and reclicks. The pouch threshold idea may reduce extra workbench cycles if the bot fills pouches earlier when `inventory free space + pouch capacity` says it should.

Related implemented optimization to validate next: stable player anchor at bot startup. The complete baseline still contains many pre-anchor distance outliers. The only backfilled log with `stablePlayerAnchor=startup-player-box` is stopped/incomplete, so it is not enough to judge the optimization yet.

Suggested stat to compare next version:

- Workbench fallback count per run
- Total workbench fallback wait
- Workbench pouch-fill reclick cycles
- Distance estimate outliers for nearby targets
- Stable player anchor source
- Run duration change

### 2. Salmon mining validation (#5)

Observed impact:

- Salmon arrival confirmations tracked: 23
- Salmon retry/not-confirmed signals: 50
- Portal click to mining-zone confirmation: 180.9s total
- Average validation time: 7.9s
- Worst validation time: 12.1s

This is a large time bucket, but part of it is real travel time. The improvement should focus on reducing false waiting or retry delay after the portal click, not assuming all 180.9s is waste.

Suggested stat to compare next version:

- Salmon retry/not-confirmed count
- Portal click to mining-zone confirmation average
- Cases where orange rock was visible before coordinate confirmation

### 3. Altar camera return / red portal search (#6)

Observed impact:

- Red portal misses: 26
- Runs affected: 7/12
- Red portal search time: 64.6s total
- Average search time: 1.1s
- Worst search time: 7.8s

This is still a useful target because the user can visually observe it: after the second altar click, count how often the red portal is immediately visible. The camera-return idea is promising only if it reduces red portal misses without breaking altar/pouch clicks.

Suggested stat to compare next version:

- Red portal misses after altar
- Red portal search average and worst case
- Any wrong red-marker clicks

### 4. Guardian travel timing / do not click if too late (#3)

Observed impact:

- Guardian reclicks: 23
- Active guardian no-target scans: 21
- Movement late events for `guardian-to-altar`: 26

This matters for correctness and Great Guardian success. The direct time bucket is smaller than workbench and salmon validation, but reducing wasted guardian clicks should improve Great Guardian success stability.

Suggested stat to compare next version:

- Guardian reclick count
- Guardian no-target count
- Clicks on despawned/wrong guardian
- Great Guardian success per run

### 5. Charged cell deposit validation vs find rune deposit (#4)

Observed impact:

- Charged-cell click/deposit attempts: 57
- Charged-cell verified deposits: 56
- Retry/fail signals: 3
- Click to inventory verification time: 225.4s total
- Average verification time: 4.0s

This is not the top priority in the current logs. It still matters because it can block the rune-deposit transition, but the failure count is low compared with workbench and salmon.

Suggested stat to compare next version:

- Charged-cell retry/fail signals
- Charged-cell click to inventory verification time
- Cases where rune deposit was visible before charged-cell validation completed

### 6. Rotate camera west/east after agility course (#2)

Observed impact:

- No strong evidence that this is currently a large time sink.

This should stay lower priority unless new logs show the orange mining marker is often hidden after agility.

Suggested stat to compare next version:

- Agility confirmed to orange mining click time
- Orange marker missing after agility count

### 7. Two-color active guardian markers (#9)

Observed impact:

- Current logs do not directly prove overlap/wrong-guardian clicks as a major time bucket.
- This is still a reliability improvement, not mainly a speed optimization.

Suggested stat to compare next version:

- Wrong guardian click count
- Overlap cases observed manually
- Active guardian no-target scans
- Great Guardian success per run

## Current Best Next Change

Best implemented optimization to validate: `stable player anchor for distance estimates`.

Reason: the baseline has `18` workbench distance outliers >= `700px`, and those reads can inflate travel waits and fallback behavior.

Best next unimplemented optimization after that: `#1 + #8 Workbench fallback and pouch threshold`.

Reason: it has the clearest measured loss in the 12-run baseline: `155.5s` total observed fallback wait, affecting `9/12` runs, plus `35` workbench pouch-fill/reclick cycles.

After that, test `#5 Salmon mining validation`, then `#6 Altar camera return for red portal`.

## Comparison Checklist For Next Version

For each future version, record:

| Metric | Why it matters |
| --- | --- |
| Version name | Compare code changes cleanly |
| Run count | Avoid judging from 1 lucky/unlucky run |
| Great Guardian success/run | Main success metric |
| Great Guardian clicks/run | Measures wasted GG clicks |
| Average duration | General speed |
| Workbench fallback count | Main current time sink |
| Workbench fallback wait total | Direct observed waste |
| Stable player anchor source | Confirms the bot is not re-detecting a false player position mid-run |
| Nearby target distance outliers | Catches impossible `700px+` distance estimates for close workbench/rock targets |
| Salmon retry count | Portal/mining validation reliability |
| Salmon validation average | Portal travel/confirmation speed |
| Red portal misses | Altar camera/portal visibility |
| Charged-cell retry count | Deposit transition reliability |
| Guardian reclick/no-target count | Travel estimate and target visibility quality |

Minimum useful sample before judging a change: 5 complete runs. Prefer 8-10 if the change affects random visibility/camera behavior.
