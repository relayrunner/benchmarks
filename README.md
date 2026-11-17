# Node workload leaderboard

## Linux x64, 2 vCPU

| # | Runner | Median workload | vs fastest | vs GitHub | Range | Pickup | Install | Typecheck | Test | Runs (failed) | CPU |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | github `ubuntu-24.04` | 13s | 1.00x | 1.00x | 12s to 16s | 2s | 5s | 3s | 5s | 3 (0) | Intel(R) Xeon(R) 6975P-C |
| 2 | blacksmith `blacksmith-2vcpu-ubuntu-2404` | 22s | 1.69x | 1.69x | 21s to 27s | 9s | 7s | 4s | 11s | 3 (0) | AMD EPYC |

Workload = install + typecheck + test, timed from GitHub's step timestamps. Ranked on the median ratio to GitHub's runner in the same dispatch. Pickup = queued to started.
