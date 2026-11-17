# API Forma

FastAPI, Python 3.12, CadQuery/OpenCascade e validadores X3D. Na raiz, `npm run dev:api` inicia `127.0.0.1:8001`; a referência completa está em `/docs`. Para iniciar diretamente: `uv run --project apps/api uvicorn api.main:app --host 127.0.0.1 --port 8001`.

Inicialize o submódulo antes de instalar. Configure variáveis a partir de [.env.example](.env.example). O padrão X3D é local; servidor MCP é opcional.

| Rota | Função |
|---|---|
| `GET /api/health`, `/api/health/engines` | Disponibilidade e motores |
| `GET /api/ai/local/status/{client}` | Instalação/login de cliente local |
| `POST /api/ai/local/generate` | JSON por cliente oficial em loopback |
| `POST /api/cad/programs/inspect`, `/mesh` | Inspeção/prévia de peça |
| `POST /api/cad/assemblies/inspect`, `/mesh`, `/mechanics` | Inspeção/prévia/vínculos de conjunto |
| `POST /api/cad/projects` | Criar projeto e revisão |
| `GET /api/cad/projects/{id}` | Recuperar projeto |
| `POST /api/cad/projects/{id}/spec` | Nova revisão com `expectedRevision` |
| `GET /api/cad/projects/{id}/revisions/{revision}/step` ou `/stl` | Exportar revisão |
| `GET /api/cad/projects/{id}/revisions/{revision}/components/{componentId}/step` ou `/stl` | Exportar componente |
| `POST /api/projects`, `GET /api/projects/{id}/state` | Criar/recuperar sessão X3D |
| `POST /api/projects/{id}/plans` | Aplicar e validar plano X3D |
| `POST /api/projects/{id}/import?expectedRevision=N` | Importar manifesto |
| `GET /api/projects/{id}/artifacts/{format}?revision=N` | Exportar artefato X3D |
| `GET /api/recipes`, `/match`, `POST /api/recipes` | Receitas X3D |

Criação CAD recebe `{ "spec": ... }`; atualização recebe `{ "expectedRevision": N, "spec": ... }`. Conflito retorna 409; geometria inválida retorna 422 sem substituir a revisão válida. Consulte OpenAPI para corpos completos e demais rotas.

`cad_service.py` centraliza inspeção/exportação, adaptadores constroem sólidos, `cad_mechanics.py` verifica vínculos e `cad_projects.py` persiste revisões. Workers descartáveis têm memória/prazo configuráveis e fila/lock serializados. CAD/receitas usam `data/*.sqlite3`; sessões X3D ficam na memória. Não há contas ou propriedade por usuário.

[Guia CAD](../../docs/cad.md) · [Guia X3D](../../docs/x3d.md) · [Arquitetura](../../docs/architecture.md) · [Testes](../../docs/testing.md).
