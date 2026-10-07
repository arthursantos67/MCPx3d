import { type CadProgramSpec, validateCadProgram } from "../../../../packages/domain/ts/src/cad-program.ts";
import { type CadAssemblySpec, validateCadAssembly } from "../../../../packages/domain/ts/src/cad-assembly.ts";
import { ApiError, baseUrl, throwCadApiError, downloadBlob } from "./http.ts";
import { readAssemblyIssue, type CadAssemblyCheckResult } from "../../../../packages/domain/ts/src/cad-assembly-diagnostics.ts";
import { validateCadDraft, type CadDraftSnapshot, type CadDraftSpec } from '../../../../packages/domain/ts/src/cad-draft.ts'

export interface CadInspection {
  readonly partId: string;
  readonly solidCount: number;
  readonly volumeMm3: number;
  readonly boundsMm: readonly [number, number, number];
  readonly stepBytes: number;
  readonly mechanicalStatus?: 'verified' | 'unverified' | null;
}

export async function downloadCadRevisionStl(project: { readonly projectId: string; readonly spec: { readonly partId: string } }, revision: number): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/revisions/${revision}/stl`);
  if (!response.ok) return throwCadApiError(response);
  downloadBlob(await response.blob(), `${project.spec.partId}-r${revision}.stl`);
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
  readonly components?: readonly { readonly id: string; readonly triangles: number; readonly volumeMm3: number }[];
  readonly draftReport?: { readonly partial: boolean; readonly message: string; readonly components: readonly {
    readonly id: string; readonly status: 'complete' | 'partial' | 'omitted'; readonly issue: string | null
    readonly omittedStepIds: readonly string[]
  }[] }
}

export async function meshCadDraft(spec: CadDraftSpec, signal?: AbortSignal): Promise<CadProgramMesh> {
  const response = await fetch(`${baseUrl()}/api/cad/drafts/mesh`, { signal, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }) })
  if (!response.ok) return throwCadApiError(response)
  return await response.json() as CadProgramMesh
}

export async function downloadCadDraftBundle(draft: CadDraftSnapshot): Promise<void> {
  validateCadDraft(draft)
  const response = await fetch(`${baseUrl()}/api/cad/drafts/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
  if (!response.ok) return throwCadApiError(response)
  downloadBlob(await response.blob(), `${draft.spec.partId}-rascunho.zip`)
}

export function downloadCadDraftJson(draft: CadDraftSnapshot): void {
  downloadBlob(new Blob([JSON.stringify(draft.spec, null, 2)], { type: 'application/json' }), `${draft.spec.partId}-rascunho.json`)
}

const CAD_PROGRAM_KEY = "ai-web3d:cad-program";

export function clearActiveCadProgram(): void { localStorage.removeItem(CAD_PROGRAM_KEY); }

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

export async function checkCadProgram(spec: CadProgramSpec, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(`${baseUrl()}/api/cad/programs/inspect`, {
    signal,
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

export async function meshCadProgram(spec: CadProgramSpec, signal?: AbortSignal): Promise<CadProgramMesh> {
  validateCadProgram(spec);
  const response = await fetch(`${baseUrl()}/api/cad/programs/mesh`, {
    signal,
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec),
  });
  if (!response.ok) return throwCadApiError(response);
  return await response.json() as CadProgramMesh;
}

export async function downloadCadProgramStep(project: CadProgramProject): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/revisions/${project.revision}/step`);
  if (!response.ok) return throwCadApiError(response);
  downloadBlob(await response.blob(), `${project.spec.partId}-r${project.revision}.step`);
}

export interface CadAssemblyProject {
  readonly projectId: string;
  readonly revision: number;
  readonly spec: CadAssemblySpec;
  readonly inspection: CadInspection;
}

const CAD_ASSEMBLY_KEY = 'ai-web3d:cad-assembly';

export function clearActiveCadAssembly(): void { localStorage.removeItem(CAD_ASSEMBLY_KEY); }

export async function resumeCadAssembly(): Promise<CadAssemblyProject | null> {
  const id = localStorage.getItem(CAD_ASSEMBLY_KEY);
  if (!id) return null;
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(id)}`);
  if (response.status === 404) { localStorage.removeItem(CAD_ASSEMBLY_KEY); return null; }
  if (!response.ok) return throwCadApiError(response);
  const project = await response.json() as CadAssemblyProject;
  if (project.spec.schemaVersion !== '4.0') { localStorage.removeItem(CAD_ASSEMBLY_KEY); return null; }
  return project;
}

export async function checkCadAssembly(spec: CadAssemblySpec, signal?: AbortSignal): Promise<CadAssemblyCheckResult> {
  validateCadAssembly(spec);
  const response = await fetch(`${baseUrl()}/api/cad/assemblies/inspect`, {
    signal,
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec),
  });
  if (response.ok) return null;
  try { return await throwCadApiError(response); }
  catch (error) {
    if (error instanceof ApiError && (error.code === 'CAD_GEOMETRY_INVALID' || error.code === 'CAD_MECHANICS_INVALID' || error.code === 'INVALID_CAD_REQUEST')) {
      return readAssemblyIssue(error.message, error.details) ?? error.message;
    }
    throw error;
  }
}

export interface CadMechanicsReport {
  readonly status: 'verified' | 'unverified';
  readonly message: string;
  readonly connections: number;
  readonly requirements: readonly string[];
  readonly separatedFixedComponents: readonly { readonly component: string; readonly nearestFixedComponent: string; readonly gapMm: number }[];
}

export async function inspectCadMechanics(spec: CadAssemblySpec): Promise<CadMechanicsReport> {
  validateCadAssembly(spec);
  const response = await fetch(`${baseUrl()}/api/cad/assemblies/mechanics`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec),
  });
  if (!response.ok) return throwCadApiError(response);
  return await response.json() as CadMechanicsReport;
}

export async function meshCadAssembly(spec: CadAssemblySpec, signal?: AbortSignal): Promise<CadProgramMesh> {
  validateCadAssembly(spec);
  const response = await fetch(`${baseUrl()}/api/cad/assemblies/mesh`, {
    signal,
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec),
  });
  if (!response.ok) return throwCadApiError(response);
  return await response.json() as CadProgramMesh;
}

export async function saveCadAssembly(spec: CadAssemblySpec, project?: CadAssemblyProject | null): Promise<CadAssemblyProject> {
  validateCadAssembly(spec);
  const endpoint = project ? `/api/cad/projects/${encodeURIComponent(project.projectId)}/spec` : '/api/cad/projects';
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(project ? { expectedRevision: project.revision, spec } : { spec }),
  });
  if (!response.ok) return throwCadApiError(response);
  const saved = await response.json() as CadAssemblyProject;
  localStorage.setItem(CAD_ASSEMBLY_KEY, saved.projectId);
  return saved;
}

export async function downloadCadAssemblyStep(project: CadAssemblyProject): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/revisions/${project.revision}/step`);
  if (!response.ok) return throwCadApiError(response);
  downloadBlob(await response.blob(), `${project.spec.partId}-r${project.revision}.step`);
}

export function downloadCadAssemblyDraft(spec: CadAssemblySpec): void {
  downloadBlob(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }), `${spec.partId}-rascunho-com-erro.json`);
}

export async function downloadCadComponent(project: CadAssemblyProject, componentId: string, format: 'stl' | 'step'): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/cad/projects/${encodeURIComponent(project.projectId)}/revisions/${project.revision}/components/${encodeURIComponent(componentId)}/${format}`);
  if (!response.ok) return throwCadApiError(response);
  downloadBlob(await response.blob(), `${project.spec.partId}-${componentId}-r${project.revision}.${format}`);
}
