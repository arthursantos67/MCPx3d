import { validateCadDraft, type CadDraftSnapshot } from '../../../../packages/domain/ts/src/cad-draft.ts'

const KEY = 'modeler:cad-draft:v1'

export function readCadDraft(): CadDraftSnapshot | null {
  try {
    const saved = localStorage.getItem(KEY)
    if (!saved) return null
    const parsed = JSON.parse(saved) as { version: number; draft: CadDraftSnapshot }
    if (parsed.version !== 1) return null
    validateCadDraft(parsed.draft)
    return parsed.draft
  } catch { return null }
}

export function storeCadDraft(draft: CadDraftSnapshot): boolean {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, draft })); return true } catch { return false }
}

export function clearCadDraft(): void { localStorage.removeItem(KEY) }
