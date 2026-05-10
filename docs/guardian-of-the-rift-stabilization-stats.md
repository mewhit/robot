# Guardian of the Rift - Stabilization Stats

Version name: `stabilization`
Date: 2026-05-07

Dataset: 17 logged runs, read from each log footer `Run stats:`. The `miningEnd=toWorkbench` line was backfilled from existing log timestamps by measuring the first `[mining] ... mining complete` line to the first following `Clicked middle of magenta workbench marker` line.

- `clean_complete`: bot logged `End-of-round rune deposit complete`.
- `manual_complete`: user confirmed the run completed, but the bot was stopped before final confirmation.
- `stopped/incomplete`: logged run without clean or manually confirmed completion; shown in the table but excluded from baseline averages.
- `n/a` for mining end -> workbench means the log started after the first mining phase.

## Run Summary

| Run | Status | Duration | Mining end -> WB | Great Guardian | Workbench fallback | WB outliers | Red misses | Salmon retry | Charged retry | Guardian no-target | Guardian reclick |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `20260507-093046 run-01` | clean | 10:35 | n/a | 4/8 | 0 / 0.0s | 2 | 2 | 5 | 1 | 2 | 2 |
| `20260507-095047 run-01` | clean | 10:10 | 16.1s | 4/5 | 6 / 51.2s | 5 | 0 | 2 | 1 | 1 | 2 |
| `20260507-102156 run-01` | clean | 9:05 | 16.1s | 4/6 | 5 / 35.1s | 3 | 2 | 2 | 0 | 1 | 3 |
| `20260507-111954 run-01` | clean | 9:40 | 15.8s | 5/5 | 2 / 4.0s | 1 | 0 | 4 | 0 | 2 | 1 |
| `20260507-113950 run-01` | clean | 9:32 | 16.3s | 4/5 | 5 / 34.9s | 4 | 7 | 4 | 0 | 1 | 2 |
| `20260507-114922 run-02` | manual | 9:05 | 12.0s | 5/5 | 0 / 0.0s | 2 | 1 | 4 | 0 | 3 | 2 |
| `20260507-120908 run-01` | clean | 9:21 | 16.4s | 5/5 | 1 / 2.7s | 1 | 6 | 2 | 0 | 2 | 4 |
| `20260507-121830 run-02` | clean | 9:41 | 11.8s | 5/5 | 1 / 7.8s | 0 | 0 | 5 | 0 | 0 | 1 |
| `20260507-122811 run-03` | clean | 9:47 | 15.7s | 5/5 | 3 / 13.6s | 0 | 0 | 3 | 0 | 1 | 3 |
| `20260507-123904 run-01` | stopped/incomplete | 8:52 | 15.0s | 5/6 | 9 / 21.8s | 0 | 8 | 2 | 1 | 1 | 1 |
| `20260507-124756 run-02` | clean | 9:40 | 24.5s | 5/5 | 1 / 2.7s | 0 | 4 | 6 | 0 | 4 | 1 |
| `20260507-125736 run-03` | clean | 9:52 | 13.8s | 4/5 | 1 / 3.5s | 0 | 0 | 5 | 1 | 3 | 1 |
| `20260507-130727 run-04` | clean | 9:25 | 105.7s | 4/4 | 0 / 0.0s | 0 | 4 | 8 | 0 | 1 | 1 |
| `20260507-132700 run-01` | clean | 9:55 | 14.4s | 5/6 | 5 / 16.5s | 0 | 1 | 4 | 0 | 2 | 2 |
| `20260507-133656 run-02` | stopped/incomplete | 9:23 | 13.9s | 5/7 | 9 / 19.3s | 0 | 0 | 4 | 0 | 4 | 1 |
| `20260507-134619 run-03` | clean | 9:54 | 6.1s | 5/5 | 4 / 20.6s | 1 | 0 | 5 | 0 | 0 | 2 |
| `20260507-135613 run-04` | clean | 10:08 | 12.1s | 5/6 | 4 / 14.1s | 1 | 2 | 5 | 0 | 4 | 2 |

`WB outliers` counts workbench travel estimates with `distance >= 700px`, which catches impossible nearby-distance reads. `Mining end -> WB` is specifically the first mining phase only, from the end of mining.

## Baseline

Baseline includes `clean` and the manually accepted run, and excludes stopped/incomplete runs.

| Metric | Value |
| --- | ---: |
| Logged runs | 17 |
| Baseline runs | 15 |
| Clean complete | 14 |
| Manual complete | 1 |
| Excluded stopped/incomplete | 2 |
| Average duration | 9:43 |
| Best duration | 9:05 (20260507-102156 run-01) |
| Worst duration | 10:35 (20260507-093046 run-01) |
| Great Guardian success | 69/80 |
| Great Guardian success rate | 86% |
| Great Guardian success per run | 4.6 |
| Great Guardian clicks per run | 5.3 |
| Mining end -> WB samples | 14/15 |
| Mining end -> WB average | 21.2s |
| Mining end -> WB median | 15.8s |
| Mining end -> WB best | 6.1s (20260507-134619 run-03) |
| Mining end -> WB worst | 105.7s (20260507-130727 run-04) |

Great Guardian score scale:

| Success count | Rating |
| ---: | --- |
| 0-2 | very poor |
| 3 | poor |
| 4 | okay |
| 5 | good |
| 6 | excellent |

Current `stabilization` average is `4.6`, so the baseline is between `okay` and `good`.

## Mining End To Workbench

Observed impact in the 15-run baseline:

- Samples: 14/15 baseline runs
- Average: 21.2s
- Median: 15.8s
- Best: 6.1s (20260507-134619 run-03)
- Worst: 105.7s (20260507-130727 run-04)
- Runs over 20s: 2 (`20260507-124756 run-02`, `20260507-130727 run-04`)
- Runs over 30s: 1 (`20260507-130727 run-04`)
- Average without >30s outliers: 14.7s

Normal flow is around 12-16s. The main issue is not the normal path; it is outliers like `20260507-130727 run-04`, where mining end -> workbench took 105.7s.

Suggested stat to compare next version:

- Mining end -> workbench average
- Mining end -> workbench median
- Count of mining end -> workbench >20s
- Whether the workbench was found on the first scan after agility travel

## Optimization Buckets

### 1. Workbench fallback and pouch threshold (#1 + #8)

Observed impact in the 15-run baseline:

- Workbench fallback count: 38
- Runs affected: 12/15
- Observed fallback wait: 206.7s total
- Average fallback wait per fallback: 5.4s
- Average fallback cost per baseline run: 13.8s
- Workbench pouch-fill then reclick cycles: 44
- Workbench distance outliers >= 700px: 20

This remains the strongest optimization target. It is direct wasted time after the workbench click, and it is easy to observe in logs.

### 2. Salmon mining validation (#5)

Observed impact:

- Salmon arrival confirmations tracked: 29
- Salmon retry/not-confirmed signals: 64
- Salmon portal double-click/re-click rate should be tracked separately from missed/disappeared portals. A re-click is a log line like `re-clicked center of FFFF5E7E portal marker`.
- Portal click to mining-zone confirmation: 220.2s total
- Average validation time: 7.6s
- Worst validation time: 12.1s

This is still a large time bucket, but part of it is real travel time.

Current precise-click comparison:

- `optimized-mining-workbench-travel-time`: 12 re-clicks / 81 initial salmon clicks = 14.8%.
- `optimized-salmon-portal-precise-click`: 4 re-clicks / 29 initial salmon clicks = 13.8%.
- Latest precise complete runs: 2 re-clicks / 23 initial salmon clicks = 8.7%.

This suggests the precise salmon click may reduce double-clicks, but it has not yet proven better salmon confirmation rate. Keep this metric separate from salmon portal confirmations.

### 3. Altar camera return / red portal search (#6)

Observed impact:

- Red portal searches: 76
- Red portal misses: 29
- Red portal search time: 77.6s total
- Average search time: 1.0s
- Worst search time: 7.8s

This is useful to compare visually, but the previous camera changes were unstable, so any new change here should be isolated.

### 4. Guardian travel timing / overlap clicks (#3 + #9)

Observed impact:

- Guardian initial no-target scans: 27
- Guardian reclicks: 29
- Guardian reclick no-target scans: 15
- Great Guardian late reclicks: 4
- Great Guardian inventory-not-ready warnings: 170

Great Guardian success is the primary score, but wrong/late clicks still cost time and can reduce points.

### 5. Charged cell deposit validation (#4)

Observed impact:

- Charged cell attempts: 74
- Charged cell verified: 72
- Charged cell retry signals: 3
- Charged cell verification time: 282.7s total
- Average verification time: 3.9s
- Worst verification time: 6.1s

This is currently smaller than workbench and salmon, but it is still worth watching because it sits late in the run.

## Versioning Notes

Use commit/version names that explain the changed behavior and keep the stat target obvious. Examples:

| Pattern | Example |
| --- | --- |
| `gotr/<area>-<behavior>-<stat-target>` | `gotr/workbench-nw-camera-first-wb` |
| `gotr/<area>-stabilize-<risk>` | `gotr/altar-stabilize-cosmic-wait` |
| `gotr/<area>-measure-<metric>` | `gotr/stats-measure-first-mining-wb` |

Minimum sample before judging a change: 5 complete runs for a quick smoke comparison, 10-15 complete runs before trusting small differences. If Great Guardian success changes by 1+ per run or a major miss-click appears, stop early and revert or isolate.
