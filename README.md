# RelayRunner benchmarks

How fast GitHub Actions runner providers finish the same real-world job, measured in the open.

**Latest results:** see the [`results` branch](../../tree/results). Its README is the leaderboard, and `results/` holds one raw JSON file per run.

## The workload

[Zustand](https://github.com/pmndrs/zustand)'s own CI steps, pinned to commit `9fed2eb`:

| Stage | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` (pnpm 11.3.0, Node 24, cold, no cache) |
| Typecheck | `pnpm run test:types` (`tsc --noEmit`) |
| Test | `pnpm run test:spec` (`vitest run`) |

The **workload time** is install + typecheck + test. **Pickup** is the time from GitHub queueing the job to a runner starting it. Every time comes from GitHub's job and step timestamps (the jobs API), never from the runner's own clock.

## How runs are compared

Runs happen on demand, so they can be days apart, and the network, package mirrors and GitHub's own load shift in between. To keep runs comparable, every dispatch also runs GitHub's standard runner (`ubuntu-24.04` / `ubuntu-24.04-arm`, 2 vCPU) as a baseline:

1. Each job's workload time is divided by the median GitHub time from the same dispatch.
2. Each provider's rank is the median of those ratios across all its runs.
3. **vs fastest** is that ratio divided by the best one, so the top runner reads 1.00x.

The real median times, the min to max range, the time per stage, and the CPU each job got are shown alongside. Failed jobs and jobs that never started stay in the counts.

## Running a benchmark

Actions → **Benchmark** → Run workflow:

- `providers`: keys from [`runners.json`](runners.json), comma separated, such as `blacksmith`. GitHub always runs too.
- `arch`: `x64`, `arm` or `both`.
- `repeats`: runs per runner, 1 to 10 (default 3).

Each job has a 15-minute timeout. When all jobs finish, the `collect` job writes the results to the `results` branch and adds this dispatch's table to the run summary.

## Adding a provider

1. Install the provider's GitHub App on this repository.
2. Add its 2 vCPU labels to [`runners.json`](runners.json).
3. Dispatch with just that provider. Earlier results stay, and the new one is ranked against them through the GitHub baseline.

## Runners

| Provider | x64 | arm |
|---|---|---|
| GitHub (baseline) | `ubuntu-24.04` | `ubuntu-24.04-arm` |
| Blacksmith | `blacksmith-2vcpu-ubuntu-2404` | `blacksmith-2vcpu-ubuntu-2404-arm` |

## Development

```sh
npm test                                         # unit tests for the scripts
node scripts/summarize.mjs path/to/results       # leaderboard from results files
```
