# Agentes e provedores

Este pacote concentra SDKs e geração estruturada. A aplicação depende de `LLMProvider`, não chama SDKs diretamente e não executa código produzido por modelos.

| Módulo | Função |
|---|---|
| `provider.ts` | Disponibilidade, inicialização, geração e cancelamento |
| `webllm-provider.ts`, `webllm.worker.ts` | IA local, WebGPU, worker e progresso |
| `openai-compatible-provider.ts` | Endpoint do usuário, schemas, erros e cota |
| `classify-cad-design.ts` | Seleção peça/conjunto em pedidos novos |
| `generate-cad-program.ts` | Programa CAD 3.0, normalização e reparos validados |
| `generate-cad-assembly.ts` | Plano, componentes, reutilização e correções de interferência |
| `generate-model-plan.ts`, `generate-scene.ts` | ModelPlan X3D, esclarecimentos e cenas em etapas |
| `structured-output.ts`, `schemas.ts` | Parsing, diagnóstico e schemas |
| `generate-cad-part.ts`, `generate-cad-edit.ts` | Compatibilidade CAD 2.x |
| `mock-provider.ts` | Respostas determinísticas para testes |

Propostas exigem schema e domínio. CAD também exige verificações geométricas injetadas pelo consumidor. X3D aplica e valida cada etapa na API; uma falha posterior conserva etapas já publicadas.

CAD usa o catálogo `packages/domain/ts/src/cad-features.ts`: primitivas, roscas métricas/trapezoidais reais, furos com acabamento, lofts e fillet/chamfer/shell. O parser normaliza somente campos irrelevantes e aplica o schema completo; reparos conservam roscas existentes. Montagens podem usar fatores explícitos por grupo para associar rotação e translação. Capacidades, limites e prompts estão em [cad-readiness](../../docs/cad-readiness.md) e [cad-prompts](../../docs/cad-prompts.md).

O provedor remoto envia pedidos diretamente ao endpoint configurado. Uma resposta 429 só é repetida com `Retry-After` curto. Erros não expõem chaves nem o corpo bruto do provedor. Checkpoints de montagem usam identidade do provedor e solicitação para reutilizar componentes enquanto a aba permanecer aberta.

O modelo WebLLM padrão está em `model-config.ts`; sua escolha ainda requer benchmark real. Testes com `MockLLMProvider` não medem capacidade de um modelo real.

Na raiz: `npm ci`, `npm run typecheck`, `npm test`. Pacotes privados importam fontes e schemas por caminhos relativos. TypeScript usa resolução `bundler` para tipos do SDK WebLLM.
