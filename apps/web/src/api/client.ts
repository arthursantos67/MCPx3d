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
  return (await response.json()) as ModelSpec;
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

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) return throwApiError(response);
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
