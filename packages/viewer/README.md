# packages/viewer

Sandboxed X3D preview iframe, camera reset, scene reload, and viewer error handling.

Still not a real package here (no `package.json`/`src`). Issue #28 (X3D preview iframe component) implemented the sandboxed-iframe/Blob-URL piece as `apps/web/src/viewer/X3DPreviewFrame.tsx` and `objectUrl.ts` instead, mirroring how `apps/web/src/workspace/WorkspaceShell.tsx` (Issue #25) also lives directly in `apps/web` rather than a separate package -- Issue #28 is `frontend`-labeled only, and bootstrapping a real npm package (its own `package.json`, tsconfig, `node_modules`, test runner) for one component was infra scope beyond what it asked for. See `PRD-AI-Web3D-Modeler-v1.0.md` §10.3's Issue #28 implementation note for the full detail. This directory remains where that component would move if/when camera reset, scene reload, or a second consumer besides `apps/web` make a standalone package worth the overhead.
