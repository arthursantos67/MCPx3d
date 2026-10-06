# API Forma

FastAPI, Python 3.12+, CadQuery e validação X3D local. Na raiz, `npm run dev:api` inicia em `127.0.0.1:8001`. Nesta pasta, `uv sync` e `uv run api` instalam os mesmos motores. Variáveis em [.env.example](.env.example); contratos completos em `/docs`.

| Rota | Função |
|---|---|
| `GET /api/health` | Disponibilidade da API |
| `GET /api/health/engines` | Motores CAD e X3D selecionado |
| `GET /api/ai/local/status/{client}` | Instalação e autenticação de assinatura (`codex`/`claude`), somente loopback |
| `POST /api/ai/local/generate` | JSON por cliente oficial, sem ferramentas, com timeout/cancelamento |
| `POST /api/cad/programs/inspect`, `/mesh` | Validar peça 3.0 e obter prévia |
| `POST /api/cad/assemblies/inspect`, `/mesh` | Validar conjunto 4.0 e obter prévia |
| `POST /api/cad/projects` | Salvar projeto CAD, revisão 0 |
| `GET /api/cad/projects/{id}` | Recuperar spec e inspeção atuais |
| `POST /api/cad/projects/{id}/spec` | Salvar revisão com `expectedRevision` |
| `GET /api/cad/projects/{id}/revisions/{revision}/step` ou `/stl` | Exportar revisão salva |
| `GET /api/cad/projects/{id}/revisions/{revision}/components/{componentId}/step` ou `/stl` | Exportar componente do STEP salvo |
| `POST /api/projects`, `GET /api/projects/{id}/state` | Criar e recuperar sessão X3D |
| `POST /api/projects/{id}/plans` | Aplicar plano, construir e validar cena |
| `POST /api/projects/{id}/import?expectedRevision=N` | Importar manifesto validado |
| `GET /api/projects/{id}/artifacts/{format}?revision=N` | HTML, X3D, X3DV e manifesto |
| `GET /api/recipes`, `/match`, `POST /api/recipes` | Catálogo de receitas X3D |

CAD aceita `{ "spec": ... }` na criação e `{ "expectedRevision": N, "spec": ... }` na atualização. Revisões obsoletas retornam 409; geometria inválida retorna 422 e preserva o estado salvo. Contratos CAD 2.x e planos antigos continuam compatíveis.

`cad_service.py` centraliza validação/exportação. Adaptadores constroem geometria; `cad_projects.py` e `recipes.py` persistem dados. `x3d_backend.py` seleciona local ou MCP; `x3d_validation.py` conserva a fronteira de validação. Rotas coordenam esses serviços.

`cad_features.py` concentra os recursos mecânicos e acabamentos; `cad_threads.py` constrói filetes helicoidais segmentados e verifica sua geometria. `cad_mesh.py` controla o orçamento da prévia sem alterar STEP/STL. Os contratos compartilhados podem ser regenerados com `uv run python ../../scripts/generate-cad-schemas.py`. Veja [capacidades CAD](../../docs/cad-readiness.md) e [exemplos](../../examples/cad/README.md).

CAD e receitas persistem em `data/*.sqlite3`. Sessões X3D ficam em memória; exporte um manifesto entre reinícios. Os bancos são compartilhados entre clientes, sem contas ou propriedade por usuário.

Checks: `uv run ruff check .`, `uv run mypy src`, `uv run pytest`. Testes MCP iniciam serviço isolado para conservar compatibilidade; não é requisito para a aplicação local.
