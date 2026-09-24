# Golden benchmark

The suite is run with the configured external Gemini-compatible reference provider and a local API/MCP service; it does not require WebGPU or Issue #17's local-model selection. It contains 30 English and Portuguese requests covering primitives, colours, position, composed objects, follow-ups, deletion, duplication, and ambiguity.

For each case the runner records only case ID, outcome, correlation ID, revision, safe API stage durations, total latency, and MCP call count. Prompts, credentials, and raw provider output are deliberately excluded from result files.

Reference budgets on a developer machine with a warmed local MCP service are: a simple primitive p95 below 10 seconds; a composed fixture p95 below 30 seconds; cache-hit artifact generation p95 below 2 seconds. Provider and retry time are reported separately and are not treated as a local-MCP regression.

Use raw samples when fewer than 20 observations exist; otherwise report p50 and p95 per stage. A provider meets the MVP gate when at least 95% of its plans are valid, at least 90% produce an X3D-valid scene, and all ambiguity cases return a clarification rather than mutate a scene.
