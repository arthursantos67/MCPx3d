# Contratos do domínio

Schemas JSON compartilhados, tipos e regras TypeScript/Python para CAD e X3D.

| Diretório | Conteúdo |
|---|---|
| `schemas/` | Estrutura JSON Schema dos contratos versionados |
| `fixtures/` | Entradas válidas/inválidas compartilhadas pelas suítes |
| `ts/src/` | Tipos, regras e validação usados por agentes/frontend |
| `python/src/domain/` | Modelos Pydantic e regras usados pela API |

`ModelSpec`/`ModelPlan` 1.0 descrevem cena/operações X3D. `CadProgramSpec` 3.0 descreve construção sequencial; `CadAssemblySpec` 4.0 descreve componentes, transformações, movimentos e vínculos. Schemas CAD 2.x também suportam contratos paramétricos aceitos pela API.

JSON Schema verifica estrutura, tipos e intervalos. Regras do domínio verificam IDs únicos, referências, relações dimensionais e compatibilidade entre campos. A geometria real é construída e inspecionada no motor, separadamente.

Instale Node na raiz com `npm ci`. Execute `npm test --workspace @ai-web3d-modeler/domain`. No Python: `uv sync --project packages/domain/python --frozen --python 3.12` e `uv run --project packages/domain/python pytest packages/domain/python/tests`. Ambas as suítes usam fixtures comuns.

Para regenerar schemas CAD: `uv run --project apps/api python scripts/generate-cad-schemas.py`. [Testes](../../docs/testing.md) · [PRD](../../PRD.md).
