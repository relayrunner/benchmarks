// Builds the benchmark matrix from the dispatch inputs: GitHub (the baseline) plus each requested
// provider, on each requested architecture, `repeats` times. Writes `matrix` to $GITHUB_OUTPUT.
//
//   PROVIDERS=blacksmith ARCH=both REPEATS=3 node scripts/plan.mjs
import { appendFileSync, readFileSync } from "node:fs";

const BASELINE = "github";
const MAX_REPEATS = 10;

export function plan(runners, { providers, arch, repeats }) {
  const known = Object.keys(runners).filter((key) => !key.startsWith("$"));
  const asked = String(providers ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const unknown = asked.filter((p) => !known.includes(p));
  if (unknown.length) {
    throw new Error(`Unknown provider ${unknown.join(", ")}. Known: ${known.join(", ")}`);
  }
  const archs = arch === "both" ? ["x64", "arm"] : [arch];
  if (!archs.every((a) => a === "x64" || a === "arm")) {
    throw new Error(`arch must be x64, arm or both, not ${arch}`);
  }
  const n = Number(repeats);
  if (!Number.isInteger(n) || n < 1 || n > MAX_REPEATS) {
    throw new Error(`repeats must be a whole number from 1 to ${MAX_REPEATS}, not ${repeats}`);
  }

  const include = [];
  const skipped = [];
  for (const provider of [BASELINE, ...new Set(asked.filter((p) => p !== BASELINE))]) {
    for (const a of archs) {
      const label = runners[provider][a];
      if (!label) {
        skipped.push(`${provider}/${a}`);
        continue;
      }
      for (let repeat = 1; repeat <= n; repeat++) {
        include.push({ id: `${provider}/${a}/${repeat}`, provider, arch: a, label, repeat });
      }
    }
  }
  return { include, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runners = JSON.parse(readFileSync(new URL("../runners.json", import.meta.url), "utf8"));
  const { include, skipped } = plan(runners, {
    providers: process.env.PROVIDERS,
    arch: process.env.ARCH || "x64",
    repeats: process.env.REPEATS || "3",
  });
  for (const s of skipped) console.log(`::warning::No ${s.split("/")[1]} runner for ${s.split("/")[0]}, skipped`);
  console.log(include.map((j) => `${j.id} -> ${j.label}`).join("\n"));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\n`);
  }
}
