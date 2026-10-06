# Frontend Forma

React, TypeScript e Vite. Instale dependências na raiz com `npm ci`; `npm run dev` inicia frontend e API. Use `npm run dev:web` se a API já estiver rodando. `VITE_API_BASE_URL` substitui `http://localhost:8001`.

| Diretório | Responsabilidade |
|---|---|
| `src/workspace` | Shell, navegação e controles compartilhados |
| `src/ai` | Seleção do provedor e estado do runtime |
| `src/cad` | Controlador CAD, peça/conjunto, prévia WebGL e movimento |
| `src/chat`, `src/x3d` | Controlador, conversa e área X3D |
| `src/viewer` | Iframe sandbox e gerenciamento de Blob URLs |
| `src/api` | HTTP, recuperação e downloads |
| `src/settings` | IA local ou endpoint compatível com OpenAI |

SDKs ficam em `packages/agent`, sem runtime duplicado no frontend. Pacotes privados compartilham fontes por importações relativas; npm workspaces centralizam instalação e checks.

Configuração do provedor passa a valer após recarregar. Chaves ficam em localStorage e seguem diretamente para o endpoint escolhido. Apenas propostas geométricas chegam à API da aplicação.

Checks na raiz: `npm run lint:web`, `npm run typecheck`, `npm test`, `npm run build` e `npm run test:browser`. Veja [testes](../../docs/testing.md) e [arquitetura](../../docs/architecture.md).
