# Agentes de criação

Pacote TypeScript compartilhado pela interface. Implementa provedores WebLLM, endpoint compatível com OpenAI e clientes locais, além de classificação, planejamento, geração, edição e reparo de contratos CAD/X3D.

As respostas são dados estruturados. Schema, domínio, preservação de requisitos e inspeção pelo motor decidem a aceitação. Checkpoints e orçamentos de ação permitem retomada sem repetir componentes concluídos. A geração Three.js usa esse sistema de provedores no workspace web.

Da raiz, execute `npm ci`, `npm run typecheck --workspace @ai-web3d-modeler/agent` e `npm test --workspace @ai-web3d-modeler/agent`. Os testes usam provedores programados, sem conta real.

[Configurar IA](../../docs/ai-providers.md) · [Arquitetura](../../docs/architecture.md) · [PRD](../../PRD.md).
