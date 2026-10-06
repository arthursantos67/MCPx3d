import { ProviderRequestError, StructuredOutputError, type AgentMessage, type CompletionUsage, type GenerationOptions, type JsonSchema, type LLMProvider } from './provider.ts';
import { parseStructuredCompletion } from './structured-output.ts';
import type { OpenAICompatibleProviderState } from './openai-compatible-provider.ts';

export type LocalClient = 'codex' | 'claude';
export interface LocalClientStatus {
  readonly client: LocalClient;
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly plan?: string | null;
  readonly message: string;
}

/** Uses native client authentication; the browser never handles subscription tokens. */
export class LocalCliProvider implements LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly maxOutputTokens = undefined;
  readonly generationPolicy = { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1, maxSceneRepairAttempts: 1 } as const;
  private readonly config: { apiBaseUrl: string; client: LocalClient; model: string };
  private readonly fetchImpl: typeof fetch;
  private state: OpenAICompatibleProviderState = { phase: 'idle' };
  private listeners = new Set<(state: OpenAICompatibleProviderState) => void>();
  private abort: AbortController | null = null;

  constructor(config: { apiBaseUrl: string; client: LocalClient; model: string }, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.id = `local-${config.client}`;
    this.model = config.model.trim() || 'client-default';
  }

  getState(): OpenAICompatibleProviderState { return this.state; }
  onStateChange(listener: (state: OpenAICompatibleProviderState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private setState(state: OpenAICompatibleProviderState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiBaseUrl.replace(/\/+$/, '')}/api/ai/local/${path}`, init);
    } catch (error) {
      if (init?.signal?.aborted) throw new ProviderRequestError('Solicitação ao cliente local cancelada.');
      throw new ProviderRequestError('Não foi possível conectar ao servidor local de IA. Verifique se a API está rodando.', { cause: error });
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => ({}));
      const data = (body && typeof body === 'object' ? body : {}) as { code?: unknown; message?: unknown };
      const code = typeof data.code === 'string' && /^CLI_[A-Z_]+$/.test(data.code) ? data.code : undefined;
      const message = code && typeof data.message === 'string' ? data.message : `O servidor local de IA retornou status ${response.status}.`;
      throw new ProviderRequestError(message, {
        ...(response.status === 429 || response.status === 413 ? { limit: { kind: response.status === 413 ? 'request-size' : code === 'CLI_QUOTA' ? 'quota' : 'rate', code } } : {}),
      });
    }
    try { return await response.json(); }
    catch (error) { throw new ProviderRequestError('A API local não entregou uma resposta válida. Nenhuma retentativa automática foi feita.', { cause: error }); }
  }

  async checkStatus(): Promise<LocalClientStatus> {
    const status = await this.request(`status/${this.config.client}`) as LocalClientStatus | null;
    if (!status || typeof status.installed !== 'boolean' || typeof status.authenticated !== 'boolean' || typeof status.message !== 'string') {
      throw new ProviderRequestError('A API local não entregou um diagnóstico válido da instalação e do login.')
    }
    return status;
  }
  async isAvailable(): Promise<boolean> {
    try { const status = await this.checkStatus(); return status.installed && status.authenticated; }
    catch { return false; }
  }
  async initialize(): Promise<void> {
    try {
      const status = await this.checkStatus();
      if (!status.installed || !status.authenticated) throw new ProviderRequestError(status.message);
      this.setState({ phase: 'ready' });
    } catch (error) {
      this.setState({ phase: 'error', message: error instanceof Error ? error.message : 'Falha na conexão com o cliente local.' });
      throw error;
    }
  }
  async generateStructured<T>(messages: readonly AgentMessage[], schema: JsonSchema, options?: GenerationOptions): Promise<T> {
    if (this.abort) throw new ProviderRequestError('Este cliente já está gerando uma resposta.');
    const abort = new AbortController();
    this.abort = abort;
    this.setState({ phase: 'generating' });
    try {
      const result = await this.request('generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ client: this.config.client, model: this.config.model.trim(), messages, schema }),
      }) as { content: string; finishReason: string; usage?: CompletionUsage } | null;
      if (!result || typeof result.content !== 'string' || typeof result.finishReason !== 'string') {
        throw new ProviderRequestError('A API local não entregou o conteúdo da resposta. Nenhuma retentativa automática foi feita.')
      }
      const value = parseStructuredCompletion(result.content, { finishReason: result.finishReason, usage: result.usage }, options?.onCompletion) as T;
      this.setState({ phase: 'ready' });
      return value;
    } catch (error) {
      this.setState({ phase: 'ready' });
      if (error instanceof StructuredOutputError) {
        throw new ProviderRequestError(
          error.completion.failure === 'truncated'
            ? 'O cliente local entregou JSON incompleto. Isso não confirma que o limite de tokens foi atingido. Nenhuma retentativa automática foi feita; retome o mesmo pedido nesta aba para reutilizar o progresso.'
            : 'O cliente local entregou uma resposta fora do formato JSON esperado. Nenhuma retentativa automática foi feita; retome o mesmo pedido nesta aba para reutilizar o progresso.',
          { cause: error },
        );
      }
      throw error;
    } finally {
      this.abort = null;
    }
  }
  async cancel(): Promise<void> { this.abort?.abort(); }
}
