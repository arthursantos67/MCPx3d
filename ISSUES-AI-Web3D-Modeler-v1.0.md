# AI Web3D Modeler — Implementation Issues

**Project:** AI Web3D Modeler  
**Plan version:** 1.0  
**PRD baseline:** `PRD-AI-Web3D-Modeler-v1.0.md`  
**Last update:** 2026-09-23<br>
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
- `performance`
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
- root npm workspace that declares every JavaScript/TypeScript package participating in source imports;
- one committed root lockfile and clean-install workflow.

### Acceptance criteria

- [ ] `apps/web` starts locally.
- [ ] `apps/api` starts locally.
- [ ] root README contains one-command/clear startup sequence.
- [ ] frontend and backend lint/typecheck commands exist.
- [ ] lockfiles are committed.
- [ ] a clean checkout can run one root install and resolve `apps/web`, `packages/agent`, and `packages/domain/ts` without pre-existing nested `node_modules`.
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
- Store Unix startup scripts with executable mode in Git.
- Start with `MCP_TRANSPORT=streamable-http`.
- Configure port and health endpoint.
- Document license/reference.

### Acceptance criteria

- [ ] `x3d_mcp` starts on documented port.
- [ ] `/pulse` or equivalent health check responds.
- [ ] `/mcp` can be reached by a test client.
- [ ] dependency revision is pinned.
- [ ] production path does not float automatically to upstream `main`.
- [ ] `./services/x3d-mcp/run.sh` runs from a clean Linux checkout without `chmod` or shell-specific workaround.
- [ ] CI verifies the executable bit and performs a bounded startup/health smoke test.

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

Operational startup:

- choose one canonical development/server entrypoint;
- remove the scaffold `api` command or make it start the FastAPI application;
- reuse the same application target in local documentation and containers.

### Acceptance criteria

- [ ] app health returns 200 when API is alive.
- [ ] MCP health reports reachable/unreachable separately.
- [ ] internal exception details are not leaked.
- [ ] settings are typed and validated at startup.
- [ ] the installed/documented API command starts the application and responds on `/api/health`.
- [ ] no official-looking entrypoint prints a scaffold greeting and exits successfully.

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
- preserve cooperative cancellation across connect and request calls.

### Acceptance criteria

- [ ] API test can create one box through MCP.
- [ ] returned scene can be serialized.
- [ ] schema validation result is captured.
- [ ] semantic validation result is captured.
- [ ] standalone HTML can be retrieved.
- [ ] failures map to typed application errors.
- [ ] transport/protocol failures are mapped without catching `BaseException`.
- [ ] task/request cancellation propagates and is never reported as `MCP_UNAVAILABLE`.

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

Contract rules:

- JSON Schema is the normative source of truth;
- Python validation must be strict (no string/boolean-to-number coercion) and forbid extra properties;
- every string `minLength`, numeric bound, enum and required field must be equivalent across runtimes.

### Acceptance criteria

- [ ] JSON Schema exists.
- [ ] example valid ModelSpec passes validation.
- [ ] negative dimensions fail.
- [ ] duplicate object IDs fail domain validation.
- [ ] schema version is explicit.
- [ ] TypeScript and Python shapes are tested for compatibility.
- [ ] fixtures rejected by the JSON Schema are also rejected by Pydantic and TypeScript validators.
- [ ] empty tags/background values and scalar coercions are covered explicitly.

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
- [ ] Python/API validation rejects schema-invalid coercions, empty constrained strings and additional properties.
- [ ] contract fixtures are shared or generated so operation requirements cannot drift between JSON Schema, Python and TypeScript.

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
- amortized or periodic cleanup of abandoned expired sessions;
- configurable global session capacity with deterministic eviction/rejection behavior.

### Acceptance criteria

- [ ] project IDs are high-entropy.
- [ ] new project starts revision 0.
- [ ] successful mutation increments exactly once.
- [ ] stale expected revision returns conflict.
- [ ] expired project returns project-not-found/expired error.
- [ ] a session that expires and is never accessed again is removed without requiring a lookup by its ID.
- [ ] repeated project creation cannot grow the in-memory store beyond its configured capacity.
- [ ] cleanup is safe while another request is reading or committing a session.

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
- basic scene background already exposed by `ModelSpec.scene.background`/`set_scene`.

### Acceptance criteria

- [ ] each primitive generates valid X3D.
- [ ] multiple primitives appear in one scene.
- [ ] stable IDs/names map to stable X3D DEF or adapter metadata where appropriate.
- [ ] no raw X3D is generated by LLM.
- [ ] unit/display scaling is documented and tested.
- [ ] a valid basic background value creates/configures an X3D `Background` node and is visible in the artifact.
- [ ] richer lighting/viewpoint controls remain outside this issue and are tracked by #54.

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

Protocol rule: schema/semantic validation is fail-closed. Empty, partial or unrecognized MCP reports are protocol failures, never implicit success.

### Acceptance criteria

- [ ] invalid candidate cannot replace last valid revision.
- [ ] validation output is structured.
- [ ] warnings are preserved.
- [ ] autofixes are recorded.
- [ ] integration test demonstrates failed candidate rollback.
- [ ] semantic success requires an explicit recognized success result.
- [ ] empty, partially parsed and unknown report formats prevent commit and produce typed diagnostics.
- [ ] diagnostic severity (`info`, `warning`, `error`) is preserved without promoting information to warnings.

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

Availability must be derived from the pinned converter's tested capability, not from the mere presence of a format name in an API constant. A known-broken format remains explicitly unavailable.

### Acceptance criteria

- [ ] `.x3dj` generated through tested conversion path.
- [ ] `.x3dv` generated through tested conversion path.
- [ ] format appears in UI only if available.
- [ ] conversion errors are isolated from base X3D artifact.
- [ ] artifact descriptors report `available=false` (or omit the format consistently) when the pinned upstream cannot produce valid output.
- [ ] capability detection is covered against the currently pinned `x3d_mcp`; `.x3dj` is not advertised until that test passes.
- [ ] one unavailable optional format never disables HTML, X3D or manifest downloads.

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
- idempotent initialization shared across repeated React lifecycle effects;
- deterministic worker/listener disposal.

### Acceptance criteria

- [ ] model initializes without API key.
- [ ] progress is observable by UI.
- [ ] main thread remains interactive.
- [ ] second load benefits from cache.
- [ ] runtime status is exposed to application state.
- [ ] concurrent/repeated `initialize()` calls share one in-flight initialization and create one active runtime.
- [ ] `dispose()` removes listeners, terminates owned workers and is safe to call more than once.

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

## Issue #20 — Clarify materially ambiguous creation and edit intent

**Labels:** `agent`, `priority:P1`

### Objective

Avoid destructive guesses when an existing target is ambiguous or when a
creation request has materially different valid interpretations.

### Scope

- distinguish an ambiguous existing target from an ambiguous requested form;
- ask one concise question when the answer changes visible structure or use,
  such as freestanding versus wall-mounted TV, or open versus closed shelf;
- keep inferring ordinary dimensions when they do not change that intent;
- let the user explicitly delegate a choice with wording such as "decide for
  me";
- preserve the question and answer as bounded conversation context.

### Acceptance criteria

- [ ] duplicate/similar name case can produce `clarify`.
- [ ] a materially ambiguous creation request can produce one `clarify` question.
- [ ] ordinary missing measurements alone do not cause an unnecessary question.
- [ ] a user may delegate a choice and receive a reasonable default plan.
- [ ] clarification does not mutate project.
- [ ] next user answer is provided with prior clarification context.
- [ ] the clarification answer is appended exactly once as the current user request.
- [ ] the assembled message order is `system → bounded history → current user`, with no duplicated adjacent user turn.
- [ ] tests cover at least 5 ambiguous prompts, including Portuguese creation requests.

### Depends on

#19, #7, #34

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
- [ ] errors follow one documented PRD envelope instead of switching between top-level fields and FastAPI `detail` wrappers.
- [ ] project-not-found/expired is machine-detectable so the frontend can offer an explicit new-session recovery flow.

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

No-effect plans (`no_change` or an empty effective operation set) terminate before candidate rendering and are returned as a successful conversational result without changing project state.

### Acceptance criteria

- [ ] valid plan commits.
- [ ] invalid domain plan fails before MCP.
- [ ] invalid X3D does not commit.
- [ ] correlation ID returned/logged.
- [ ] response includes current validation and artifact availability.
- [ ] `no_change` performs no MCP/artifact call and does not increment revision.
- [ ] artifact availability reflects tested runtime capability rather than a hardcoded list.

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
- [ ] the canonical response body is `{code, message, details, correlationId}` at the top level, matching the PRD/OpenAPI contract.
- [ ] every error path, including `AMBIGUOUS_TARGET`, returns the same correlation ID in body and `X-Correlation-Id` header and writes it to logs.
- [ ] validation errors remain actionable without leaking stack traces, secrets or provider payloads.

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
- maximum simultaneous in-memory sessions;
- request body byte limit enforced before JSON parsing.

### Acceptance criteria

- [ ] oversized plan is rejected deterministically.
- [ ] 101st object is rejected under default 100-object limit.
- [ ] NaN/Infinity cannot enter ModelSpec.
- [ ] limits are configuration-driven.
- [ ] oversized HTTP bodies are rejected before full buffering/parsing.
- [ ] project creation cannot exceed the configured session capacity.
- [ ] TTL cleanup behavior is verified independently of session lookup.

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

The controller owns one idempotent lifecycle and one canonical conversation assembly path for normal prompts and clarification follow-ups.

### Acceptance criteria

- [ ] first prompt produces ModelPlan.
- [ ] ModelPlan is locally schema-validated.
- [ ] valid plan is sent to API.
- [ ] backend result becomes assistant response.
- [ ] local agent errors are surfaced cleanly.
- [ ] React `StrictMode` effect replay creates at most one project and one AI runtime.
- [ ] controller cleanup disposes listeners/runtime resources and ignores stale async completions.
- [ ] recent user/assistant history is passed once, remains bounded, and clarification answers are not duplicated.
- [ ] initial project creation can be retried without reloading the page.
- [ ] `PROJECT_NOT_FOUND`/expiration presents an explicit new-session action and clears or restores stale state according to documented UX.

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
- [ ] the previous Blob URL remains valid until the replacement iframe source has committed and loaded (or failed deterministically).
- [ ] rapid revision changes cannot let an older async response replace a newer revision.
- [ ] unmount/error paths revoke every owned URL exactly once without blanking the current valid preview prematurely.
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
- [ ] session expiration is distinguished from a modeling failure and offers explicit project recreation.
- [ ] `no_change` keeps the same revision/artifact and does not trigger a viewer reload.

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
- [ ] a descriptor marked unavailable is disabled/hidden with a useful reason and is never requested speculatively.
- [ ] UI availability refreshes from the committed revision response, not a hardcoded format list.
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
- current pipeline stage and elapsed time for long-running generation/preview work.

### Acceptance criteria

- [ ] normal mode remains concise.
- [ ] detailed diagnostics are expandable.
- [ ] validation warnings are readable.
- [ ] `info`, `warning` and `error` remain separate in labels and counts.
- [ ] progress distinguishes provider request/retry, plan validation, API/MCP build, X3D validation, artifact generation and viewer loading.
- [ ] timings are correlated without exposing prompts, API keys or raw provider responses.
- [ ] infrastructure failure source is distinguishable.

### Depends on

#3, #16, #22, #25

---

## Issue #33 — Implement responsive workspace

**Labels:** `frontend`, `priority:P1`

### Acceptance criteria

- [x] desktop = side-by-side.
- [x] tablet/mobile = tabs or stacked panels.
- [x] chat composer stays usable.
- [x] viewer has minimum usable height.
- [x] no horizontal body overflow.

### Depends on

#25, #28

---

# EPIC G — Iterative modeling quality

## Issue #34 — Implement ModelSpec summarizer for agent context

**Labels:** `agent`, `priority:P0`

### Objective

Give the LLM enough model knowledge without sending generated HTML/X3D.

### Acceptance criteria

- [x] summary includes object IDs/names/kinds/key dimensions/transforms.
- [x] summary is bounded in size.
- [x] unrelated internal state is omitted.
- [x] follow-up modification test succeeds.
- [x] a configurable bounded window of recent user/assistant turns accompanies the summary when conversational references require it.
- [x] one shared assembler prevents duplicate insertion of the current request in normal and clarification flows.

### Depends on

#5, #19

---

## Issue #35 — Add multi-part primitive generation prompt strategy

**Labels:** `agent`, `testing`, `priority:P0`

### Objective

Improve decomposition of objects such as chair/table/shelf.

### Acceptance criteria

- [x] prompt includes decomposition guidance.
- [x] chair/table golden prompts create named parts.
- [x] generated plan stays below operation limits.
- [x] spatial conventions are consistent.

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

- [x] cancel visible during local inference.
- [x] canceled inference does not submit partial plan.
- [x] previous model remains valid.
- [x] UI returns to ready state.
- [x] cancellation propagates through frontend request, API orchestration and MCP connection/call boundaries where supported.
- [x] backend cancellation is not translated into `MCP_UNAVAILABLE` or logged as an infrastructure incident.

### Implementation note

Completed 2026-09-24 in `apps/web/src/chat/ChatController.ts`: one request-scoped `AbortController` cancels the provider and, if reached, the `POST /plans` fetch. An aborted generation returns the UI to ready without submitting its plan or replacing the prior model/preview. `X3DMcpClient.connect` now maps only ordinary connection failures to `MCP_UNAVAILABLE`; `CancelledError` propagates. `apps/web/tests/chat/ChatController.test.ts` and `apps/api/tests/test_mcp_client.py` cover both boundaries.

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
- [ ] expired sessions are collected even when their IDs are never requested again.
- [ ] creation and cleanup races cannot evict an active commit or exceed the configured capacity.

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
- [ ] shared positive/negative fixtures run against JSON Schema, Pydantic and TypeScript validators.
- [ ] rejection-equivalence covers scalar coercion, extra properties, required fields, `minLength`, enums and numeric bounds.
- [ ] `expectedRevision: "0"`, boolean/string dimensions and empty constrained strings are regression fixtures.

### Depends on

#5, #6, #7

---

## Issue #42 — Create MCP integration test suite

**Labels:** `testing`, `x3d`, `priority:P0`

### Acceptance criteria

- [x] starts test MCP service.
- [x] creates each primitive.
- [x] validates each scene.
- [x] generates X3DOM page.
- [x] tests MCP unavailable path.
- [x] tests isolated sessions.
- [x] unknown, empty and partially parseable semantic reports fail closed and prevent commit.
- [x] current pinned-converter capability is asserted, including known-unavailable `.x3dj` without breaking base artifacts.
- [x] cancellation during connect/call propagates instead of becoming `MCP_UNAVAILABLE`.

### Implementation note

Completed 2026-09-24. `apps/api/tests/conftest.py` starts the pinned Streamable HTTP MCP service; `apps/api/tests/test_mcp_integration.py` exercises every MVP primitive, schema/semantic validation, X3DOM output, unavailable transport and isolated sessions. Protocol-report, converter and cancellation regressions remain covered by the focused API tests.

### Depends on

#4, #9, #10, #11

---

## Issue #43 — Run a real-provider golden quality and latency benchmark

**Labels:** `testing`, `ai`, `priority:P0`

### Objective

Measure the configured external provider's reliability, visual decomposition
quality, and latency instead of relying on demos or deterministic mocks.

### Suite

At least 30 prompts across:

- single primitives;
- colors;
- positions;
- composed objects, including shelves, TVs, racks and cabinets;
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
- structural fidelity to the expected visible parts;
- unintended-overlap rate;
- latency;
- latency split by provider/repair, local plan validation, API, MCP scene build, X3D validation, artifact generation and viewer-ready time;
- MCP call count by object/scene complexity;
- cache hit/miss for revision artifacts.

### Acceptance criteria

- [ ] an opt-in runner executes the corpus through the configured external provider and local API/MCP stack.
- [ ] deterministic fixture tests cover the runner in CI without requiring a paid provider or credentials.
- [ ] results can be stored as JSON/Markdown.
- [ ] results identify provider/model configuration and meet documented MVP thresholds for valid plans, valid scenes and structural fidelity.
- [ ] failures are inspectable.
- [ ] each shelf/TV failure records the missing or incorrect structural part without retaining prompts, credentials or raw provider output.
- [ ] simple and composed-scene latency budgets are documented on reference hardware/network.
- [ ] benchmark output preserves correlation/stage data without prompts, credentials or private provider payloads.

### Depends on

#18, #19, #35, #42, #64, #65

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
- replace an already loaded preview and verify the old Blob URL is revoked only after the new source is active.

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
- initial project creation failure followed by retry;
- session expiration during a conversation followed by explicit recreation;
- React `StrictMode` initialization replay;
- clarification follow-up without duplicate user turn;
- new preview failure while the prior valid Blob URL remains usable.

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
- [ ] Linux instructions work from a clean checkout, including executable MCP startup script.
- [ ] exactly one canonical API startup command is documented and verified; obsolete scaffold entrypoints are removed or clearly unsupported.
- [ ] clean root dependency installation and commands for every test suite are documented.

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
- [ ] container API command uses the same canonical application entrypoint documented for local setup.

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
- [ ] build succeeds from a clean checkout after only the documented root install, with no hidden package-local `node_modules` dependency.

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
- [ ] audit remediation Issues #63–#66 are complete or any exception is explicitly documented with owner, risk and target date.

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

## Issue #54 — Add viewer navigation, zoom and camera framing

**Priority:** P1

### Objective

Make navigation useful for ordinary scenes before adding advanced scene-level
lighting controls.

### Scope

- zoom in/out controls, fit-to-scene, and independent camera reset;
- preserve normal X3DOM orbit, pan and wheel navigation;
- frame the whole validated scene after a new revision without an abrupt jump;
- reserve typed scene-level camera, viewpoint, gradient and light operations
  for a later extension.

### Acceptance criteria

- [ ] zoom controls work without requiring a mouse wheel.
- [ ] fit-to-scene frames every visible object at practical distance.
- [ ] reset camera never resets the project or changes ModelSpec.
- [ ] camera failure or an unavailable viewer API leaves normal manual navigation usable.

### Depends on

#25, #28

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

# Audit Remediation Backlog (MVP)

These issues were added after the 2026-09-22 code audit. They cover gaps that were not explicit in Issues #1–#62 and are referenced from `RELATORIO-AUDITORIA-CODIGO.md`.

## Issue #63 — Make revision artifacts atomic and cache validated output

**Labels:** `backend`, `x3d`, `performance`, `testing`, `priority:P0`

### Objective

Guarantee that every served X3D/HTML artifact belongs to the exact advertised revision and avoid rebuilding an unchanged validated scene on every preview request.

### Scope

- capture an immutable `(projectId, revision, ModelSpec)` snapshot before any asynchronous MCP work;
- store validated X3D, validation summary, capability descriptors and optional HTML by exact revision;
- reject a requested stale/future revision before work and never relabel an older result with a newer session revision;
- coalesce concurrent cache misses for the same project/revision/format into one build;
- define bounded cache size, TTL/eviction and cleanup together with project-session lifecycle;
- invalidate/create entries only on successful commit; failed candidates never replace last-valid artifacts.

### Acceptance criteria

- [x] a deterministic concurrency test interleaves preview revision N with commit N+1 and proves no cross-revision response is possible.
- [x] repeated preview/download requests for the same revision reuse validated X3D and do not call scene construction/validation again.
- [x] concurrent identical misses execute one underlying build and all callers receive the same immutable artifact.
- [x] cache keys include project, revision and format/config inputs that affect bytes.
- [x] cache memory is bounded and expired/deleted projects release artifacts.
- [x] cache failure or eviction never invalidates the last committed ModelSpec and can rebuild safely.
- [x] response metadata, filename and body all identify the same revision.

### Implementation note

Completed 2026-09-24. `ProjectSessionService.snapshot_revision` captures immutable revision inputs before artifact work awaits MCP. The bounded TTL cache uses `(project_id, revision, format)` keys and shares in-flight HTML/VRML builds. Project deletion/expiry removes its entries; failures never mutate the committed `ModelSpec`. `test_projects.py` covers revision interleaving and concurrent cache misses.

### Depends on

#8, #10, #11, #22

---

## Issue #64 — Batch scene construction and reduce MCP round-trips

**Labels:** `backend`, `x3d`, `performance`, `testing`, `priority:P1`

### Objective

Reduce the dominant post-AI latency caused by many sequential MCP transport calls for every primitive in a composed scene.

### Scope

- record baseline transport-call count and stage duration for a cube, table, chair and table+vase+chair fixture;
- prefer an upstream batch/transaction tool when available; otherwise add a wrapper-level batch command or bounded concurrency only for operations proven independent;
- preserve deterministic node order, stable DEF/name mapping, cancellation, timeout and all-or-nothing candidate behavior;
- keep one final schema/semantic validation boundary and compare generated scenes against golden expectations;
- document a safe fallback to the existing granular path when batch capability is unavailable.

### Acceptance criteria

- [x] benchmark output reports MCP calls and elapsed build time per fixture before and after the change.
- [x] the composed fixture performs at least 50% fewer transport round-trips than the recorded baseline, or a reviewed upstream limitation and alternative target are documented.
- [x] each primitive and the composed fixture remain schema/semantically valid and equivalent in visible structure/materials.
- [x] operation ordering is deterministic across repeated runs.
- [x] partial batch failure cannot commit a revision or corrupt the next isolated session.
- [x] orchestration timeout and user cancellation stop remaining batch work.

### Implementation note

Completed 2026-09-24. Compatible scenes use the upstream `compose_scene` tool once, preserving `ModelSpec` order and DEF mapping; scale/transparency use the existing granular fallback. The baseline is one reset plus ten calls per primitive, while the composed fixture records one build call and elapsed time in `test_mcp_integration.py`. The normal candidate validation/commit boundary remains all-or-nothing.

### Depends on

#4, #9, #10, #42

---

## Issue #65 — Complete end-to-end stage timing, progress and latency budgets

**Labels:** `backend`, `frontend`, `agent`, `performance`, `testing`, `priority:P1`

### Objective

Make a slow request diagnosable and show useful progress while distinguishing external AI latency from local validation, MCP construction and viewer loading.

### Stages

- provider request, transient retry and format repair as separate durations;
- local ModelPlan parse/schema validation;
- browser-to-API request, API queue/request and candidate mutation;
- MCP connect/scene construction;
- X3D schema and semantic validation;
- artifact/cache generation;
- browser fetch, Blob swap and iframe ready/error.

### Scope

- assign stable stage names and monotonic durations under one correlation ID;
- expose safe timing metadata through logs and an opt-in diagnostics response/UI path;
- publish coarse progress/status events without fabricating a percentage when total duration is unknown;
- define reference budgets for a simple primitive and a composed fixture, including retry/cache-hit dimensions;
- never log or display API keys, full prompts, provider raw responses or other secrets.

### Acceptance criteria

- [ ] one request can be traced from submit through viewer-ready using the same correlation/revision identifiers.
- [ ] diagnostics distinguish provider latency, retry backoff, format repair, browser/API request, MCP build, validation, artifact/cache and viewer load.
- [ ] UI shows the active stage and elapsed time and remains cancellable/responsive.
- [ ] cache hits and `no_change` show skipped stages rather than misleading work or zero-duration work.
- [ ] automated tests use controlled clocks/events to verify stage order, completion and error/cancel termination.
- [ ] #43 benchmark output includes per-stage p50/p95 (or raw samples when the suite is too small) and the documented budgets.

### Depends on

#22, #23, #27, #32

---

## Issue #66 — Run the complete workspace and MCP test matrix in CI

**Labels:** `infra`, `testing`, `priority:P0`

### Objective

Prevent merges that pass a partial lint/typecheck job while skipping the existing frontend, agent, domain, API and MCP regression suites.

### Required jobs

- root clean `npm ci`, then lint/typecheck/test for `apps/web`, `packages/agent` and `packages/domain/ts`;
- locked Python install, lint/typecheck/test for `apps/api` and `packages/domain/python`;
- separate Linux MCP integration job that initializes the pinned submodule, starts the service, waits on health with a timeout and always tears it down;
- production build job only where the repository policy explicitly requires/allows it;
- cache keys derived from committed lockfiles without hiding a missing dependency.

### Acceptance criteria

- [ ] every committed unit suite runs on pull requests and `main`; the job fails when a suite discovers zero tests unexpectedly.
- [ ] tests run from a clean checkout with no package-local dependency residue.
- [ ] MCP integration is isolated, bounded by health/request timeouts and uploads concise diagnostics on failure.
- [ ] the Linux job verifies `services/x3d-mcp/run.sh` is executable from Git.
- [ ] contract-equivalence fixtures from #41 and MCP protocol fixtures from #42 run in CI.
- [ ] job names and required/optional status are documented so a skipped integration job cannot look like full coverage.
- [ ] cancellation, artifact revision race, capability availability, session cleanup and Blob replacement regressions are assigned to an executing suite.

### Depends on

#1, #2, #41, #42, #63

---

## Issue #67 — Add semantic decomposition recipes for common objects

**Labels:** `agent`, `testing`, `priority:P0`

### Objective

Make common objects recognizably match their intended form instead of reducing
them to a single valid primitive.

### Scope

- provide bounded, renderer-independent decomposition recipes using only the
  existing primitive ModelPlan operations;
- cover at least an open shelf, TV on feet, wall-mounted TV, rack, cabinet and
  sofa, alongside the existing chair and table patterns;
- require stable, human-readable names and IDs for visible structural parts;
- guide sensible defaults while allowing Issue #20 to ask when the requested
  variant materially changes the result.

### Acceptance criteria

- [ ] shelf plans contain independently addressable sides and shelves, rather than one solid box.
- [ ] freestanding TV plans contain a screen, frame and feet or stand; wall-mounted variants do not invent feet.
- [ ] every recipe stays within the configured operation limit and passes ModelPlan/domain validation.
- [ ] golden fixtures assert expected parts, names, spatial relationships and valid X3D output.
- [ ] the configured provider's Issue #43 benchmark records structural-fidelity results for every recipe.

### Depends on

#19, #20, #34, #35

---

## Issue #68 — Prevent unintended geometric overlap

**Labels:** `agent`, `backend`, `testing`, `priority:P1`

### Objective

Prevent generated parts from visibly passing through each other unless that
overlap is explicitly requested or is an intentional contact.

### Scope

- calculate conservative axis-aligned bounds from ModelSpec primitives and transforms;
- distinguish allowed face contact, containment and requested overlap from unintended penetration;
- represent an explicit requested intersection with a typed operation-level flag,
  never by trusting unstructured prompt text at validation time;
- validate a candidate before commit and return concise, safe diagnostics;
- give the agent one bounded opportunity to correct a diagnosable layout failure.

### Acceptance criteria

- [ ] overlapping shelves, legs, screens or unrelated scene objects are rejected before commit.
- [ ] floor contact and a shelf resting on its side supports remain valid.
- [ ] an explicit user request to intersect or embed objects can be represented without a false failure.
- [ ] a failed overlap check preserves the last valid revision and surfaces actionable diagnostics.
- [ ] unit and integration tests cover primitive pairs, composed furniture and the correction path.

### Depends on

#7, #10, #19, #67

---

## Issue #69 — Persist a semantic scene name

**Labels:** `domain`, `agent`, `backend`, `frontend`, `priority:P1`

### Objective

Make the project's name describe the modeled scene and persist with the
semantic model instead of existing only as frontend download state.

### Scope

- add a bounded, user-editable scene title to ModelSpec and its TypeScript and
  Python schema mirrors;
- add a typed `set_scene_title` ModelPlan operation for the agent to suggest a
  title without overriding an explicit user edit;
- use the canonical title in workspace chrome, artifact filenames, manifest
  exports and bounded agent context;
- migrate unnamed scenes to a safe default title.

### Acceptance criteria

- [ ] a scene called "Wooden bookcase" remains so after reload, revision and export.
- [ ] user-renamed titles take precedence over a later agent suggestion.
- [ ] titles are normalized for filenames and never leak into executable or HTML contexts.
- [ ] JSON Schema, Python and TypeScript contracts remain equivalent and migration is tested.

### Depends on

#5, #6, #7, #14, #31

---

## Issue #70 — Optimize the external Gemini provider path from benchmark data

**Labels:** `agent`, `performance`, `testing`, `priority:P1`

### Objective

Reduce external-provider response time without trading away the structural
quality established by the benchmark.

### Scope

- compare the configured Gemini-compatible model and request settings against
  Issue #43's corpus;
- reduce avoidable prompt/context and completion-token cost while preserving
  the current scene summary and required structured-output constraints;
- identify retry and format-repair causes before changing retry policy;
- make any chosen provider/model setting explicit in user configuration and
  documentation rather than silently changing it.

### Acceptance criteria

- [ ] a before/after benchmark report compares p50/p95 provider latency, repair rate and structural fidelity.
- [ ] the selected configuration meets the documented latency budget without regressing valid-plan or valid-scene rates.
- [ ] provider errors never expose credentials, raw prompts or raw responses.
- [ ] a user can see which configured provider/model is active.

### Depends on

#43, #65, #67

---

## Recommended implementation sequence for agent quality and responsiveness

`#65 -> #43 -> #20 -> #67 -> #68 -> #69 -> #54 -> #70`

Issue #36 remains useful for invalid X3D repair, but is not in this sequence:
a technically valid solid-box TV or shelf does not trigger an X3D repair loop.

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

`#24, #36–#40, #44–#50, #63–#66`

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
- [ ] linked audit finding updated with the implementing issue/test evidence when applicable;
- [ ] PRD updated if the implemented behavior intentionally differs from the baseline;
- [ ] no hardcoded secret/API key introduced;
- [ ] no arbitrary LLM code execution introduced.
