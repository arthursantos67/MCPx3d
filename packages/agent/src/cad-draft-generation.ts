import type { CadDraftSnapshot } from '../../domain/ts/src/cad-draft.ts'
import { ProviderRequestError } from './provider.ts'

export class CadDraftGenerationError extends ProviderRequestError {
  readonly draft: CadDraftSnapshot
  constructor(message: string, draft: CadDraftSnapshot) {
    super(message)
    this.name = 'CadDraftGenerationError'
    this.draft = structuredClone(draft)
  }
}
