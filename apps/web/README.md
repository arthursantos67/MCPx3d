# Interface web

React, TypeScript, Vite e Three.js. Na raiz: `npm ci` e `npm run dev:web`. O frontend abre em `http://127.0.0.1:5173`; a URL da API é configurada em [.env.example](.env.example).

`src/cad`, `src/x3d` e `src/three` implementam os workspaces. `src/ai`/`settings` configuram provedores; `workspace` cuida da navegação; `api` contém clientes HTTP. Three.js edita/reproduz/joga localmente; CAD/X3D usam API para construir e validar.

Na raiz: `npm run lint:web`, `npm run typecheck`, `npm test`, `npm run build`. [Uso](../../README.md) · [Arquitetura](../../docs/architecture.md) · [Testes](../../docs/testing.md).
