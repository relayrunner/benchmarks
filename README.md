# Node workload leaderboard

## Linux x64, 4 vCPU, cold cache

| # | Runner | Score | Median | vs fastest | vs GitHub | Range | Pickup | Install | Typecheck | Test | Build | Runs (failed) | CPU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | blacksmith `blacksmith-4vcpu-ubuntu-2404` | 0 | – | – | – | – to – | 7.0s | – | – | – | – | 3 (3) | – |
| 2 | github `ubuntu-24.04` | 0 | – | – | – | – to – | 3.0s | – | – | – | – | 3 (3) | – |

Score: 0 to 100, from the median and p95 ratio to GitHub's runner in the same dispatch, times the success rate (GitHub ≈ 50, twice GitHub's time = 0). Median = restore (warm only) + install + typecheck + test + build. Pickup = queued to started. GitHub's runner in a public repo has 4 vCPU, so 2 vCPU tables still compare against it. See METHODOLOGY.md.
