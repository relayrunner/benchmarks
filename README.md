# Node workload leaderboard

## Linux x64, 4 vCPU, cold cache

| # | Runner | Score | Median | vs fastest | vs GitHub | Range | Pickup | Install | Typecheck | Test | Build | Runs (failed) | CPU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | github `ubuntu-24.04` | 49.8 | 17.8s | 1.00x | 1.00x | 17.3s to 18.0s | 2.0s | 3.6s | 2.6s | 4.5s | 6.9s | 3 (0) | Intel(R) Xeon(R) 6975P-C |
| 2 | blacksmith `blacksmith-4vcpu-ubuntu-2404` | 46.9 | 17.5s | 0.99x | 0.99x | 16.1s to 23.0s | 7.0s | 4.5s | 2.7s | 3.7s | 6.6s | 3 (0) | AMD EPYC |

Score: 0 to 100, from the median and p95 ratio to GitHub's runner in the same dispatch, times the success rate (GitHub ≈ 50, twice GitHub's time = 0). Median = restore (warm only) + install + typecheck + test + build. Pickup = queued to started. GitHub's runner in a public repo has 4 vCPU, so 2 vCPU tables still compare against it. See METHODOLOGY.md.
