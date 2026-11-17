# RelayRunner benchmarks

How fast GitHub Actions runner providers finish the same real-world job, measured in the open.

**Latest results:** see the [`results` branch](../../tree/results). Its README is the leaderboard, and `results/` holds one raw JSON file per run.

## The workload

[Zustand](https://github.com/pmndrs/zustand)'s own CI steps at commit `9fed2eb`, timed in milliseconds on the runner: **install, typecheck, test and build**, plus **restore cache** on warm runs. **Pickup**, from GitHub queueing the job to a runner starting it, comes from the jobs API. Full details in [METHODOLOGY.md](METHODOLOGY.md).

Every dispatch also runs GitHub's standard runner (4 vCPU in a public repo) as a baseline. Runners get a **score** from 0 to 100 based on their time relative to that baseline (GitHub is about 50) and their success rate, so runs from different days stay comparable.

## Running a benchmark

Actions → **Benchmark** → Run workflow:

| Input | Meaning |
|---|---|
| `providers` | Keys from [`runners.json`](runners.json), comma separated, such as `blacksmith`. GitHub always runs too |
| `arch` | `x64`, `arm` or `both` |
| `vcpus` | Provider runner size: `4` (default, matches GitHub), `2` or `both` |
| `cache` | `cold` (default), `warm` or `both`. Warm adds one priming job per runner |
| `repeats` | Runs per runner and cache mode, 1 to 10 (default 3) |
| `dry_run` | Run without saving results |

Each job has a 15-minute timeout. When everything finishes, the `collect` job writes the results to the `results` branch and puts this dispatch's table in the run summary.

## Adding a provider

1. Install the provider's GitHub App on this repository.
2. Add its labels to [`runners.json`](runners.json), by architecture and vCPU count.
3. Dispatch with just that provider. Earlier results stay, and the new one is scored against them through the GitHub baseline.

## Runners

| Provider | x64 | arm |
|---|---|---|
| GitHub (baseline, 4 vCPU) | `ubuntu-24.04` | `ubuntu-24.04-arm` |
| Blacksmith 2 vCPU | `blacksmith-2vcpu-ubuntu-2404` | `blacksmith-2vcpu-ubuntu-2404-arm` |
| Blacksmith 4 vCPU | `blacksmith-4vcpu-ubuntu-2404` | `blacksmith-4vcpu-ubuntu-2404-arm` |

## Development

```sh
npm test                                         # unit tests for the scripts
node scripts/summarize.mjs path/to/results       # leaderboard from results files
```
