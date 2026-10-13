# tests/golden

Golden prompts and their expected structural properties, used to measure agent reliability (valid JSON plan rate, domain-valid plan rate, X3D-valid final scene rate, correct target rate, repair count, latency).

`multipart-furniture.json` contains the Issue #35 chair/table fixtures. `packages/agent/tests/multipart-generation.test.ts` validates their named primitive parts, operation count, and ModelPlan/domain compatibility with the deterministic mock provider. Broader provider-quality benchmarking remains Issue #43.
# Benchmark suite

`benchmark-prompts.json` is the stable, 32-case prompt corpus for Issues #43 and #71. `benchmark-report.md` documents the reference budgets, metrics, and privacy boundary. Runtime output must include only case IDs and safe timing/correlation metadata.

`cad-benchmark-prompts.json` is the 16-case CAD requirement corpus. `cad-benchmark-metrics.test.mjs` checks recipe fidelity, measured geometry, export delivery and the exact one-sided confidence bound. Run `npm run benchmark:cad -- --run --suite` with the local API and an authenticated Codex client; this makes real model calls. `--case` accepts comma-separated IDs. Set `CAD_BENCHMARK_OUTPUT` to retain distinct rounds and `CAD_BENCHMARK_MODEL` to choose a model. The [recorded evaluation](../../docs/project-improvements-2026-10-08.md) preserves failed trials and does not establish general 99% reliability.
