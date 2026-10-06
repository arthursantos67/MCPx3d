import { baseUrl, throwApiError } from "./http.ts";

export interface McpHealth {
  readonly reachable: boolean;
  readonly detail: string | null;
}

export async function getMcpHealth(): Promise<McpHealth> {
  const response = await fetch(`${baseUrl()}/api/health/mcp`);
  if (!response.ok) return throwApiError(response);
  return (await response.json()) as McpHealth;
}

export interface EngineHealth {
  readonly available: boolean;
  readonly backend: string;
  readonly detail: string | null;
}

export interface EnginesHealth {
  readonly x3d: EngineHealth;
  readonly cad: EngineHealth;
}

export async function getEnginesHealth(): Promise<EnginesHealth> {
  const response = await fetch(`${baseUrl()}/api/health/engines`);
  if (!response.ok) return throwApiError(response);
  return await response.json() as EnginesHealth;
}
