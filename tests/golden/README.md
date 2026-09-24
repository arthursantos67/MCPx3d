# tests/golden

Golden prompts and their expected structural properties, used to measure agent reliability (valid JSON plan rate, domain-valid plan rate, X3D-valid final scene rate, correct target rate, repair count, latency).

`multipart-furniture.json` contains the Issue #35 chair/table fixtures. `packages/agent/tests/multipart-generation.test.ts` validates their named primitive parts, operation count, and ModelPlan/domain compatibility with the deterministic mock provider. Broader provider-quality benchmarking remains Issue #43.
# Benchmark suite

`benchmark-prompts.json` is the stable, 30-case prompt corpus for Issue #43. `benchmark-report.md` documents the reference budgets, metrics, and privacy boundary. Runtime output must include only case IDs and safe timing/correlation metadata.
