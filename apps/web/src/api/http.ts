export interface ErrorDetail {
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

export function baseUrl(): string {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
}

export async function throwApiError(response: Response): Promise<never> {
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

export async function throwCadApiError(response: Response): Promise<never> {
  if (response.status === 404) {
    const body = await response.clone().json().catch(() => null) as Partial<ErrorDetail> | null;
    if (!body?.code) throw new ApiError(404, {
      code: "CAD_API_UNAVAILABLE",
      message: "Restart the API with npm run dev:api to enable CAD projects.",
    });
  }
  return throwApiError(response);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
