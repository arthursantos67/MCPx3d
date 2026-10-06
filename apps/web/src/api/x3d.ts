import type { ModelPlan } from "../../../../packages/domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";
import { baseUrl, throwApiError } from "./http.ts";

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
  readonly overlapPolicy?: 'visual' | 'strict';
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

export function artifactUrl(projectId: string, format: ArtifactFormat | "manifest", revision: number): string {
  return `${baseUrl()}/api/projects/${projectId}/artifacts/${format}?revision=${revision}&download=true`;
}

export function resolveArtifactUrl(relativeUrl: string): string {
  return `${baseUrl()}${relativeUrl}`;
}
