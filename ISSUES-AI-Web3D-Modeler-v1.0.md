# AI Web3D Modeler — Implementation Issues

**Project:** AI Web3D Modeler  
**Plan version:** 1.0  
**PRD baseline:** `PRD-AI-Web3D-Modeler-v1.0.md`  
**Last update:** 2026-09-21  
**Target milestone:** MVP `v0.1.0`

---

## How to use this file

Each section below can become one GitHub Issue.

Recommended labels:

- `epic`
- `frontend`
- `backend`
- `agent`
- `ai`
- `x3d`
- `infra`
- `security`
- `testing`
- `docs`
- `priority:P0`
- `priority:P1`
- `priority:P2`
- `blocked`
- `spike`

Priority meanings:

- **P0:** required to prove or ship the MVP.
- **P1:** required for a reliable/polished MVP.
- **P2:** useful follow-up; may be deferred.

Suggested implementation order is encoded by issue number and dependency notes.

---

# EPIC A — Foundation and technical proof

## Issue #1 — Bootstrap monorepo and development conventions

**Labels:** `epic`, `infra`, `priority:P0`

### Objective

Create the repository structure and baseline tooling for frontend, API, shared schemas, tests, and documentation.

### Scope

Create:

```text
apps/web
apps/api
packages/domain
packages/agent
packages/viewer
services/
tests/golden
docs/
```

Configure:

- root README;
- `.editorconfig`;
- frontend package manager and lockfile;
- Python `uv` project;
- environment examples;
- formatting/linting;
- basic CI skeleton.

### Acceptance criteria

- [ ] `apps/web` starts locally.
- [ ] `apps/api` starts locally.
- [ ] root README contains one-command/clear startup sequence.
- [ ] frontend and backend lint/typecheck commands exist.
- [ ] lockfiles are committed.
- [ ] no AI API key is required for baseline startup.

### Depends on

None.

---

## Issue #2 — Pin and run `x3d_mcp` in Streamable HTTP mode

**Labels:** `x3d`, `infra`, `priority:P0`

### Objective

Establish the upstream X3D service as a reproducible dependency.

### Scope

- Choose and record tested upstream commit/tag.
- Add setup script or git-submodule/vendor strategy.
- Start with `MCP_TRANSPORT=streamable-http`.
- Configure port and health endpoint.
- Document license/reference.

### Acceptance criteria

- [ ] `x3d_mcp` starts on documented port.
- [ ] `/pulse` or equivalent health check responds.
- [ ] `/mcp` can be reached by a test client.
- [ ] dependency revision is pinned.
- [ ] production path does not float automatically to upstream `main`.

### Depends on

#1

---

## Issue #3 — Implement FastAPI health and configuration layer

**Labels:** `backend`, `infra`, `priority:P0`

### Objective

Create API service configuration and dependency health checks.

### Scope

Environment/settings:

- MCP base URL;
- request timeout;
- session TTL;
- complexity limits;
- CORS origins;
- development mode.

Endpoints:

- `GET /api/health`
- `GET /api/health/mcp`

### Acceptance criteria

- [ ] app health returns 200 when API is alive.
- [ ] MCP health reports reachable/unreachable separately.
- [ ] internal exception details are not leaked.
- [ ] settings are typed and validated at startup.

### Depends on

#1, #2

---

## Issue #4 — Build minimal MCP client wrapper

**Labels:** `backend`, `x3d`, `priority:P0`

### Objective

Hide MCP protocol details behind an application service.

### Scope

Create `X3DMcpClient` with methods sufficient for spike:

- create/reset scene;
- create primitive;
- get scene;
- validate current scene;
- semantic validate;
- generate X3DOM page.

### Acceptance criteria

- [ ] API test can create one box through MCP.
- [ ] returned scene can be serialized.
- [ ] schema validation result is captured.
- [ ] semantic validation result is captured.
- [ ] standalone HTML can be retrieved.
- [ ] failures map to typed application errors.

### Depends on

#2, #3

---

# EPIC B — Domain model and safe command layer

## Issue #5 — Define ModelSpec v1 JSON Schema

**Labels:** `backend`, `frontend`, `agent`, `priority:P0`

### Objective

Create the renderer-independent semantic model.

### Scope

Define:

- schema version;
- project/revision;
- units;
- scene metadata;
- primitive object;
- dimensions;
- transform;
- material;
- tags.

Generate/maintain TypeScript and Python-compatible types.

### Acceptance criteria

- [ ] JSON Schema exists.
- [ ] example valid ModelSpec passes validation.
- [ ] negative dimensions fail.
- [ ] duplicate object IDs fail domain validation.
- [ ] schema version is explicit.
- [ ] TypeScript and Python shapes are tested for compatibility.

### Depends on

#1

---

## Issue #6 — Define ModelPlan v1 operation schema

**Labels:** `agent`, `backend`, `priority:P0`

### Objective

Define the only operations the AI is allowed to propose.

### Operations

- `create_object`
- `delete_object`
- `duplicate_object`
- `set_dimensions`
- `translate_object`
- `rotate_object`
- `scale_object`
- `set_material`
- `rename_object`
- `set_scene`
- `clarify`
- `no_change`

### Acceptance criteria

- [ ] JSON Schema validates every operation.
- [ ] unknown operations are rejected.
- [ ] executable-code fields do not exist.
- [ ] target requirements are operation-specific.
- [ ] examples exist for creation and modification plans.

### Depends on

#5

---

## Issue #7 — Implement deterministic ModelSpec mutation engine

**Labels:** `backend`, `priority:P0`

### Objective

Apply ModelPlan to ModelSpec without AI code execution.

### Scope

- immutable/candidate mutation pattern;
- ID generation;
- target lookup;
- dimension validation;
- transform validation;
- material normalization;
- plan operation ordering.

### Acceptance criteria

- [ ] all MVP operations have unit tests.
- [ ] invalid target does not mutate state.
- [ ] failed operation rolls back whole plan.
- [ ] object IDs remain immutable.
- [ ] candidate ModelSpec is returned separately from committed ModelSpec.

### Depends on

#5, #6

---

## Issue #8 — Implement project session and revision service

**Labels:** `backend`, `priority:P0`

### Objective

Own temporary project state safely.

### Scope

- create project;
- get project;
- reset/delete;
- session TTL;
- revision;
- expected-revision conflict.

### Acceptance criteria

- [ ] project IDs are high-entropy.
- [ ] new project starts revision 0.
- [ ] successful mutation increments exactly once.
- [ ] stale expected revision returns conflict.
- [ ] expired project returns project-not-found/expired error.

### Depends on

#5, #7

---

# EPIC C — X3D adapter and artifacts

## Issue #9 — Implement ModelSpec → X3D primitive adapter

**Labels:** `x3d`, `backend`, `priority:P0`

### Objective

Render ModelSpec primitives through `x3d_mcp`.

### Primitive mapping

- box;
- sphere;
- cylinder;
- cone.

Map:

- dimensions;
- position;
- rotation;
- scale;
- base color.

### Acceptance criteria

- [ ] each primitive generates valid X3D.
- [ ] multiple primitives appear in one scene.
- [ ] stable IDs/names map to stable X3D DEF or adapter metadata where appropriate.
- [ ] no raw X3D is generated by LLM.
- [ ] unit/display scaling is documented and tested.

### Depends on

#4, #5

---

## Issue #10 — Implement full candidate validation pipeline

**Labels:** `x3d`, `backend`, `priority:P0`

### Objective

Ensure no invalid scene becomes current.

### Pipeline

1. build candidate scene;
2. schema validate;
3. semantic validate;
4. optional known autofix;
5. revalidate;
6. commit only on success.

### Acceptance criteria

- [ ] invalid candidate cannot replace last valid revision.
- [ ] validation output is structured.
- [ ] warnings are preserved.
- [ ] autofixes are recorded.
- [ ] integration test demonstrates failed candidate rollback.

### Depends on

#9

---

## Issue #11 — Implement X3DOM standalone HTML artifact

**Labels:** `x3d`, `backend`, `priority:P0`

### Objective

Create browser-viewable HTML for each valid revision.

### Acceptance criteria

- [ ] uses upstream `x3dom_page` or vetted equivalent.
- [ ] resulting HTML renders a known test scene.
- [ ] artifact corresponds to current revision.
- [ ] content type and filename are correct.
- [ ] generation failure does not invalidate X3D revision.

### Depends on

#10

---

## Issue #12 — Implement X3D XML download

**Labels:** `backend`, `x3d`, `priority:P0`

### Objective

Allow downloading `.x3d`.

### Acceptance criteria

- [ ] valid scene downloads as `.x3d`.
- [ ] normalized filename includes project name/revision.
- [ ] downloaded content re-validates.
- [ ] stale artifact is never silently returned.

### Depends on

#10

---

## Issue #13 — Implement X3DJ and X3DV optional conversion downloads

**Labels:** `backend`, `x3d`, `priority:P1`

### Objective

Expose supported alternative X3D encodings.

### Acceptance criteria

- [ ] `.x3dj` generated through tested conversion path.
- [ ] `.x3dv` generated through tested conversion path.
- [ ] format appears in UI only if available.
- [ ] conversion errors are isolated from base X3D artifact.

### Depends on

#10

---

## Issue #14 — Implement ModelSpec manifest export

**Labels:** `backend`, `priority:P0`

### Objective

Preserve semantic model independently from X3D.

### Acceptance criteria

- [ ] downloads current ModelSpec JSON.
- [ ] includes schemaVersion.
- [ ] includes revision and units.
- [ ] output passes ModelSpec schema.
- [ ] export does not include internal server secrets/session implementation details.

### Depends on

#5, #8

---

# EPIC D — Local AI runtime

## Issue #15 — Add WebGPU capability detection

**Labels:** `frontend`, `ai`, `priority:P0`

### Objective

Determine whether default local AI mode can run.

### Acceptance criteria

- [ ] supported browser reports ready-capable state.
- [ ] unsupported browser receives clear state/message.
- [ ] detection runs before large model download.
- [ ] error text does not imply the whole 3D viewer is unsupported.

### Depends on

#1

---

## Issue #16 — Integrate WebLLM in a Web Worker

**Labels:** `frontend`, `ai`, `priority:P0`

### Objective

Load and run the local LLM without blocking UI.

### Scope

- WebLLM package;
- selected recommended model;
- progress callback;
- browser cache;
- Web Worker engine;
- cancellation if supported.

### Acceptance criteria

- [ ] model initializes without API key.
- [ ] progress is observable by UI.
- [ ] main thread remains interactive.
- [ ] second load benefits from cache.
- [ ] runtime status is exposed to application state.

### Depends on

#15

---

## Issue #17 — Benchmark and choose recommended local model

**Labels:** `ai`, `testing`, `spike`, `priority:P0`

### Objective

Select the default WebLLM model based on actual ModelPlan quality.

### Candidate criteria

- available/supported in current WebLLM;
- practical quantized download size;
- structured JSON reliability;
- English + Portuguese prompt handling;
- spatial decomposition quality;
- latency on reference hardware.

### Test prompts

Use initial golden set from PRD Appendix E plus at least 20 additional prompts.

### Acceptance criteria

- [ ] at least 2 candidate models benchmarked.
- [ ] results recorded in `docs/model-benchmark.md`.
- [ ] one model selected as default.
- [ ] fallback smaller model documented.
- [ ] selection is configuration, not hardcoded throughout UI.

### Depends on

#16, #6

---

## Issue #18 — Implement `LLMProvider` abstraction

**Labels:** `agent`, `frontend`, `priority:P0`

### Objective

Prevent coupling domain logic to WebLLM.

### Acceptance criteria

- [ ] provider interface exists.
- [ ] `WebLLMProvider` implements it.
- [ ] agent runtime depends only on interface.
- [ ] provider exposes availability/init/structured-generation state.
- [ ] mock provider is available for deterministic tests.

### Depends on

#16

---

## Issue #19 — Implement structured ModelPlan generation

**Labels:** `agent`, `ai`, `priority:P0`

### Objective

Convert user request + current model summary into schema-constrained ModelPlan.

### Scope

- system prompt;
- ModelPlan JSON Schema;
- current ModelSpec summary;
- JSON mode/schema where supported;
- parse/validate;
- one repair retry.

### Acceptance criteria

- [ ] “create a red cube” returns valid create operation.
- [ ] modification request targets existing IDs.
- [ ] unknown operation output is rejected.
- [ ] malformed JSON gets at most one format-repair retry.
- [ ] agent never sends code to backend.

### Depends on

#6, #17, #18

---

## Issue #20 — Implement ambiguity/clarification behavior

**Labels:** `agent`, `priority:P1`

### Objective

Avoid destructive guesses on ambiguous part references.

### Acceptance criteria

- [ ] duplicate/similar name case can produce `clarify`.
- [ ] clarification does not mutate project.
- [ ] next user answer is provided with prior clarification context.
- [ ] tests cover at least 5 ambiguous prompts.

### Depends on

#19, #7

---

# EPIC E — Backend application API

## Issue #21 — Implement project REST endpoints

**Labels:** `backend`, `priority:P0`

### Endpoints

- create;
- get;
- reset/delete.

### Acceptance criteria

- [ ] contracts match PRD Section 9.
- [ ] OpenAPI generated.
- [ ] session/revision metadata returned.
- [ ] error codes standardized.

### Depends on

#8

---

## Issue #22 — Implement apply-ModelPlan orchestration endpoint

**Labels:** `backend`, `agent`, `x3d`, `priority:P0`

### Objective

Create the central mutation transaction.

### Flow

1. validate request;
2. check expected revision;
3. create candidate ModelSpec;
4. render X3D;
5. validate;
6. commit;
7. generate artifact descriptors.

### Acceptance criteria

- [ ] valid plan commits.
- [ ] invalid domain plan fails before MCP.
- [ ] invalid X3D does not commit.
- [ ] correlation ID returned/logged.
- [ ] response includes current validation and artifact availability.

### Depends on

#7, #8, #10, #11, #14

---

## Issue #23 — Standardize backend errors

**Labels:** `backend`, `priority:P1`

### Objective

Implement PRD error codes consistently.

### Acceptance criteria

- [ ] custom exception mapping exists.
- [ ] no stack trace in production response.
- [ ] 409 revision conflict is distinct.
- [ ] MCP failure maps to 503.
- [ ] validation failure maps to structured 422.

### Depends on

#21, #22

---

## Issue #24 — Add complexity and request limits

**Labels:** `backend`, `security`, `priority:P1`

### Scope

- max prompt/plan size;
- max operations;
- max objects;
- numeric bounds;
- artifact size;
- session TTL.

### Acceptance criteria

- [ ] oversized plan is rejected deterministically.
- [ ] 101st object is rejected under default 100-object limit.
- [ ] NaN/Infinity cannot enter ModelSpec.
- [ ] limits are configuration-driven.

### Depends on

#22

---

# EPIC F — Main web workspace

## Issue #25 — Build desktop modeling workspace shell

**Labels:** `frontend`, `priority:P0`

### Objective

Implement side-by-side chat + viewer layout.

### Acceptance criteria

- [ ] chat and viewer share main viewport.
- [ ] desktop page itself has no unnecessary body scroll.
- [ ] chat history scrolls independently.
- [ ] viewer keeps practical minimum size.
- [ ] top bar/status bar placeholders exist.

### Depends on

#1

---

## Issue #26 — Build ChatPanel and prompt composer

**Labels:** `frontend`, `priority:P0`

### Acceptance criteria

- [ ] user can send prompt.
- [ ] multiline/keyboard behavior implemented.
- [ ] user/assistant messages render.
- [ ] loading/generation state renders.
- [ ] submit is protected against accidental duplicate sends.

### Depends on

#25

---

## Issue #27 — Connect chat to local agent runtime

**Labels:** `frontend`, `agent`, `priority:P0`

### Objective

Wire user prompt to WebLLM ModelPlan generation.

### Acceptance criteria

- [ ] first prompt produces ModelPlan.
- [ ] ModelPlan is locally schema-validated.
- [ ] valid plan is sent to API.
- [ ] backend result becomes assistant response.
- [ ] local agent errors are surfaced cleanly.

### Depends on

#19, #22, #26

---

## Issue #28 — Build X3D preview iframe component

**Labels:** `frontend`, `x3d`, `security`, `priority:P0`

### Objective

Render current standalone X3DOM HTML safely.

### Acceptance criteria

- [ ] sandboxed iframe is used.
- [ ] current validated revision renders.
- [ ] old Blob/object URLs are revoked.
- [ ] viewer error state is visible.
- [ ] no generated HTML is inserted directly into parent DOM.

### Depends on

#11, #25

---

## Issue #29 — Implement last-valid-scene behavior

**Labels:** `frontend`, `backend`, `x3d`, `priority:P0`

### Objective

Preserve usable model if a new request fails.

### Acceptance criteria

- [ ] failed generation leaves viewer on prior valid revision.
- [ ] status clearly says latest request failed.
- [ ] revision badge does not increment.
- [ ] retry from same valid state is possible.

### Depends on

#22, #27, #28

---

## Issue #30 — Implement download menu

**Labels:** `frontend`, `priority:P0`

### Scope

- HTML;
- X3D;
- project manifest;
- X3DJ/X3DV conditionally.

### Acceptance criteria

- [ ] only available formats are enabled.
- [ ] filename uses normalized project name.
- [ ] current revision is clear.
- [ ] downloads succeed through browser.

### Depends on

#11, #12, #13, #14, #25

---

## Issue #31 — Add project naming and reset flow

**Labels:** `frontend`, `priority:P1`

### Acceptance criteria

- [ ] user can rename project.
- [ ] filename sanitization is applied.
- [ ] reset asks confirmation when appropriate.
- [ ] reset clears model and viewer.
- [ ] AI conversation state is reset or explicitly archived according to implemented UX.

### Depends on

#21, #25

---

## Issue #32 — Add status bar and diagnostics panel

**Labels:** `frontend`, `priority:P1`

### Show

- AI provider/model;
- AI readiness;
- MCP health;
- X3D validity;
- revision;
- warnings/autofixes;
- correlation ID.

### Acceptance criteria

- [ ] normal mode remains concise.
- [ ] detailed diagnostics are expandable.
- [ ] validation warnings are readable.
- [ ] infrastructure failure source is distinguishable.

### Depends on

#3, #16, #22, #25

---

## Issue #33 — Implement responsive workspace

**Labels:** `frontend`, `priority:P1`

### Acceptance criteria

- [ ] desktop = side-by-side.
- [ ] tablet/mobile = tabs or stacked panels.
- [ ] chat composer stays usable.
- [ ] viewer has minimum usable height.
- [ ] no horizontal body overflow.

### Depends on

#25, #28

---

# EPIC G — Iterative modeling quality

## Issue #34 — Implement ModelSpec summarizer for agent context

**Labels:** `agent`, `priority:P0`

### Objective

Give the LLM enough model knowledge without sending generated HTML/X3D.

### Acceptance criteria

- [ ] summary includes object IDs/names/kinds/key dimensions/transforms.
- [ ] summary is bounded in size.
- [ ] unrelated internal state is omitted.
- [ ] follow-up modification test succeeds.

### Depends on

#5, #19

---

## Issue #35 — Add multi-part primitive generation prompt strategy

**Labels:** `agent`, `testing`, `priority:P0`

### Objective

Improve decomposition of objects such as chair/table/shelf.

### Acceptance criteria

- [ ] prompt includes decomposition guidance.
- [ ] chair/table golden prompts create named parts.
- [ ] generated plan stays below operation limits.
- [ ] spatial conventions are consistent.

### Depends on

#19, #34

---

## Issue #36 — Add controlled validation repair loop

**Labels:** `agent`, `backend`, `x3d`, `priority:P1`

### Objective

Recover from fixable X3D failures without infinite loops.

### Acceptance criteria

- [ ] autofix runs before LLM repair where appropriate.
- [ ] concise diagnostics can be supplied to agent.
- [ ] max repair iteration = configurable, default 2.
- [ ] loop termination is tested.
- [ ] prior valid revision remains intact on failure.

### Depends on

#10, #19, #22

---

## Issue #37 — Add generation cancellation

**Labels:** `frontend`, `ai`, `priority:P1`

### Acceptance criteria

- [ ] cancel visible during local inference.
- [ ] canceled inference does not submit partial plan.
- [ ] previous model remains valid.
- [ ] UI returns to ready state.

### Depends on

#16, #27

---

# EPIC H — Security and hardening

## Issue #38 — Audit all LLM output execution boundaries

**Labels:** `security`, `priority:P0`

### Objective

Prove the LLM cannot execute arbitrary code.

### Checklist

- no `eval`;
- no `exec`;
- no shell;
- no arbitrary import;
- no raw JS injection;
- no arbitrary filesystem path;
- no user-defined backend URL/tool.

### Acceptance criteria

- [ ] documented audit exists.
- [ ] static/code search confirms prohibited patterns absent in agent flow.
- [ ] malicious ModelPlan samples are rejected.
- [ ] security tests added.

### Depends on

#6, #22, #28

---

## Issue #39 — Add API rate/resource limiting for public deployment

**Labels:** `security`, `backend`, `priority:P1`

### Acceptance criteria

- [ ] configurable request rate limit.
- [ ] session TTL cleanup.
- [ ] body size limits.
- [ ] MCP timeout enforced.
- [ ] public abuse cannot create unbounded in-memory sessions.

### Depends on

#24

---

## Issue #40 — Harden preview iframe and CSP

**Labels:** `security`, `frontend`, `priority:P1`

### Objective

Isolate standalone viewer HTML from application origin.

### Acceptance criteria

- [ ] iframe sandbox policy documented/tested.
- [ ] no `allow-same-origin` unless justified.
- [ ] application CSP documented.
- [ ] viewer still loads required X3DOM assets.
- [ ] malicious string fields cannot escape into parent DOM.

### Depends on

#28

---

# EPIC I — Testing and release confidence

## Issue #41 — Create unit tests for ModelSpec and ModelPlan

**Labels:** `testing`, `backend`, `priority:P0`

### Acceptance criteria

- [ ] every operation tested.
- [ ] boundary numeric tests.
- [ ] duplicate/unknown target tests.
- [ ] schema version tests.
- [ ] rollback tests.

### Depends on

#5, #6, #7

---

## Issue #42 — Create MCP integration test suite

**Labels:** `testing`, `x3d`, `priority:P0`

### Acceptance criteria

- [ ] starts test MCP service.
- [ ] creates each primitive.
- [ ] validates each scene.
- [ ] generates X3DOM page.
- [ ] tests MCP unavailable path.
- [ ] tests isolated sessions.

### Depends on

#4, #9, #10, #11

---

## Issue #43 — Create golden prompt benchmark suite

**Labels:** `testing`, `ai`, `priority:P0`

### Objective

Measure agent reliability instead of relying on demos.

### Suite

At least 30 prompts across:

- single primitives;
- colors;
- positions;
- composed objects;
- follow-up modifications;
- deletions;
- duplication;
- ambiguity;
- Portuguese and English.

### Metrics

- valid JSON plan rate;
- domain-valid plan rate;
- X3D-valid final scene rate;
- correct target rate;
- repair count;
- latency.

### Acceptance criteria

- [ ] benchmark runner exists.
- [ ] results can be stored as JSON/Markdown.
- [ ] reference model meets documented MVP threshold.
- [ ] failures are inspectable.

### Depends on

#17, #19, #35, #42

---

## Issue #44 — Add frontend E2E happy-path tests

**Labels:** `testing`, `frontend`, `priority:P1`

### Scenarios

- create project;
- mocked/local deterministic agent produces cube;
- viewer loads artifact;
- modify part;
- download artifact;
- reset.

### Acceptance criteria

- [ ] tests run in CI without requiring paid API.
- [ ] core UI regression is detectable.
- [ ] AI can be mocked for deterministic CI.

### Depends on

#27, #28, #30, #31

---

## Issue #45 — Add failure-path E2E tests

**Labels:** `testing`, `priority:P1`

### Scenarios

- WebGPU unavailable;
- MCP unavailable;
- invalid ModelPlan;
- validation failure;
- revision conflict;
- artifact failure.

### Acceptance criteria

- [ ] each failure has user-visible state.
- [ ] no blank/white screen.
- [ ] last valid model preserved where applicable.

### Depends on

#23, #29, #32

---

# EPIC J — Documentation and deployment

## Issue #46 — Write developer setup guide

**Labels:** `docs`, `priority:P0`

### Acceptance criteria

- [ ] prerequisites listed.
- [ ] frontend/API/MCP startup documented.
- [ ] no LLM key required for default mode.
- [ ] common WebGPU issues documented.
- [ ] tested OS/browser baseline listed.

### Depends on

#1, #2, #16

---

## Issue #47 — Create Docker setup for API + MCP

**Labels:** `infra`, `priority:P1`

### Objective

Make backend dependencies reproducible.

### Acceptance criteria

- [ ] API image builds.
- [ ] MCP image/pinned build runs.
- [ ] docker compose starts both.
- [ ] API reaches MCP by service name.
- [ ] health checks defined.

### Depends on

#2, #3, #4

---

## Issue #48 — Configure production frontend build and hosting notes

**Labels:** `infra`, `frontend`, `priority:P1`

### Acceptance criteria

- [ ] optimized build succeeds.
- [ ] environment API URL supported.
- [ ] WebLLM model/CORS requirements documented.
- [ ] SPA routing works on chosen static host.
- [ ] CSP/viewer requirements documented.

### Depends on

#25, #40

---

## Issue #49 — Add dependency/license notices

**Labels:** `docs`, `infra`, `priority:P1`

### Acceptance criteria

- [ ] `x3d_mcp` license notice included as required.
- [ ] WebLLM license recorded.
- [ ] X3DOM/X_ITE licenses recorded.
- [ ] dependency report generated/documented.

### Depends on

#2, #16

---

## Issue #50 — MVP release checklist and `v0.1.0`

**Labels:** `epic`, `priority:P0`

### Objective

Verify all PRD MVP exit criteria.

### Acceptance criteria

- [ ] P0 issues complete.
- [ ] required P1 reliability/security issues complete or explicitly accepted as release exceptions.
- [ ] golden benchmark target met.
- [ ] clean checkout setup verified.
- [ ] production build verified.
- [ ] downloadable HTML/X3D verified on second machine/browser.
- [ ] README product limitations clearly state Web3D ≠ CAD/manufacturing.
- [ ] release notes published.
- [ ] tag `v0.1.0` created.

### Depends on

All MVP blocking issues.

---

# Post-MVP Backlog

## Issue #51 — Import ModelSpec manifest

**Priority:** P2

Import a previously downloaded project manifest, run migrations/schema validation, rebuild X3D, and restore project.

---

## Issue #52 — Add undo/redo revision history

**Priority:** P2

Maintain bounded semantic revision history rather than only current state.

---

## Issue #53 — Add direct X3D import/audit

**Priority:** P2

Use upstream validation/audit tools to inspect an uploaded X3D document and convert supported structure into project state where feasible.

---

## Issue #54 — Add richer X3D lighting/viewpoint controls

**Priority:** P2

Expose safe scene-level ModelPlan operations for camera, viewpoint, background, and lights.

---

## Issue #55 — Add animation operations

**Priority:** P2

Add typed animation intents backed by `TimeSensor`, interpolators, and ROUTE generation.

---

## Issue #56 — Add visual part selection

**Priority:** P2

Allow clicking a part in the viewer to make it the active conversational target.

---

## Issue #57 — Research mesh export pipeline

**Priority:** P2, `spike`

Evaluate glTF/GLB/OBJ/STL conversion approaches, licensing, fidelity, and manifold validation.

---

## Issue #58 — Implement glTF/GLB export

**Priority:** P2

Only after a tested conversion/renderer strategy exists.

---

## Issue #59 — Implement STL export with topology validation

**Priority:** P2

Do not expose as manufacturing-ready until mesh validity/manifold requirements are defined and tested.

---

## Issue #60 — Design ParametricModel v2 for CAD migration

**Priority:** P2, `spike`

Define sketches, features, constraints, booleans, fillets, holes, patterns, and feature history without breaking ModelSpec v1 imports.

---

## Issue #61 — Build CadQuery/OpenCascade adapter spike

**Priority:** P2, `spike`

Convert a constrained ParametricModel subset to CadQuery and export STEP/STL.

---

## Issue #62 — Add STEP export through CAD adapter

**Priority:** P2

Only after CAD geometry correctness and feature representation are validated.

---

# Recommended Milestones

## Milestone M0 — Vertical Slice

Issues:

`#1–#4, #5–#6, #9–#12, #15–#16, #19, #21–#22, #25–#28`

Exit demo:

> User types “Create a red cube” → local LLM returns structured plan → backend creates/validates X3D → cube appears beside chat → user downloads HTML/X3D.

## Milestone M1 — Conversational MVP

Add:

`#7–#8, #14, #17–#18, #20, #23, #26–#35, #41–#43, #46`

Exit demo:

> User asks for a chair → system builds named parts → user says “make the legs thicker” → only legs change → validated model remains downloadable.

## Milestone M2 — MVP Hardening

Add:

`#24, #36–#40, #44–#50`

Exit:

Release-ready `v0.1.0`.

---

# Suggested first 10 implementation issues

If implementation starts immediately, execute in this order:

1. #1 Bootstrap monorepo
2. #2 Pin/run `x3d_mcp`
3. #3 FastAPI health/config
4. #4 MCP client wrapper
5. #5 ModelSpec schema
6. #6 ModelPlan schema
7. #15 WebGPU detection
8. #16 WebLLM worker integration
9. #9 ModelSpec → X3D primitive adapter
10. #10 X3D validation pipeline

After these, implement #11, #12, #19, #22, #25–#28 to complete the vertical slice.

---

# Definition of Done for every implementation issue

Unless an issue explicitly states otherwise, “done” means:

- [ ] behavior implemented;
- [ ] relevant unit/integration tests added;
- [ ] errors handled;
- [ ] no new lint/typecheck failures;
- [ ] public contract documented if changed;
- [ ] PRD updated if the implemented behavior intentionally differs from the baseline;
- [ ] no hardcoded secret/API key introduced;
- [ ] no arbitrary LLM code execution introduced.
