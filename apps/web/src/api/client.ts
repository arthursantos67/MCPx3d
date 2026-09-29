/**
 * Thin `fetch` wrapper for the `apps/api` REST surface this chat UI needs
 * (PRD §9.1/§9.2/§9.3, Issue #27): create a project session and apply a
 * `ModelPlan`. Every error response from `apps/api` -- both `api_error` and
 * `error_response` in `apps/api/src/api/errors.py` -- shares the same
 * `{code, message, details, correlationId}` body (PRD §9.4);
 * `ApiError` below is that shape parsed into a typed, throwable error so
 * callers (`useChatController`) can surface it cleanly instead of a raw
 * `Response`.
 */

import type { ModelPlan } from "../../../../packages/domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";
import { type CadPartSpec, validateCadPartDomainRules } from "../../../../packages/domain/ts/src/cad-part.ts";
import { type CadProgramSpec, validateCadProgram } from "../../../../packages/domain/ts/src/cad-program.ts";
import { type CadEditPlan, type CadOperation, type CadParameter, validateCadEditPlan } from "../../../../packages/domain/ts/src/cad-plan.ts";

export interface ValidationSummary {
  readonly schemaValid: boolean;
  readonly semanticValid: boolean;
  readonly warnings: readonly { check: string; message: string }[];
  readonly autofixes: readonly Record<string, unknown>[];
}

export type ArtifactFormat = "html" | "x3d" | "x3dj" | "x3dv";

export interface ArtifactDescriptor {
  readonly format: ArtifactFormat;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface ApplyPlanResponse {
  readonly projectId: string;
  readonly revision: number;
  readonly modelSpec: ModelSpec;
  readonly validation: ValidationSummary;
  readonly preview: { readonly url: string } | null;
  readonly artifacts: readonly ArtifactDescriptor[];
  readonly correlationId: string | null;
  readonly timings?: Readonly<Record<string, number>>;
}

export interface ApplyPlanRequestBody {
  readonly expectedRevision: number;
  readonly requestId: string;
  readonly plan: ModelPlan;
  /** Ask the backend to separate penetrating parts instead of rejecting the plan. */
  readonly resolveOverlaps?: boolean;
}

export interface Recipe {
  readonly id: string;
  readonly schemaVersion: "1.0";
  readonly name: string;
  readonly units: ModelSpec["units"];
  readonly displayScale: number;
  readonly objectCount: number;
  readonly plan: ModelPlan;
}

export async function listRecipes(query = ""): Promise<Recipe[]> {
  const response = await fetch(`${baseUrl()}/api/recipes?q=${encodeURIComponent(query)}`);
  if (!response.ok) return throwApiError(response);
  return (await response.json()) as Recipe[];
}

export async function matchRecipe(query: string): Promise<Recipe | null> {
  const response = await fetch(`${baseUrl()}/api/recipes/match?q=${encodeURIComponent(query)}`);
  if (!response.ok) return throwApiError(response);
  return (await response.json()) as Recipe | null;
}

export async function saveRecipe(projectId: string, expectedRevision: number, name: string): Promise<Recipe> {
  const response = await fetch(`${baseUrl()}/api/recipes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, expectedRevision, name }),
  });
  if (!response.ok) return throwApiError(response);
  return (await response.json()) as Recipe;
}

interface ErrorDetail {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  readonly correlationId?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly correlationId: string | null;

  constructor(status: number, detail: ErrorDetail) {
    super(detail.message);
    this.name = "ApiError";
    this.status = status;
    this.code = detail.code;
    this.details = detail.details;
    this.correlationId = detail.correlationId ?? null;
  }
}

const DEFAULT_BASE_URL = "http://localhost:8001";
const PROJECT_STORAGE_KEY = "ai-web3d:last-project";

function storedProjectId(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberProjectId(projectId: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  } catch {
    return;
  }
}

function forgetProjectId(projectId: string): void {
  try {
    if (typeof localStorage !== "undefined" && storedProjectId() === projectId) {
      localStorage.removeItem(PROJECT_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

function baseUrl(): string {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
}

async function throwApiError(response: Response): Promise<never> {
  try {
    const body = (await response.json()) as ErrorDetail;
    if (body.code && body.message) throw new ApiError(response.status, body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  throw new ApiError(response.status, {
    code: "INTERNAL_ERROR",
    message: `Request failed with status ${response.status}`,
  });
}

export async function createProject(): Promise<ModelSpec> {
  const response = await fetch(`${baseUrl()}/api/projects`, { method: "POST" });
  if (!response.ok) return throwApiError(response);
  const spec = (await response.json()) as ModelSpec;
  rememberProjectId(spec.projectId);
  return spec;
}

export async function resumeProject(): Promise<ApplyPlanResponse | null> {
  const projectId = storedProjectId();
  if (!projectId) return null;
  const response = await fetch(`${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/state`);
  if (response.status === 404) {
    forgetProjectId(projectId);
    return null;
  }
  if (!response.ok) return throwApiError(response);
  const result = (await response.json()) as Omit<ApplyPlanResponse, "correlationId">;
  return { ...result, correlationId: response.headers.get("X-Correlation-Id") };
}

export async function applyPlan(
  projectId: string,
  body: ApplyPlanRequestBody,
  signal?: AbortSignal,
): Promise<ApplyPlanResponse> {
  const response = await fetch(`${baseUrl()}/api/projects/${projectId}/plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) return throwApiError(response);
  const result = (await response.json()) as Omit<ApplyPlanResponse, "correlationId">;
  return { ...result, correlationId: response.headers.get("X-Correlation-Id") };
}

export async function importManifest(projectId: string, expectedRevision: number, contents: string): Promise<ApplyPlanResponse> {
  const response = await fetch(`${baseUrl()}/api/projects/${projectId}/import?expectedRevision=${expectedRevision}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: contents,
  });
  if (!response.ok) return throwApiError(response);
  const result = (await response.json()) as Omit<ApplyPlanResponse, "correlationId">;
  return { ...result, correlationId: response.headers.get("X-Correlation-Id") };
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl()}/api/projects/${projectId}`, { method: "DELETE" });
    if (!response.ok) return throwApiError(response);
  } finally {
    forgetProjectId(projectId);
  }
}

export async function updateSceneTitle(projectId: string, expectedRevision: number, title: string): Promise<ModelSpec> {
  const response = await fetch(`${baseUrl()}/api/projects/${projectId}/scene/title`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision, title }),
  });
  if (!response.ok) return throwApiError(response);
  return (await response.json()) as ModelSpec;
}

export interface McpHealth {
  readonly reachable: boolean;
  readonly detail: string | null;
}

export async function getMcpHealth(): Promise<McpHealth> {
  const response = await fetch(`${baseUrl()}/api/health/mcp`);
  if (!response.ok) return throwApiError(response);
  return (await response.json()) as McpHealth;
}

export function artifactUrl(projectId: string, format: ArtifactFormat | "manifest", revision: number): string {
  return `${baseUrl()}/api/projects/${projectId}/artifacts/${format}?revision=${revision}&download=true`;
}

export function resolveArtifactUrl(relativeUrl: string): string {
  return `${baseUrl()}${relativeUrl}`;
}

export interface CadPlateInput {
  readonly partId: string;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  readonly holeX: number;
  readonly holeY: number;
  readonly holeDiameter: number;
  readonly additionalHoles?: readonly { readonly id: string; readonly x: number; readonly y: number; readonly diameter: number }[];
  readonly cornerChamfer?: number;
  readonly cornerRadius?: number;
  readonly baseKind?: "extruded_rectangle" | "extruded_disc";
  readonly bosses?: readonly { readonly id: string; readonly x: number; readonly y: number; readonly diameter: number; readonly height: number }[];
  readonly upright?: {
    readonly height: number;
    readonly thickness: number;
    readonly holes: readonly { readonly id: string; readonly x: number; readonly z: number; readonly diameter: number }[];
  };
}

export interface CadInspection {
  readonly partId: string;
  readonly solidCount: number;
  readonly volumeMm3: number;
  readonly boundsMm: readonly [number, number, number];
  readonly stepBytes: number;
}

async function throwCadApiError(response: Response): Promise<never> {
  if (response.status === 404) {
    const body = await response.clone().json().catch(() => null) as Partial<ErrorDetail> | null;
    if (!body?.code) throw new ApiError(404, {
      code: "CAD_API_UNAVAILABLE",
      message: "Restart the API with uv run --extra cad api to enable CAD projects.",
    });
  }
  return throwApiError(response);
}

function cadPartSpec(input: CadPlateInput): CadPartSpec {
  const composite = input.bosses !== undefined;
  const curved = input.cornerRadius !== undefined || input.baseKind === "extruded_disc" || composite;
  const multiFeature = input.additionalHoles !== undefined || input.cornerChamfer !== undefined || input.upright !== undefined || curved;
  const spec: CadPartSpec = {
    schemaVersion: composite ? "2.4" : curved ? "2.3" : input.upright ? "2.2" : multiFeature ? "2.1" : "2.0",
    units: "mm",
    partId: input.partId,
    base: {
      kind: input.baseKind ?? "extruded_rectangle",
      width: input.width,
      depth: input.depth,
      thickness: input.thickness,
    },
    features: [{
      kind: "through_hole",
      ...(multiFeature ? { id: "hole_1" } : {}),
      x: input.holeX,
      y: input.holeY,
      diameter: input.holeDiameter,
    }, ...(input.additionalHoles ?? []).map((hole) => ({ kind: "through_hole" as const, ...hole }))],
    ...(multiFeature ? { cornerChamfer: input.cornerChamfer ?? 0 } : {}),
    ...(curved ? { cornerRadius: input.cornerRadius ?? 0 } : {}),
    ...(input.upright ? { upright: { kind: "upright_wall" as const, ...input.upright } } : {}),
    ...(input.bosses ? { bosses: input.bosses.map((boss) => ({ kind: "cylindrical_boss" as const, ...boss })) } : {}),
  };
  validateCadPartDomainRules(spec);
  return spec;
}

export async function inspectCadPlate(input: CadPlateInput): Promise<CadInspection> {
  const response = await fetch(`${baseUrl()}/api/cad/parts/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cadPartSpec(input)),
  });
  if (!response.ok) return throwCadApiError(response);
  return (await response.json()) as CadInspection;
}

export interface CadProjectResponse {
  readonly projectId: string;
  readonly revision: number;
  readonly spec: CadPartSpec;
  readonly inspection: CadInspection;
}

const CAD_PROJECT_STORAGE_KEY = "ai-web3d:cad-project";
const CAD_RECENT_STORAGE_KEY = "ai-web3d:cad-recent";

export interface RecentCadProject {
  readonly projectId: string;
  readonly partId: string;
}

export function recentCadProjects(): RecentCadProject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAD_RECENT_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentCadProject =>
      typeof item === "object" && item !== null &&
      typeof item.projectId === "string" && typeof item.partId === "string").slice(0, 20);
  } catch { return []; }
}

function rememberCadProject(project: CadProjectResponse): void {
  try {
    localStorage.setItem(CAD_PROJECT_STORAGE_KEY, project.projectId);
    const recent = recentCadProjects().filter((item) => item.projectId !== project.projectId);
    localStorage.setItem(CAD_RECENT_STORAGE_KEY, JSON.stringify([
      { projectId: project.projectId, partId: project.spec.partId }, ...recent,
    ].slice(0, 20)));
  } catch { return; }
}

export function clearActiveCadProject(): void {
  try { localStorage.removeItem(CAD_PROJECT_STORAGE_KEY); } catch { return; }
}

export async function openCadProject(projectId: string): Promise<CadProjectResponse> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(projectId)}`);
  if (!response.ok) return throwCadApiError(response);
  const project = (await response.json()) as CadProjectResponse;
  rememberCadProject(project);
  return project;
}

export async function resumeCadProject(): Promise<CadProjectResponse | null> {
  let projectId: string | null;
  try { projectId = localStorage.getItem(CAD_PROJECT_STORAGE_KEY); } catch { return null; }
  if (!projectId) return null;
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(projectId)}`);
  if (response.status === 404) {
    const body = await response.clone().json().catch(() => null) as Partial<ErrorDetail> | null;
    if (body?.code === "CAD_PROJECT_NOT_FOUND") {
      clearActiveCadProject();
      return null;
    }
  }
  if (!response.ok) return throwCadApiError(response);
  const project = (await response.json()) as CadProjectResponse;
  rememberCadProject(project);
  return project;
}

export async function createCadProject(input: CadPlateInput): Promise<CadProjectResponse> {
  const response = await fetch(`${baseUrl()}/api/cad/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec: cadPartSpec(input) }),
  });
  if (!response.ok) return throwCadApiError(response);
  const project = (await response.json()) as CadProjectResponse;
  rememberCadProject(project);
  return project;
}

export function cadEditPlan(previous: CadPartSpec, input: CadPlateInput): CadEditPlan | null {
  if (previous.partId !== input.partId) throw new Error("Part ID cannot change after the first saved revision.");
  const parameters: readonly [CadParameter, number, number][] = [
    ["width", previous.base.width, input.width],
    ["depth", previous.base.depth, input.depth],
    ["thickness", previous.base.thickness, input.thickness],
    ["hole_x", previous.features[0].x, input.holeX],
    ["hole_y", previous.features[0].y, input.holeY],
    ["hole_diameter", previous.features[0].diameter, input.holeDiameter],
  ];
  const operations: CadOperation[] = parameters.filter(([, oldValue, newValue]) => oldValue !== newValue)
    .map(([parameter, , value]) => ({ op: "set_parameter" as const, parameter, value }));
  const previousExtras = previous.features.slice(1);
  const nextExtras = input.additionalHoles ?? [];
  const structural = (input.cornerChamfer ?? 0) !== (previous.cornerChamfer ?? 0) ||
    JSON.stringify(previousExtras.map(({ id, x, y, diameter }) => ({ id, x, y, diameter }))) !== JSON.stringify(nextExtras);
  if (structural) {
    if ((input.cornerChamfer ?? 0) !== (previous.cornerChamfer ?? 0)) {
      operations.push({ op: "set_corner_chamfer", value: input.cornerChamfer ?? 0 });
    }
    for (const hole of previousExtras) {
      if (hole.id && !nextExtras.some((next) => next.id === hole.id)) {
        operations.push({ op: "remove_hole", holeId: hole.id });
      }
    }
    for (const hole of nextExtras) {
      const old = previousExtras.find((current) => current.id === hole.id);
      if (!old || old.x !== hole.x || old.y !== hole.y || old.diameter !== hole.diameter) {
        operations.push({ op: "upsert_hole", holeId: hole.id, x: hole.x, y: hole.y, diameter: hole.diameter });
      }
    }
  }
  if (operations.length === 0) return null;
  const plan: CadEditPlan = { schemaVersion: structural || previous.schemaVersion === "2.1" ? "2.0" : "1.0", operations };
  validateCadEditPlan(plan);
  return plan;
}

export async function applyCadEdit(project: CadProjectResponse, input: CadPlateInput): Promise<CadProjectResponse> {
  if (project.spec.upright || input.upright || project.spec.schemaVersion === "2.3" || project.spec.schemaVersion === "2.4" || input.cornerRadius !== undefined || input.baseKind === "extruded_disc" || input.bosses) return replaceCadProjectSpec(project, cadPartSpec(input));
  const plan = cadEditPlan(project.spec, input);
  if (plan === null) return project;
  return applyCadPlan(project, plan);
}

export async function replaceCadProjectSpec(project: CadProjectResponse, spec: CadPartSpec): Promise<CadProjectResponse> {
  validateCadPartDomainRules(spec);
  if (spec.partId !== project.spec.partId) throw new Error("Part ID cannot change after the first saved revision.");
  if (JSON.stringify(spec) === JSON.stringify(project.spec)) return project;
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/spec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: project.revision, spec }),
  });
  if (!response.ok) return throwCadApiError(response);
  return (await response.json()) as CadProjectResponse;
}

export async function applyCadPlan(project: CadProjectResponse, plan: CadEditPlan): Promise<CadProjectResponse> {
  validateCadEditPlan(plan);
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: project.revision, plan }),
  });
  if (!response.ok) return throwCadApiError(response);
  return (await response.json()) as CadProjectResponse;
}

export async function downloadCadRevisionStep(project: CadProjectResponse, revision: number): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/revisions/${revision}/step`);
  if (!response.ok) return throwCadApiError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.spec.partId}-r${revision}.step`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface CadProgramProject {
  readonly projectId: string;
  readonly revision: number;
  readonly spec: CadProgramSpec;
  readonly inspection: CadInspection;
}

export interface CadProgramMesh {
  readonly vertices: readonly (readonly [number, number, number])[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly boundsMm: readonly [number, number, number];
}

const CAD_PROGRAM_KEY = "ai-web3d:cad-program";

export async function resumeCadProgram(): Promise<CadProgramProject | null> {
  const id = localStorage.getItem(CAD_PROGRAM_KEY);
  if (!id) return null;
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(id)}`);
  if (response.status === 404) { localStorage.removeItem(CAD_PROGRAM_KEY); return null; }
  if (!response.ok) return throwCadApiError(response);
  const project = await response.json() as CadProgramProject;
  if (project.spec.schemaVersion !== '3.0') { localStorage.removeItem(CAD_PROGRAM_KEY); return null; }
  return project;
}

export async function saveCadProgram(spec: CadProgramSpec, project?: CadProgramProject | null): Promise<CadProgramProject> {
  validateCadProgram(spec);
  const endpoint = project ? `/api/cad/projects/${encodeURIComponent(project.projectId)}/spec` : '/api/cad/projects';
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(project ? { expectedRevision: project.revision, spec } : { spec }),
  });
  if (!response.ok) return throwCadApiError(response);
  const saved = await response.json() as CadProgramProject;
  localStorage.setItem(CAD_PROGRAM_KEY, saved.projectId);
  return saved;
}

export async function checkCadProgram(spec: CadProgramSpec): Promise<string | null> {
  const response = await fetch(`${baseUrl()}/api/cad/programs/inspect`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec),
  });
  if (response.ok) return null;
  try {
    return await throwCadApiError(response);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CAD_GEOMETRY_INVALID') return error.message;
    throw error;
  }
}

export async function meshCadProgram(spec: CadProgramSpec): Promise<CadProgramMesh> {
  validateCadProgram(spec);
  const response = await fetch(`${baseUrl()}/api/cad/programs/mesh`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec),
  });
  if (!response.ok) return throwCadApiError(response);
  return await response.json() as CadProgramMesh;
}

export async function downloadCadProgramStep(project: CadProgramProject): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/revisions/${project.revision}/step`);
  if (!response.ok) return throwCadApiError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.spec.partId}-r${project.revision}.step`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
