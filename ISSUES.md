# Forma — estado e próximos trabalhos

Baseline de 2026-10-02, alinhada ao [PRD](PRD.md). O planejamento antigo permanece no [arquivo histórico](docs/archive/README.md).

## Concluído nesta reorganização

- CAD sem perguntas (2026-10-06): ativar `noQuestions` em todas as ações CAD da interface, excluir esclarecimento do schema e interceptar respostas com perguntas no coordenador. Resolver decisões internamente com orçamento limitado, preservar contexto após quota/cancelamento e apresentar falha técnica se o modelo insistir. Verificar eixos/engate com componentes disponíveis antes de avançar e permitir um único replanejamento seletivo da criação/edição quando a validação completa exigir. Regressões reproduzem guia de 208/216 mm, pergunta sobre cavidade/altura do carro e cliente que insiste em solicitar autorização.

- Ajustes de encaixe inferidos e perguntas durante a criação (2026-10-06): distinguir requisitos explícitos do usuário das dimensões sugeridas pelo planejador; orientar o construtor a resolver deslocamentos/folgas rotineiros no componente atual, preservando corpos concluídos. Separar falta de engate de colisão real. Conservar checkpoint e pergunta pendente em esclarecimentos, inclusive após quota; não tratar perguntas como resultados concluídos no cache. Interface pausa e oferece retomada sem repetir classificação, planejamento ou peças prontas.

- Vínculos mecânicos de montagem (2026-10-06): separar aprovação geométrica de verificação mecânica; exigir contrato de ancoragem/conexões na criação pela interface; verificar montagem, guias, mancais, retenção e transmissão no motor antes de salvar. Impedir que reparos de colisão destruam vínculos. Inspecionar projetos antigos sem IA e adicionar correção de montagem com reutilização. Referência de atuador com oito corpos e volante removível, rosca real e fixações declaradas em [docs/mechanical-assemblies.md](docs/mechanical-assemblies.md).

- Auditoria geral de 2026-10-06: tratar encaixes também em poses do curso; inferir folga para envelopes móveis coaxiais no receptor fixo, preservando roscas e comandos; escolher o corpo fixo/receptor para correção e enviar todos os seus diagnósticos. Validar grupos antes da construção, enviar histórico/movimento completos aos componentes e recusar remoções em instruções negativas. Aplicar os schemas CAD compartilhados também no domínio TypeScript e rejeitar interseções inválidas/não finitas do kernel. Retirar verificações topológicas repetidas do mesmo resultado booleano e reutilizar volumes invariantes nas poses. Recuperar peça/conjunto de forma independente, ignorar inicialização de provedores substituídos, limpar tarefas de artefatos X3D após cancelamento e encerrar descendentes dos clientes de IA também em POSIX. Detalhes e evidências em [docs/audit-2026-10-06.md](docs/audit-2026-10-06.md).

- Unificar o contrato de premissas/perguntas CAD e remover limites editoriais contraditórios com o schema enviado ao modelo. Explicações longas não consomem uma retentativa nem interrompem componentes válidos; textos e geometria são conservados integralmente. Tipos inválidos e limites geométricos continuam sendo rejeitados.

- Configuração de Codex/Claude Code autenticados com assinatura, preservando WebLLM e endpoint externo. Ponte local com clientes oficiais, ferramentas desabilitadas, cancelamento/timeout e erros classificados; diagnóstico real de JSON antes de aplicar a configuração, separado da validação geométrica.
- Auditoria de consumo e retomada das assinaturas: retirar dupla codificação da resposta, distinguir JSON incompleto de quota, conservar progresso em falhas/cancelamento e impedir ciclos de formato, esclarecimento e replanejamento automático. Limites de correção pertencem ao provedor; API externa conserva seus orçamentos e reparos. Planejamento rejeita posições e movimentos inválidos antes de construir componentes. Regressões usam IA programada, sem consumo real da assinatura.
- Conservar o resultado CAD nativo validado até confirmar o salvamento, evitando nova inferência após falha de persistência. Liberar após salvar, trocar o pedido ou criar novo projeto; preservar o comportamento externo.

- Separar controladores e áreas de CAD e X3D; compartilhar provedor de IA e navegação.
- Tornar X3D local o padrão, preservando validação XSD/semântica, artefatos por revisão e compatibilidade MCP opcional.
- Incluir CadQuery na instalação padrão e um comando para iniciar API e frontend.
- Reutilizar geometria nas amostras de movimento e validação STEP entre inspeção e salvamento.
- Exportar STEP e STL do conjunto e de cada componente a partir da revisão salva; verificar posição e volume de cada sólido após reimportação.
- Salvar propostas CAD aprovadas, cancelar geração, recuperar projetos e conservar a prévia válida quando o rascunho falha.
- Atualizar interface, controles de câmera, cores dos componentes e apresentação em telas pequenas.
- Remover runtime WebLLM duplicado e editores antigos de moldes da interface. Manter contratos/API 2.x para projetos existentes.
- Arquivar documentos contraditórios e adicionar testes de navegador com API e motores geométricos reais.
- Centralizar a aceitação dos reparos de montagem: diagnóstico completo de colisões, conservação de progresso verificável, rejeição de regressões e ciclos, orçamento de 16 etapas/48 verificações. Testar duas tampas simultaneamente sobrepostas, eixos X/Y/Z e coordenadas locais deslocadas.
- Unificar reparos de encaixes cilíndricos em `assembly-fits.ts`, usando diagnóstico estruturado e geometria da peça correspondente. Verificar alinhamento, profundidade e folga em eixos distintos e coordenadas locais deslocadas com CadQuery e STEP reimportado. Preservar roscas e rejeitar propostas sem progresso geométrico.
- Centralizar a política espacial X3D: avisos de caixas delimitadoras na cena visual, separação global explicitamente selecionada, diagnósticos estruturados para todos os pares até o limite e posições preservadas por padrão. Retirar a inferência global por palavras do prompt e o deslocamento automático do fluxo normal.

- Retomada após quota: conservar também o rascunho em correção, reduzir duplicação de tokens nos reparos e trocar provedor sem reload ou perda da cena X3D. Classificar limites conhecidos, respeitar `Retry-After`/`RetryInfo` e impedir chamadas antecipadas. Persistência da geração parcial entre reloads permanece pendente.

## Correções recentes

Correção de encaixes roscados (2026-10-06): `assembly-thread-fits.ts` trata pares complementares de parâmetros iguais antes das outras estratégias. O corte interno usa centro e comprimento do receptor, incluindo margem nas faces, e fase derivada do eixo completo, deslocamentos e comando atual. Um núcleo cilíndrico que preenche os sulcos recebe alívio anular antes da rosca, limitado ao trecho roscado; munhões e o recurso helicoidal são preservados. Movimentos precisam acompanhar o avanço e geometrias ambíguas não recebem esse alívio. A mesma política de progresso verificado decide a aceitação nos dois modos de provedor, sem mudar seus contratos de resposta ou limites de chamadas. Reparos genéricos não cortam receptores roscados em caixas nem deslocam pares roscados como tampas. Testes reais cobrem X/Y/Z, eixo inclinado, dois perfis, dois sentidos, múltiplas entradas, curso fracionário e reimportação STEP. Prompts compartilhados esclarecem centro versus entrada, fase em eixo inclinado e diâmetro do núcleo.

Correção de etapas omitidas após importar rascunho (2026-10-05): separar **Corrigir interferências** da edição geral; reutilizar diretamente corpos, posições e movimentos, sem solicitar um plano. Edições dos clientes locais usam alterações pontuais (`replaceSteps`, `insertSteps`, `removeStepIds`) aplicadas deterministicamente antes da validação. Etapas omitidas ficam preservadas; IDs desconhecidos, conflitos, remoções não autorizadas e substituição de roscas por primitivas lisas são rejeitados. O botão de retomada conserva o modo de correção. O planejamento de edições gerais e os contratos da API externa permanecem compatíveis.

Correção de retomada e latência CAD (2026-10-05): conservar correções parciais verificadas da assinatura e selecionar o próximo par na retomada, sem atribuir a interferência de outro par ao componente anterior. Identificar no painel as fases IA/componente/conjunto; permitir importar JSON e baixar conjuntos pausados. Encaixes aceitam cilindros com cortes e pontas cônicas coaxiais dentro do diâmetro original, mantendo a geometria. Eliminar caixas exatas calculadas sem necessidade e reutilizar pares fixos entre amostras, preservando a validação de interseções reais.

Ampliação CAD: catálogo compartilhado entre agente e editor, roscas helicoidais internas/externas métricas e trapezoidais, dois sentidos e até quatro entradas, tubos, toros, rasgos, furos com rebaixo/escareado, loft, fillet, chamfer e shell. Grupos com fatores ligam rotação a translação; schemas JSON são gerados dos modelos Python e verificados contra eles. Testes conferem filetes, STEP reimportado, encaixes e exportações.

## Próximos trabalhos, por prioridade

1. Isolar operações do kernel CAD em processos canceláveis para impor um prazo real e encerrar cálculo interrompido. Os limites atuais de propostas/verificações não limitam a duração de uma operação nativa; abortar uma requisição HTTP não encerra necessariamente o trabalho no motor. Esse limite é distinto do cancelamento dos clientes de IA, que encerra sua árvore de processos.
2. Persistir checkpoints de geração/reparo CAD entre reloads, incluindo o rascunho do componente atual, pedido, modo e orçamento. Hoje o JSON exportado preserva a geometria disponível; o checkpoint completo permanece na memória da aba.
3. Medir qualidade, latência e custo de modelos reais em pedidos CAD e X3D representativos. Testes com respostas programadas verificam o fluxo, mas não medem capacidade de uma IA real.
4. Permitir consultar e escolher todos os projetos CAD salvos; hoje a interface recupera o último projeto de cada representação.
5. Persistir projetos e conversa X3D se recuperação após reinício passar a ser requisito; atualmente existe manifesto portátil.
6. Expandir o perfil mecânico com prova de sequência de montagem/remoção, fixadores modelados e dimensionados, uniões roscadas de fixação, guias prismáticas, mancais/engrenagens e trajetórias mais completas. Adicionar solver geral de mates, esboços com restrições, seleções locais de arestas/faces, raízes de rosca arredondadas/classes ISO e análise de cargas. A verificação atual de vínculos não cobre esses recursos.
7. Revisar carregamento do WebLLM, seus bundles grandes e o requisito de internet para carregar X3DOM na prévia HTML.
8. Adicionar autenticação e propriedade de projetos antes de disponibilizar a API como serviço compartilhado.

Os fluxos atuais de criação, validação e download estão implementados. Os limites estão em [cad-readiness.md](docs/cad-readiness.md).
