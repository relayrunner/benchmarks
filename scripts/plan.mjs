// Builds the benchmark matrices from the dispatch inputs: GitHub (the baseline) plus each requested
// provider, on each requested architecture and size, cold and/or warm, `repeats` times. A warm
// runner also gets one priming job that fills its cache first. Writes `bench` and `prime` (JSON
// matrices) and `has_prime` to $GITHUB_OUTPUT.
//
//   PROVIDERS=blacksmith ARCH=x64 VCPUS=4 CACHE=both REPEATS=3 node scripts/plan.mjs
import { appendFileSync, readFileSync } from "node:fs";

export const BASELINE = "github";
const MAX_REPEATS = 10;

const pick = (value, all, name) => {
  const list = value === "both" ? all : [String(value)];
  if (!list.every((v) => all.includes(v))) {
    throw new Error(`${name} must be ${all.join(", ")} or both, not ${value}`);
  }
  return list;
};

export function plan(runners, { providers, arch, vcpus, cache, repeats }) {
  const known = Object.keys(runners).filter((key) => !key.startsWith("$"));
  const asked = String(providers ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const unknown = asked.filter((p) => !known.includes(p));
  if (unknown.length) {
    throw new Error(`Unknown provider ${unknown.join(", ")}. Known: ${known.join(", ")}`);
  }
  const archs = pick(arch, ["x64", "arm"], "arch");
  const sizes = pick(vcpus, ["2", "4"], "vcpus");
  const caches = pick(cache, ["cold", "warm"], "cache");
  const n = Number(repeats);
  if (!Number.isInteger(n) || n < 1 || n > MAX_REPEATS) {
    throw new Error(`repeats must be a whole number from 1 to ${MAX_REPEATS}, not ${repeats}`);
  }

  const bench = [];
  const prime = [];
  const skipped = [];
  for (const provider of [BASELINE, ...new Set(asked.filter((p) => p !== BASELINE))]) {
    for (const a of archs) {
      // GitHub runs at whatever size it has (4 vCPU in a public repo), whatever was asked: it's
      // the yardstick every dispatch is measured against.
      const wanted = provider === BASELINE ? Object.keys(runners[provider][a] ?? {}) : sizes;
      for (const size of wanted) {
        const label = runners[provider][a]?.[size];
        if (!label) {
          skipped.push(`${provider}/${a}-${size}`);
          continue;
        }
        const runner = { provider, arch: a, vcpus: Number(size), label };
        const cacheKey = `${provider}-${a}-${size}`;
        for (const c of caches) {
          if (c === "warm") prime.push({ ...runner, id: `${provider}/${a}-${size}`, cacheKey });
          for (let repeat = 1; repeat <= n; repeat++) {
            bench.push({ ...runner, id: `${provider}/${a}-${size}/${c}/${repeat}`, cache: c, cacheKey, repeat });
          }
        }
      }
    }
  }
  return { bench, prime, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runners = JSON.parse(readFileSync(new URL("../runners.json", import.meta.url), "utf8"));
  const env = process.env;
  const { bench, prime, skipped } = plan(runners, {
    providers: env.PROVIDERS,
    arch: env.ARCH || "x64",
    vcpus: env.VCPUS || "4",
    cache: env.CACHE || "cold",
    repeats: env.REPEATS || "3",
  });
  for (const s of skipped) console.log(`::warning::No runner for ${s}, skipped`);
  for (const p of prime) console.log(`prime ${p.id} -> ${p.label}`);
  for (const j of bench) console.log(`bench ${j.id} -> ${j.label}`);
  if (env.GITHUB_OUTPUT) {
    // An empty matrix fails the job that uses it, so `prime` gets a placeholder and `has_prime`
    // decides whether it runs at all.
    appendFileSync(
      env.GITHUB_OUTPUT,
      [
        `bench=${JSON.stringify({ include: bench })}`,
        `prime=${JSON.stringify({ include: prime.length ? prime : [{ id: "none" }] })}`,
        `has_prime=${prime.length > 0}`,
        "",
      ].join("\n"),
    );
  }
}
