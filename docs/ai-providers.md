# Configurar e diagnosticar IA

Os agentes CAD e X3D compartilham o provedor escolhido em **Configurar IA**.

CAD compartilha o orçamento entre planejamento, revisão, construção e reparos: criação/edição até 20 chamadas, 48 inspeções distintas e 20 minutos; correção de montagem até 5 chamadas, 16 inspeções e 4 minutos. Até três correções por programa na criação e duas na correção de montagem continuam subordinadas ao orçamento global. Dois candidatos repetidos encerram o reparo; falhas de comunicação com o motor não pedem correção à IA. O prazo termina a ação do cliente, sem garantir interrupção do kernel. Planos de três ou mais peças recebem uma revisão adicional antes da construção; rascunhos disponíveis permanecem exportáveis. Medições com modelo real e script em [cad-generation-quality.md](cad-generation-quality.md).

| Opção | Autenticação | Onde a chamada acontece |
|---|---|---|
| WebLLM | Nenhuma | Navegador com WebGPU |
| Provedor externo | Chave de API, modelo e endpoint compatível com OpenAI | Navegador → provedor |
| Codex | Login ChatGPT no cliente oficial | API local → `codex exec` |
| Claude Code | Login Claude no cliente oficial | API local → `claude -p` |

Assinaturas não fornecem créditos para o modo **Provedor externo**. Os modos Codex/Claude Code usam os limites e modelos disponibilizados à conta conectada, pelos clientes oficiais. Não importam cookies ou tokens do navegador nem automatizam o site de chat.

## Assinaturas

Instale os clientes oficiais conforme a [documentação Codex](https://developers.openai.com/codex/cli) ou [Claude Code](https://code.claude.com/docs/en/setup). Faça login com `codex login` ou `claude auth login`. A API deve conseguir encontrar o executável no PATH; reinicie o servidor após a instalação. Launchers npm no Windows são resolvidos para o executável nativo ou entrada Node do pacote, sem executar um shell intermediário.

1. Selecione Codex ou Claude Code em **Configurar IA**.
2. Deixe o campo **Modelo** vazio para usar o padrão do cliente. Um identificador explícito precisa estar disponível para sua conta.
3. Clique **Verificar instalação e login**. A conta Claude pode informar o plano identificado; tokens e email não são retornados.
4. Clique **Testar conexão**. Esse teste pede `{"ok":true}`, consome uso do provedor e verifica a resposta JSON.
5. Clique **Salvar e aplicar** para usar a seleção nos agentes. O teste não altera a configuração salva.

Uma resposta aprovada no teste comprova conexão e formato para um pedido pequeno. Não comprova qualidade de peças complexas. Falhas nesse teste precedem a geometria; erros posteriores de sólido, interferência ou schema pertencem a outras etapas.

| Diagnóstico | Próxima ação |
|---|---|
| Cliente não instalado/versão incompatível | Instalar/atualizar cliente e reiniciar servidor |
| Login necessário ou recusado | Refazer login no cliente oficial |
| Modelo indisponível | Esvaziar o campo Modelo e repetir o teste |
| Quota da assinatura | Aguardar a renovação ou selecionar outro provedor |
| Serviço indisponível | Repetir mais tarde |
| Resposta JSON inválida | Conferir versão do cliente; a integração recusou o formato recebido |

Fechar o diálogo durante uma inferência cancela o pedido. A ponte aceita uma geração por vez, limita contexto/resposta e encerra o processo após cinco minutos. Acesso é restrito a loopback e origens locais autorizadas. Os clientes operam sem ferramentas e recebem apenas os dados necessários ao pedido; as validações CAD/X3D continuam obrigatórias.

Nos modos Codex/Claude Code, o JSON é solicitado diretamente na mensagem final. JSON incompleto e erros do provedor interrompem sem nova chamada de formato; o diagnóstico não comprova limite de tokens. A política padrão do SDK pausa em falha de contrato e permite uma correção geométrica adicional. A interface CAD fornece explicitamente até três correções geométricas por programa na criação/edição e duas na correção de montagem, uma correção de contrato e, quando necessário, preenchimento focado de dimensões ausentes, sempre dentro do orçamento global da ação. A interface resolve perguntas internamente com até duas respostas adicionais por etapa e pode replanejar seletivamente uma vez após falha final, conservando peças não afetadas. São chamadas ao provedor e usam a assinatura. Quota/cancelamento não provocam continuação automática. X3D conserva uma correção de aplicação por plano e suas revisões já validadas. Callers CAD sem orçamento explícito mantêm a política de seu provedor. [Recuperação CAD](cad-drafts.md) descreve exportação e retomada após falha geométrica.

Após uma interrupção CAD, retome o mesmo pedido **nesta aba**, sem recarregar, para reutilizar o plano, as peças concluídas e o rascunho disponível. O cliente permanece apto à retomada manual. Uma falha de conexão com o motor não inicia reparos pagos e a inspeção pode ser repetida sem regenerar o candidato. A peça pendente sem JSON válido precisa de uma nova resposta; os corpos anteriores não são solicitados novamente. Cada retomada com inferência usa a assinatura. O cliente oficial pode fazer suas próprias tentativas de rede; a aplicação não controla a política interna dele.

Se a construção terminar e apenas o salvamento falhar, repetir o mesmo pedido reutiliza o resultado concluído sem chamar a IA. Esse resultado permanece nesta aba até salvar, alterar o pedido ou iniciar novo projeto; o salvamento continua validando a peça no servidor.

Quando uma correção nativa reduz as colisões mas deixa outro par pendente, o conjunto atualizado é conservado. Retomar solicita a peça indicada pelo novo diagnóstico, sem gerar novamente os componentes concluídos. O painel distingue IA gerando, componente em validação e conjunto em validação; essas duas últimas fases são cálculos locais. O prazo da ponte de IA não limita operações do kernel CAD.

Para preservar um conjunto pausado antes de fechar a aba, use **Baixar rascunho com erro (JSON)**. Em **Conjunto composto**, **Importar rascunho CAD (JSON)** recupera a geometria sem chamar a IA. Uma modificação pelo agente pode pedir um novo planejamento de edição, mas recebe todos os componentes importados. Importação não garante validade geométrica: a revisão precisa passar pelas verificações antes de habilitar STEP/STL.

Para corrigir um conjunto importado, use **Corrigir interferências**. Esse botão valida e tenta encaixes locais sem solicitar outro plano ou regenerar peças. Quando uma correção exigir IA, envia somente a edição do componente pendente; na assinatura, a resposta lista substituições por ID e inserções, preservando automaticamente etapas omitidas. Exclusões exigem uma lista explícita e continuam sujeitas às regras de preservação. Se pausar, **Retomar correção** continua esse fluxo. O campo de pedido e **Modificar conjunto com IA** servem para alterações gerais e podem solicitar planejamento.

O comportamento nativo está documentado em [Codex não interativo](https://learn.chatgpt.com/docs/non-interactive-mode) e [Claude Code não interativo](https://code.claude.com/docs/en/headless). A disponibilidade de uso da assinatura é definida pelos serviços e pode mudar.
