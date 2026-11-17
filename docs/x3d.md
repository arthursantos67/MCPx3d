# X3D: cenas por conversa

Abra o workspace X3D e descreva a cena ou aplique uma receita. Depois peça alterações na mesma conversa: adicionar/remover objetos, mover, redimensionar ou trocar materiais. O agente retorna `ModelPlan` JSON; o domínio aplica as operações ao `ModelSpec` e a API constrói a cena.

## Validação e prévia

Schema, domínio, XSD e semântica são obrigatórios. Uma proposta inválida não substitui a revisão válida. A prévia HTML roda em iframe com sandbox; X3DOM é carregado pela internet.

A política visual permite composição e registra sobreposições de caixas como avisos. Esses avisos não demonstram colisão de superfícies. A opção Exigir separação entre todos os objetos bloqueia sobreposições das caixas em toda a cena. Posições não são corrigidas automaticamente no fluxo padrão.

## Exportar e reabrir

| Formato | Uso |
|---|---|
| X3D | Cena XML para visualizadores compatíveis |
| HTML | Página com visualizador X3DOM externo |
| ClassicVRML | Representação textual da cena |
| Manifesto JSON | Documento do projeto para importar e continuar editando |

Exporte o manifesto antes de reiniciar a API. As sessões vivem na memória do servidor e expiram após uma hora de inatividade por padrão; receitas usam SQLite. O manifesto não é X3DJ. A conversão X3DJ da biblioteca fixada permanece indisponível por falhar na validação de JSON.

## Biblioteca e MCP

O backend padrão constrói e valida localmente com a biblioteca do submódulo. Não é necessário iniciar servidor MCP. Para interoperabilidade remota, consulte [X3D e MCP opcional](x3d-mcp.md). Consulte as [rotas da API](../apps/api/README.md) e os [contratos do domínio](../packages/domain/README.md).
