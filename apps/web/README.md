# Frontend Forma

React, TypeScript, Vite e Three.js. Instale dependências na raiz com `npm ci`; `npm run dev` inicia frontend e API. Use `npm run dev:web` se a API já estiver rodando. `VITE_API_BASE_URL` substitui `http://localhost:8001`.

| Diretório | Responsabilidade |
|---|---|
| `src/workspace` | Shell, navegação e controles compartilhados |
| `src/ai` | Seleção do provedor e estado do runtime |
| `src/cad` | Controlador CAD, peça/conjunto, prévia WebGL e movimento |
| `src/chat`, `src/x3d` | Controlador, conversa e área X3D |
| `src/three` | Editor contextual, geometrias/GLB, inspeção BVH em worker, materiais físicos, animação e tela cheia |
| `src/viewer` | Iframe sandbox e gerenciamento de Blob URLs |
| `src/api` | HTTP, recuperação e downloads |
| `src/settings` | IA local ou endpoint compatível com OpenAI |

SDKs ficam em `packages/agent`, sem runtime duplicado no frontend. Pacotes privados compartilham fontes por importações relativas; npm workspaces centralizam instalação e checks.

Configuração do provedor passa a valer em **Salvar e aplicar**, sem recarregar nem perder o rascunho. Chaves externas ficam em localStorage e seguem diretamente para o endpoint escolhido. Modos Codex/Claude Code usam a ponte local autenticada; as propostas geométricas continuam sujeitas à API.

Checks na raiz: `npm run lint:web`, `npm run typecheck`, `npm test`, `npm run build` e `npm run test:browser`. Veja [testes](../../docs/testing.md) e [arquitetura](../../docs/architecture.md).

O menu **Three.js** usa um bundle sob demanda. Edição/reprodução funcionam sem API/IA; a geração usa o `AgentProvider` compartilhado e passa por validação local. Requer WebGL2. O projeto JSON tem contrato próprio e não é intercambiável diretamente com CAD/X3D. Escopo e roadmap em [estúdio Three.js](../../docs/threejs-studio.md).

O contrato Three.js 1.1 migra projetos 1.0. GLB estático é convertido em malhas JSON; arquivos com clipes/skins/compressão ou referências externas são recusados. Texturas grandes podem exceder a quota de localStorage e exigem backup JSON. Inspeções refinam superfícies em poses amostradas, com limite de tempo/pares.
