# Relatório de auditoria técnica — AI Web3D Modeler

Data da auditoria: 2026-09-22  
Rastreabilidade revisada em: 2026-09-23<br>
Escopo: código-fonte, PRD, plano de issues, READMEs, configuração de CI, submódulo e histórico Git local.

## Resumo executivo

Foram consolidados 21 pontos: 8 de prioridade alta, 10 de prioridade média e 3 de prioridade baixa. O achado 1 já foi corrigido; os demais continuam abertos até que seus critérios de aceite sejam implementados e testados. Os riscos altos ainda abertos são:

1. o script documentado de inicialização do MCP não é executável em Linux;
2. a API anuncia `.x3dj` como disponível embora esse formato seja sabidamente impossível com a versão fixada do MCP;
3. a validação semântica pode aceitar como válida uma resposta do MCP em formato desconhecido;
4. uma corrida no endpoint de preview pode servir conteúdo antigo com número de revisão novo;
5. a API aceita planos que o JSON Schema oficial rejeita;
6. sessões expiradas e abandonadas nunca são removidas da memória;
7. o contexto conversacional enviado ao modelo está incompleto e, após uma pergunta de esclarecimento, duplica a resposta do usuário;
8. o modo de desenvolvimento do React pode inicializar duas sessões e dois runtimes WebLLM.

Os testes existentes são úteis e todos passaram no ambiente já preparado, mas não cobrem esses cenários. A CI atual também não executa nenhuma suíte de testes. As lacunas de desempenho relatadas durante o uso foram incorporadas explicitamente: reconstrução redundante de artefatos, excesso de round-trips MCP sequenciais e ausência de telemetria/progresso por etapa.

## Verificações executadas

- `apps/api`: 121 testes passaram; Ruff e mypy passaram. Foram emitidos 2 avisos de depreciação de FastAPI/Starlette.
- `packages/domain/python`: 27 testes passaram; Ruff e mypy passaram.
- `apps/web`: 20 testes passaram; typecheck e Oxlint passaram no workspace já instalado.
- `packages/agent`: 38 testes da versão commitada passaram; typecheck passou.
- `packages/domain/ts`: 14 testes passaram; typecheck passou.
- Total da versão commitada auditada: 220 testes aprovados.
- `git fsck --full --no-reflogs`: nenhum objeto referenciado corrompido; foi observado apenas um commit dangling, sem referência ativa.
- Não foi executado build de produção, em respeito à regra do `CLAUDE.md` de não executar build sem pedido explícito.
- Foi feita uma simulação de checkout limpo removendo temporariamente apenas a visibilidade de `packages/agent/node_modules`; o typecheck do frontend falhou com `TS2307` para `ajv/dist/2020.js` e `@mlc-ai/web-llm`. A pasta foi restaurada imediatamente e o workspace permaneceu intacto.

Durante a higienização do Git surgiram alterações concorrentes em `PRD-AI-Web3D-Modeler-v1.0.md` e `packages/agent` (novo `OpenAICompatibleProvider`, export, documentação e testes). Elas foram preservadas integralmente. Como outro processo já as havia adicionado ao índice no instante do amend final, passaram a integrar o mesmo commit deste relatório; nenhuma implementação foi removida ou descartada. Após a restauração, a suíte do agente passou com 47 testes e o typecheck passou; com esses 9 testes adicionais, o workspace atual soma 229 testes aprovados. A leitura rápida dessas mudanças não alterou os achados abaixo.

## Achados

### Matriz de rastreabilidade

`Coberta` significa que uma issue existente teve seu escopo e critérios de aceite ampliados neste levantamento. `Nova` significa que o plano anterior não previa a correção e recebeu uma issue específica. Uma issue só pode ser encerrada quando os testes de regressão indicados nela também estiverem presentes.

| Achado | Estado | Issues de implementação | Cobertura exigida |
|---|---|---|---|
| 1 | Corrigido; manter regressão | #1, #48 e #66 | Workspace/lockfile raiz, instalação limpa e matriz CI. |
| 2 | Aberto — coberta | #2, #46 e #66 | Bit executável, comando documentado e verificação Linux. |
| 3 | Aberto — coberta | #13, #30 e #42 | Capacidade real por formato, UI condicional e teste do pin atual. |
| 4 | Aberto — coberta | #10 e #42 | Parser fail-closed e teste de relatório desconhecido/parcial. |
| 5 | Aberto — nova | #63 | Snapshot imutável e artefato identificado pela revisão exata. |
| 6 | Aberto — coberta | #5, #6 e #41 | Equivalência entre JSON Schema, Pydantic e TypeScript. |
| 7 | Aberto — coberta | #8, #24 e #39 | Coleta de expiradas, limite global, body/rate limit. |
| 8 | Aberto — coberta | #20, #27, #34 e #45 | Histórico limitado, esclarecimento sem duplicação e regressão E2E. |
| 9 | Aberto — coberta | #16, #27 e #45 | Inicialização idempotente, descarte e teste sob `StrictMode`. |
| 10 | Aberto — coberta | #21 e #23 | Envelope único e correlação em corpo, header e logs. |
| 11 | Aberto — coberta | #21, #27, #29 e #45 | Retry/recriação explícita após falha inicial ou expiração. |
| 12 | Aberto — nova | #66 | Todas as suítes, pacotes e integração MCP na CI. |
| 13 | Aberto — nova | #63 | Cache limitado e coalescido por projeto/revisão/formato. |
| 14 | Aberto — coberta | #28, #44 e #45 | Revogação somente depois da troca/carregamento do iframe. |
| 15 | Aberto — coberta | #9 e #54 | Background básico no MVP; controles ricos continuam pós-MVP. |
| 16 | Aberto — coberta | #22 e #29 | `no_change` sem MCP, commit ou incremento de revisão. |
| 17 | Aberto — coberta | #10 e #32 | Separação entre `info`, `warning` e `error`. |
| 18 | Aberto — coberta | #4, #37 e #42 | Cancelamento propagado sem virar indisponibilidade. |
| 19 | Aberto — coberta | #3, #46 e #47 | Um entrypoint canônico, funcional e testado. |
| 20 | Aberto — nova | #64 | Construção em lote ou redução mensurável de round-trips MCP. |
| 21 | Aberto — nova | #65 | Tempos por etapa, progresso e correlação ponta a ponta. |

### 1. [Alta] O frontend não funciona em checkout limpo nem na CI atual

**Status em 2026-09-22:** corrigido com um npm workspace na raiz, lockfile único para a instalação reproduzível e CI executada a partir da raiz. O frontend, o agente e o domínio TypeScript agora recebem suas dependências no mesmo `npm ci`.

**Evidência:** [`apps/web`](apps/web/package.json#L14) importa diretamente arquivos-fonte de [`packages/agent`](packages/agent/package.json#L10), mas não existe workspace npm na raiz nem uma dependência `file:`/workspace entre os pacotes. A CI executa apenas `npm ci` dentro de `apps/web` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml#L22)). O código importado procura `ajv` e `@mlc-ai/web-llm` a partir de `packages/agent/src`; em um checkout limpo, `packages/agent/node_modules` não existe.

**Reprodução confirmada:** ao tornar temporariamente indisponível somente `packages/agent/node_modules`, `npm run typecheck` em `apps/web` falhou com três erros `TS2307`. O sucesso local anterior dependia de instalações manuais existentes em diretórios irmãos.

**Impacto:** o primeiro push tende a deixar a job `web` vermelha; novos desenvolvedores não conseguem seguir apenas o README; deploys reprodutíveis não existem.

**Correção sugerida:** criar um npm workspace na raiz e declarar `@ai-web3d-modeler/agent` e `@ai-web3d-modeler/domain` como dependências workspace do frontend. Como alternativa mínima, instalar cada pacote na CI e empacotá-los corretamente, mas isso mantém resolução frágil por caminhos relativos.

**Rastreamento de implementação:** correção já aplicada no escopo das Issues #1 e #48. A Issue #66 deve manter a instalação limpa e os testes de todos os workspaces como barreira de regressão.

### 2. [Alta] O script documentado para iniciar `x3d_mcp` não é executável no Git

**Evidência:** `git ls-files --stage services/x3d-mcp/run.sh` retorna modo `100644`, enquanto o README manda executar `./services/x3d-mcp/run.sh` ([`run.sh`](services/x3d-mcp/run.sh#L1)). Em Linux, esse comando falha com `Permission denied`.

**Impacto:** o procedimento oficial de inicialização quebra em Linux, containers e runners de CI.

**Correção sugerida:** versionar o bit executável (`git update-index --chmod=+x services/x3d-mcp/run.sh`) e acrescentar um teste simples de startup ou, no mínimo, validação do modo na CI.

**Rastreamento de implementação:** Issues #2 e #46 ampliadas para cobrir permissão, comando canônico e documentação; Issue #66 exige verificação automatizada em runner Linux.

### 3. [Alta] A API declara `.x3dj` disponível mesmo sabendo que sempre falha

**Evidência:** [`routes/plans.py`](apps/api/src/api/routes/plans.py#L68) lista `x3dj` e cria todos os descritores com `available=True` ([linha 197](apps/api/src/api/routes/plans.py#L197)). Ao mesmo tempo, README, documentação e [`test_artifacts.py`](apps/api/tests/test_artifacts.py#L167) registram que a versão fixada do upstream nunca produz JSON válido e que `.x3dj` está indisponível para toda revisão.

**Impacto:** o frontend recebe uma capacidade falsa; uma futura interface habilitará um download que inevitavelmente termina em erro. Isso viola o critério “format appears in UI only if available” da Issue #13.

**Correção sugerida:** omitir `x3dj` ou retornar `available=False` enquanto o pin atual estiver em uso. Idealmente, capacidades de artefato devem ser calculadas por configuração/health check, não codificadas como verdadeiras.

**Rastreamento de implementação:** Issues #13 e #30 ampliadas para exigir descoberta de capacidade baseada no conversor realmente testado; Issue #42 cobre a indisponibilidade conhecida do `.x3dj` sem afetar X3D/HTML.

### 4. [Alta] A validação semântica falha aberta quando o relatório muda de formato

**Evidência:** [`_parse_semantic_report`](apps/api/src/api/x3d_validation.py#L97) reconhece alguns cabeçalhos e linhas Markdown. Qualquer resposta não vazia que não combine com esses padrões termina em `diagnostics=()` ([linha 115](apps/api/src/api/x3d_validation.py#L115)); `semantic_valid` então se torna `True` por ausência de diagnósticos de erro.

**Cenário:** se o MCP atualizar o texto para outro cabeçalho, retornar uma mensagem parcial ou alterar a sintaxe dos bullets, uma cena semanticamente inválida poderá ser aceita e commitada.

**Impacto:** quebra a principal invariante do PRD: nada deve ser considerado válido até passar na validação semântica do MCP.

**Correção sugerida:** reconhecer explicitamente um marcador inequívoco de sucesso e tratar qualquer formato desconhecido, vazio ou parcialmente analisado como erro de protocolo. Preferir uma resposta estruturada do MCP quando disponível.

**Rastreamento de implementação:** Issues #10 e #42 ampliadas com comportamento fail-closed, fixtures de formatos desconhecidos/parciais e bloqueio de commit quando o resultado não puder ser interpretado com segurança.

### 5. [Alta] Corrida no preview pode associar X3D antigo a uma revisão nova

**Evidência:** o endpoint obtém um objeto `ProjectSession` mutável ([`routes/artifacts.py`](apps/api/src/api/routes/artifacts.py#L45)), passa `session.model_spec` para uma operação assíncrona ([linha 51](apps/api/src/api/routes/artifacts.py#L51)) e só depois lê novamente `session.revision` ([linha 57](apps/api/src/api/routes/artifacts.py#L57)). `commit_revision` altera esse mesmo objeto de sessão em memória.

**Interleaving possível:** (1) preview captura o ModelSpec da revisão 1; (2) aguarda MCP; (3) outro request commita a revisão 2 e muta `session`; (4) preview volta e usa `session.revision == 2` junto do X3D gerado da revisão 1. Se o cliente pediu revisão 2, a checagem passa e HTML antigo é servido como revisão 2.

**Impacto:** a revisão exibida deixa de ser confiável e viola a regra de renderizar a revisão validada corrente.

**Correção sugerida:** copiar `model_spec` e `revision` para variáveis imutáveis antes do primeiro `await`, validar a revisão solicitada imediatamente e revalidar o estado antes de responder; melhor ainda, armazenar o X3D validado por revisão.

**Rastreamento de implementação:** nova Issue #63. Ela une snapshot imutável, cache por revisão e testes de concorrência para impedir que conteúdo de uma revisão seja rotulado como outra.

### 6. [Alta] Os modelos Python não implementam estritamente o JSON Schema oficial

**Evidência:** os modelos Pydantic usam coerção padrão e omitem alguns `min_length`. Foram confirmadas as seguintes entradas aceitas pelo backend e rejeitadas pelos schemas:

- `expectedRevision: "0"` é convertido para inteiro;
- dimensões `"1"` e `true` são convertidas para `1.0`;
- `CreateObject.tags: [""]` é aceito, embora os itens exijam `minLength: 1`;
- `SetScene.background: ""` e `ModelSpec.scene.background: ""` são aceitos;
- `NoChange.reason: ""` é aceito.

Os campos correspondentes podem ser vistos em [`model_plan.py`](packages/domain/python/src/domain/model_plan.py#L63) e [`model_spec.py`](packages/domain/python/src/domain/model_spec.py#L25). A API valida diretamente com Pydantic e não executa o JSON Schema antes da mutação.

**Impacto:** clientes podem enviar contratos inválidos e, nos casos de tags/background vazios, o servidor pode commitar e devolver um `ModelSpec` que não valida contra sua própria fonte de verdade.

**Correção sugerida:** habilitar modelos estritos (`ConfigDict(strict=True, extra="forbid")` ou tipos estritos apropriados), espelhar todos os `minLength` e adicionar testes parametrizados que exijam equivalência: todo fixture rejeitado pelo schema também deve ser rejeitado pelo modelo Python.

**Rastreamento de implementação:** Issues #5 e #6 ampliadas para declarar o JSON Schema como fonte de verdade; Issue #41 exige testes diferenciais de aceitação/rejeição entre JSON Schema, Pydantic e TypeScript.

### 7. [Alta] TTL não libera sessões abandonadas e a memória pode crescer sem limite

**Evidência:** sessões são inseridas em `_sessions` em [`projects.py`](apps/api/src/api/projects.py#L91). A expiração só é testada ao chamar `get_project` para aquele mesmo ID ([linha 109](apps/api/src/api/projects.py#L109)); `create_project` não varre expiradas e não existe tarefa periódica de limpeza.

**Impacto:** sessões que expiram sem novo acesso permanecem para sempre. Como `POST /api/projects` não tem rate limit nem limite global de sessões, um cliente pode consumir memória indefinidamente, contrariando §11.6 do PRD e o próprio objetivo do TTL.

**Correção sugerida:** implementar coleta periódica ou varredura amortizada na criação/acesso, impor número máximo de sessões e rate limit por IP/sessão. Em implantação pública, adicionar limite de corpo antes do parse; hoje apenas intent/operações/objetos/artefatos são limitados depois que a requisição já entrou em memória.

**Rastreamento de implementação:** Issues #8, #24 e #39 ampliadas. O escopo agora separa ciclo de vida da sessão, limites antes do parse e proteção de implantação pública, com teste de sessões expiradas nunca revisitadas.

### 8. [Alta] O contexto conversacional está incompleto e a resposta de esclarecimento é duplicada

**Evidência:** em mensagens comuns, `ChatController` passa `recentMessages=[]`; o histórico visível nunca chega ao agente. No fluxo de esclarecimento, [`ChatController.ts`](apps/web/src/chat/ChatController.ts#L182) usa `buildClarificationFollowUp(question, trimmed)`, que já cria os turnos `assistant + user`, e simultaneamente passa `request: trimmed` ([linha 191](apps/web/src/chat/ChatController.ts#L191)). [`generateModelPlan`](packages/agent/src/generate-model-plan.ts#L72) sempre acrescenta novamente o request como outro turno `user`.

**Resultado real:** `system → assistant(pergunta) → user(resposta) → user(mesma resposta)`. Fora desse caso, não há histórico algum.

**Impacto:** o modelo pode interpretar a resposta duas vezes, produzir planos instáveis e falhar em referências conversacionais que não estejam completamente representadas no ModelSpec.

**Correção sugerida:** manter uma janela limitada de mensagens de agente/usuário. Para esclarecimento, passar apenas a pergunta anterior em `recentMessages` e deixar a resposta ser o `request`, ou mudar a API de geração para não reapendê-la.

**Rastreamento de implementação:** Issues #20, #27 e #34 ampliadas para definir uma única montagem de histórico e uma janela limitada; Issue #45 cobre a duplicação da resposta e referências conversacionais em um fluxo completo.

### 9. [Alta] `StrictMode` pode criar dois projetos e inicializar dois WebLLM em desenvolvimento

**Evidência:** [`main.tsx`](apps/web/src/main.tsx#L7) usa React `StrictMode`; [`useChatController.ts`](apps/web/src/chat/useChatController.ts#L70) inicia efeitos sem cleanup e chama `controller.initialize()`. O método não é idempotente e dispara tanto `provider.initialize()` quanto `createProject()` ([`ChatController.ts`](apps/web/src/chat/ChatController.ts#L140)). Em desenvolvimento, StrictMode reexecuta efeitos para detectar side effects.

**Impacto:** podem ocorrer dois downloads/inicializações de modelo, dois Workers e duas sessões backend; a resposta que chegar por último vence, deixando a outra sessão órfã. Isso agrava o vazamento do achado 7.

**Correção sugerida:** tornar `initialize()` idempotente compartilhando uma única Promise, ou controlar a inicialização fora de um efeito reexecutável. Implementar também `dispose()`/cleanup para listener, Worker e sessão.

**Rastreamento de implementação:** Issues #16 e #27 ampliadas com contrato idempotente e descarte de recursos; Issue #45 exige regressão em `StrictMode`, comprovando uma sessão e um runtime ativos.

### 10. [Média] O corpo de erro não segue o contrato do PRD e um caminho perde o header de correlação

**Evidência:** o PRD §9.4 define corpo no topo `{code, message, details, correlationId}`. [`errors.py`](apps/api/src/api/errors.py#L81) devolve `{"detail": {...}}`, e os testes foram escritos para esse formato divergente. Além disso, o caminho `AMBIGUOUS_TARGET` usa `HTTPException`; em reprodução direta, a resposta 422 continha o ID no JSON, mas não continha `X-Correlation-Id`, apesar de [`plans.py`](apps/api/src/api/routes/plans.py#L123) prometer o header em sucesso e erro.

**Impacto:** integrações guiadas pelo PRD quebram; tratamento de erro fica acoplado à convenção interna do FastAPI; observabilidade é inconsistente justamente em um fluxo esperado.

**Correção sugerida:** escolher e documentar um único contrato. Para cumprir o PRD, retornar os quatro campos no topo por handler próprio também para ambiguidade e sempre adicionar o header.

**Rastreamento de implementação:** Issues #21 e #23 ampliadas. Todos os erros, inclusive `AMBIGUOUS_TARGET`, devem usar o mesmo envelope e repetir o mesmo correlation ID no corpo, header e log.

### 11. [Média] O frontend não se recupera de falha de criação ou expiração de sessão

**Evidência:** uma falha inicial define `projectError` e desabilita o envio permanentemente ([`ChatController.ts`](apps/web/src/chat/ChatController.ts#L147)); não há ação de retry. Se uma sessão expira depois, `PROJECT_NOT_FOUND` apenas vira mensagem de erro e o controller preserva `projectId`/`modelSpec` antigos, então toda tentativa futura repete o erro.

**Impacto:** uma indisponibilidade transitória da API ou o TTL normal obriga o usuário a recarregar a página e perder a conversa.

**Correção sugerida:** expor “tentar novamente/nova sessão”, detectar `PROJECT_NOT_FOUND`, recriar o projeto de forma explícita e informar o que será perdido/restaurado.

**Rastreamento de implementação:** Issues #21, #27 e #29 ampliadas com estados de recuperação; Issue #45 exige testes de falha inicial e expiração durante uma conversa.

### 12. [Média] A CI não executa testes e não cobre três dos quatro pacotes principais

**Evidência:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml#L8) executa lint/typecheck/build apenas em `apps/web` e lint/typecheck em `apps/api`. Não executa `npm test`, `pytest`, `packages/agent`, `packages/domain/ts` nem `packages/domain/python`. Também não inicializa o submódulo para testes de integração.

**Impacto:** regressões podem ser aceitas mesmo com 220 testes locais existentes. Isso viola a seção 12.7 do PRD, que exige testes de domínio, schemas, contrato MCP e golden scenes.

**Correção sugerida:** criar jobs por pacote, usar cache, inicializar o submódulo e rodar a suíte MCP separadamente quando necessário. Um workspace raiz simplificará essa matriz.

**Rastreamento de implementação:** nova Issue #66. Ela define a matriz obrigatória, instalação limpa, submódulo fixado, separação entre testes rápidos e integração MCP e proteção contra jobs que passam sem descobrir testes.

### 13. [Média] Cada abertura de preview reconstrói e revalida toda a cena

**Evidência:** [`GET /artifacts/html`](apps/api/src/api/routes/artifacts.py#L51) chama `build_and_validate_candidate` para cada acesso. O adapter reseta a cena e, para cada objeto, realiza várias chamadas MCP sequenciais para criar Transform, Shape, Appearance, Material, geometria, filhos e DEF. Depois ainda executa serialização, duas validações e geração de página.

**Impacto:** custo e latência crescem linearmente com até 100 objetos e com cada refresh/reabertura, embora a mesma revisão já tenha sido validada no commit. Isso amplia a janela da corrida do achado 5 e pressiona o timeout de 30 s por chamada/60 s por orquestração recomendado no PRD.

**Correção sugerida:** guardar, por revisão, o X3D validado e opcionalmente o HTML gerado; invalidar o cache apenas em novo commit. Se persistência não for desejada, manter cache limitado em memória junto da sessão.

**Rastreamento de implementação:** nova Issue #63 cobre cache imutável/coalescido, limites e invalidação; a Issue #64 cobre o custo ainda necessário na primeira construção da revisão; a Issue #65 mede separadamente geração, MCP, validação e carregamento do viewer.

### 14. [Média] O Blob URL anterior é revogado antes de o iframe trocar de `src`

**Evidência:** [`BlobUrlTracker.set`](apps/web/src/viewer/objectUrl.ts#L33) cria a nova URL e revoga a anterior imediatamente. Só depois `X3DPreviewFrame` chama `setBlobUrl(...)` ([`X3DPreviewFrame.tsx`](apps/web/src/viewer/X3DPreviewFrame.tsx#L45)); a atualização do DOM pelo React é assíncrona. Portanto, no momento da revogação, o iframe ainda pode apontar para a URL antiga.

**Impacto:** pode haver tela em branco/flicker e o comportamento contradiz literalmente o requisito “prior Blob URL is revoked after replacement”. O teste atual verifica apenas a ordem dentro do tracker, não a troca real do iframe.

**Correção sugerida:** manter a URL anterior até o `onLoad` da nova URL (ou pelo menos até um efeito pós-commit do React) e então revogá-la. Adicionar teste de componente/browser.

**Rastreamento de implementação:** Issue #28 ampliada com protocolo de troca e descarte; Issues #44 e #45 devem testar atualização bem-sucedida, falha da nova URL e unmount sem vazamento.

### 15. [Média] `set_scene.background` é aceito e persistido, mas não afeta o X3D

**Evidência:** a mutação aplica `background` ao ModelSpec ([`mutation.py`](apps/api/src/api/mutation.py#L282)), mas [`apply_model_spec`](apps/api/src/api/x3d_adapter.py#L39) só recria objetos e nunca cria/configura um nó `Background`.

**Impacto:** a API confirma uma revisão e o manifesto muda, mas o preview não mostra a alteração solicitada. Há também uma inconsistência de produto: `set_scene`/`background` aparecem no domínio atual, enquanto o roadmap chama controles de background de Phase 2.

**Correção sugerida:** decidir no PRD se background básico é MVP. Se for, mapear cor validada para X3D `Background`; se não for, remover o campo/operação do contrato atual ou rejeitá-lo claramente até a fase correspondente.

**Rastreamento de implementação:** Issue #9 ampliada para o background básico já presente no contrato MVP. A Issue #54 permanece reservada para iluminação, viewpoints e controles de cena ricos, evitando adiar silenciosamente uma operação já aceita.

### 16. [Média] Planos `no_change` criam revisão e fazem round-trip MCP completo

**Evidência:** o próprio PRD documenta que planos vazios/`no_change` não são tratados especialmente. Eles passam por apply, reconstrução, validação e `commit_revision`, incrementando a revisão apesar de nenhum estado semântico mudar.

**Impacto:** revisões deixam de representar mudanças reais, há trabalho MCP desnecessário e conflitos otimistas podem ocorrer por uma resposta meramente informativa.

**Correção sugerida:** retornar sucesso sem commit para um plano sem efeito, ou definir explicitamente um tipo de resposta conversacional que não passe pela transação de geometria.

**Rastreamento de implementação:** Issues #22 e #29 ampliadas. O critério é objetivo: `no_change` não chama MCP, não cria artefato, não incrementa revisão e mantém o último preview válido.

### 17. [Baixa] Diagnósticos `info` são apresentados como warnings

**Evidência:** [`ValidationResult.to_summary`](apps/api/src/api/x3d_validation.py#L83) inclui todo diagnóstico cujo nível não seja `error` na lista `warnings` ([linha 91](apps/api/src/api/x3d_validation.py#L91)).

**Impacto:** mensagens informativas elevam artificialmente a contagem de avisos exibida ao usuário.

**Correção sugerida:** filtrar apenas `level == "warning"` ou criar campo separado `info`.

**Rastreamento de implementação:** Issues #10 e #32 ampliadas para preservar severidade ponta a ponta e testar contagens separadas de informações, avisos e erros.

### 18. [Baixa] Cancelamento durante conexão MCP pode ser convertido em indisponibilidade

**Evidência:** [`X3DMcpClient.connect`](apps/api/src/api/mcp_client.py#L61) captura `BaseException` na fase de conexão. Isso inclui exceções de cancelamento e sinais que normalmente devem propagar.

**Impacto:** um request cancelado pode ser relatado/logado como `MCP_UNAVAILABLE` e o cancelamento cooperativo pode ser atrasado ou mascarado.

**Correção sugerida:** capturar apenas as exceções de transporte/protocolo esperadas (`Exception` mais tipos específicos) e sempre propagar cancelamento.

**Rastreamento de implementação:** Issues #4 e #37 ampliadas com semântica de cancelamento no backend; Issue #42 verifica que cancelamento não é convertido em `MCP_UNAVAILABLE`.

### 19. [Baixa] O entrypoint instalado `api` não inicia a aplicação

**Evidência:** `pyproject.toml` declara `api = "api:main"`, mas [`apps/api/src/api/__init__.py`](apps/api/src/api/__init__.py#L1) apenas imprime `Hello from api!`.

**Impacto:** `uv run api` parece ser um comando oficial, porém não inicia o servidor. Isso causa confusão operacional e é resíduo do scaffold.

**Correção sugerida:** remover o entrypoint ou fazê-lo iniciar Uvicorn de modo documentado; manter `uv run uvicorn api.main:app ...` como única interface também é válido.

**Rastreamento de implementação:** Issues #3, #46 e #47 ampliadas para selecionar um único comando canônico, remover o scaffold enganoso e testar o mesmo caminho em desenvolvimento e container.

### 20. [Média] A construção de cenas multiplica round-trips MCP sequenciais por objeto

**Evidência:** [`apply_model_spec`](apps/api/src/api/x3d_adapter.py#L39) percorre os objetos e aguarda separadamente a criação/configuração de Transform, Shape, Appearance, Material, geometria, vínculos e identificadores. Uma mesa com jarro e cadeira se decompõe em várias primitivas; cada primitiva multiplica chamadas HTTP/MCP, serialização e latência de rede, mesmo quando a API externa de IA já terminou.

**Impacto:** o tempo de construção cresce com objetos × nós × chamadas, não apenas com a complexidade semântica do pedido. Usar uma API de IA mais rápida reduz somente a geração do plano e não elimina esse gargalo backend/MCP.

**Correção sugerida:** criar uma operação de construção em lote no wrapper/adaptador, ou ao menos agrupar comandos independentes com concorrência limitada quando o upstream permitir. Preservar ordem determinística, rollback e validação final; medir chamadas e duração antes/depois.

**Rastreamento de implementação:** nova Issue #64, com orçamento de round-trips, benchmark de uma cena composta e fallback explícito caso o upstream não ofereça batch nativo.

### 21. [Média] A latência ponta a ponta não é decomposta e o usuário fica sem progresso útil

**Evidência:** a interface expõe estados amplos de carregamento, mas a resposta não informa quanto tempo foi gasto em provedor/repair, validação local do plano, API, mutação, MCP, validação X3D, artefato e carregamento do iframe. Sem essa decomposição, uma demora da API externa é visualmente indistinguível de reconstrução MCP, retry por 503 ou espera do preview.

**Impacto:** falhas de desempenho não podem ser diagnosticadas com precisão; retries transitórios parecem travamento; o usuário não sabe se deve aguardar ou cancelar. Isso também impede verificar o requisito não funcional de duração por etapa.

**Correção sugerida:** registrar tempos monotônicos por estágio sob o mesmo correlation ID, devolver métricas seguras no modo de diagnóstico e apresentar progresso textual sem expor prompts, chaves ou respostas privadas. Definir orçamento e teste para cenário simples e composto.

**Rastreamento de implementação:** nova Issue #65. A Issue #32 consumirá esses estágios na UI e a Issue #43 incorporará as métricas aos benchmarks.

## Auditoria do histórico Git

Estado observado antes da higienização:

- não existe remoto nem upstream configurado;
- havia 27 commits locais alcançáveis em `main`, portanto todos foram tratados como ainda não publicados;
- autor e committer dos 27 já eram `Arthur Santos <arthursantos.homeoffice@gmail.com>`;
- nenhum commit possuía assinatura GPG;
- todos os 27 continham o trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`;
- `CLAUDE.md` estava rastreado e aparecia em três commits do histórico.

Higienização aplicada após a auditoria:

- `CLAUDE.md` foi incluído no `.gitignore`, removido do índice e expurgado de todo o histórico alcançável;
- todos os commits locais, incluindo o commit deste relatório, foram reescritos com autor e committer `Arthur Santos <arthursantos.homeoffice@gmail.com>`;
- trailers de coautoria foram removidos;
- assinaturas não foram adicionadas;
- refs de backup da reescrita foram removidas para impedir que o histórico antigo seja enviado acidentalmente.

Na data da auditoria inicial ainda não havia remoto configurado, portanto aquela etapa não pôde comparar hashes com GitHub. Posteriormente o repositório passou a usar `origin` em `arthursantos67/MCPx3d`; a verificação de autoria, trailers, assinaturas e exclusão histórica de `CLAUDE.md` deve continuar fazendo parte de qualquer reescrita/push forçado futuro.

## Ordem recomendada de correção

1. Concluir a reproducibilidade operacional: tornar `run.sh` executável e implementar a matriz completa da Issue #66; o workspace/lockfile do achado 1 já foi corrigido.
2. Fechar as falhas de integridade: parser semântico fail-closed (#10/#42), snapshot atômico/cache por revisão (#63) e validação estrita equivalente ao schema (#5/#6/#41).
3. Implementar coleta/limites de sessão (#8/#24/#39) e inicialização idempotente com descarte (#16/#27).
4. Corrigir capacidades de artefato, background básico, contrato de erros, recuperação de sessão, histórico conversacional e ciclo de Blob URLs nas issues ampliadas indicadas na matriz.
5. Eliminar trabalho redundante e reduzir latência com cache (#63) e batching MCP (#64), preservando validação, rollback e cancelamento.
6. Instrumentar tempos/progresso por etapa (#65), incorporar as métricas ao benchmark (#43) e executar todas as regressões na CI (#66).
