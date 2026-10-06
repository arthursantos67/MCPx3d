# Verificação da reorganização — 2026-10-02

Executada localmente em Windows/PowerShell, Node 24, Python 3.12 e Chrome instalado. Nenhum commit ou publicação foi realizado. A configuração CI foi atualizada, mas não executada no GitHub nesta sessão.

## CAD autônomo sem perguntas — 2026-10-06

A interface passou a ativar `noQuestions=true` em criação, edição e reparo CAD. A correção anterior de instruções não impedia o modelo de devolver uma pergunta; agora o schema exclui `clarify` e o coordenador intercepta essa resposta, permitindo até duas tentativas internas de resolução por etapa. Insistência produz uma falha técnica sem texto de autorização, preservando a decisão pendente e os corpos concluídos. Quota/cancelamento interrompem sem chamadas adicionais. Um replanejamento seletivo após validação final pode rever componentes necessários uma única vez; o modo de reparo direto conserva seu fluxo.

**418 testes TypeScript passaram**: 58 web, 289 agente, 69 domínio e 2 golden. **27 testes de navegador passaram em 4,8 minutos**, incluindo resolução automática de uma pergunta sobre o carro, limite para perguntas repetidas sobre a guia e retomada sem reconstruir a base. Typecheck, lint web e build passaram. A suíte Python completa não foi repetida, pois o código de produção da API não mudou. Seis casos nativos direcionados passaram (duas dimensões de guia e quatro variantes de evidência roscada); o novo teste de carro passou após corrigir a consulta de material para usar o sólido do Workplane. Ruff da API passou. Os modelos usados pelos testes são programados, sem inferência real nesta etapa.

As regressões verificam perguntas sobre guia, munhões e altura/furos do carro; schema de edição incremental sem esclarecimento; limite de tentativas; retomada após quota; conservação do spec durante quota em replanejamento; e correção de uma guia antes de aceitar seu componente. A comparação antecipada de eixos/engate inclui seis poses e complementa as verificações nativas obrigatórias.

No motor real, a guia Ø8×208 centrada ocupa [-104,104] e engata 8 mm nos furos [-108,-96]/[96,108]; Ø8×216 alcança os 12 mm declarados sem alterar os suportes. A regressão do carro usa bloco 50×80×50, cavidade Ø22,4 no eixo local Z=-10 e furos Ø5,5 em Y=±18/Z=-10: conserva 3,8 mm de parede inferior, material entre cavidade e furos e um sólido válido após reimportar STEP. Esses fixtures reproduzem os conflitos informados, não o conjunto completo do usuário; a montagem final ainda passa por interferências e vínculos.

O frontend local foi conferido servindo `noQuestions: true`; a saúde da API em 8001 respondeu `ok`. O relatório histórico abaixo descreve as versões anteriores, incluindo o modo de perguntas que agora permanece somente como compatibilidade opcional do SDK.

## Pergunta indevida sobre encaixe inferido — 2026-10-06

O construtor pediu autorização para mover munhões Ø10×14 de X=±105 para X=±102 ou alongar furos Ø10,2×14. A origem era a ausência de distinção entre dimensões inferidas pelo plano e requisitos explícitos do usuário. Também havia perda do checkpoint ao devolver uma pergunta, cache de perguntas como resultados concluídos e limpeza do progresso na interface. O fluxo agora orienta ajustes locais autônomos de dimensões inferidas, preserva requisitos explícitos e corpos concluídos, conserva a pergunta pendente após interrupções e pausa a interface com retomada somente do corpo pendente. Não foi adicionada reconsideração automática para assinaturas.

As suites TS passaram: **405 testes** (58 web, 276 agente, 69 domínio e 2 golden). Typecheck, lint web, build e Ruff da API passaram. Quatro testes de navegador passaram em 19 s, usando motores reais e IA programada: criação mecânica, rejeição de suporte suspenso, inspeção legada, pergunta com retomada do corpo pendente e retomada após resposta incompleta/falha de salvamento. O novo teste de pergunta faz cinco chamadas programadas no total: classificação, plano, base, pergunta do suporte e suporte concluído; a base é inspecionada uma única vez. Testes do SDK também interrompem a retomada com quota e confirmam conservação da pergunta/contexto sem replanejar nem reconstruir corpos concluídos.

Duas regressões CadQuery passaram em 7,55 s. Furos passantes que ocupam os intervalos [-109,-95] e [95,109] deixam os munhões em ±105 sobressaírem sem colisão; o engate é 11 mm e falha quando o vínculo exige 12 mm. Mover os munhões para ±102 obtém 14 mm de engate e passa na verificação dos pares. Os testes reproduzem os intervalos informados, não o conjunto completo do usuário, cujo JSON dessa tentativa não estava disponível. A diferença axial de 3 mm isolada não comprova material em comum. A aprovação do conjunto continua dependente do motor e dos demais vínculos.

Nenhum contrato HTTP ou código de produção da API mudou nesta correção; a suíte Python completa não foi repetida. API 8001 e frontend 5173 continuam respondendo. Os modelos reais não foram usados nesta verificação. O diff passou considerando CRLF do Windows.

## Vínculos mecânicos de montagem — 2026-10-06

A implementação e seus limites estão em [mechanical-assemblies.md](mechanical-assemblies.md). Conjuntos criados pela interface exigem, por padrão, ancoragem e conexões explícitas; projetos legados permanecem identificados como sem verificação mecânica. A API recusa salvar vínculos inválidos e conserva a revisão anterior.

| Verificação | Resultado |
|---|---|
| TypeScript completo, versão final | 402 passaram: 56 web, 275 agente, 69 domínio e 2 golden |
| API Python completa, antes dos últimos refinamentos de material/grupo rotativo | 317 passaram, 2 ignorados, em 745,85 s |
| Casos mecânicos após os refinamentos | 22 passaram; os dois novos casos de grupo rotativo passaram após corrigir o fator ausente no fixture, totalizando 24 casos aprovados em execuções direcionadas |
| Domínio Python, versão final | 87 passaram; Ruff e mypy passaram |
| Navegador completo, API e motores reais | 25 passaram, em 4,6 min |
| Navegador mecânico após os últimos refinamentos | 2 passaram, em 11 s |
| Typecheck, lint web e build Vite | Passaram |
| Ruff e mypy da API | Passaram; mypy verificou 41 arquivos |
| Diff, considerando CRLF do Windows | `git diff --check` passou com `cr-at-eol` |

As regressões verificam fixação parafusada com contato/furos reais, vão de 24 mm sem suporte, furos cegos ou apagados, perda de alinhamento/engate, ausência de guia contra giro, ausência de mancais, incompatibilidade do avanço roscado, porca circular sem antirrotação e batente que deixa de reter após girar. Roscas métricas/trapezoidais, ambos os sentidos, uma a quatro entradas e eixos X/Y/Z/inclinados têm evidências de crista/vale consultadas no sólido final. Um grupo rotativo com ressalto separado é aceito quando possui fixação e movimento rígidos; fatores diferentes são rejeitados. Classificadores e verificações de poses exatamente equivalentes são reutilizados sem mudar as respostas de material/diagnóstico.

O [atuador de referência](../examples/cad/functional_linear_stage.json) possui oito corpos e 12 conexões. O motor verificou guias, mancais, retenção axial e Tr12×3 em seis poses do curso de ±30 mm, e reimportou o STEP mantendo oito sólidos válidos. A geração final produziu STEP de 3.895.656 bytes e volume de 675.496,1790 mm³. O volante separado e os munhões Ø9 permitem a sequência proposta de instalação descrita no relatório; não foi implementado um solver geral de caminhos de montagem. Fixadores, adesivos, cargas e fabricação continuam com requisitos explícitos.

O navegador confirma criação mecânica por padrão, salvamento e download STEP, inspeção sem IA, invalidação do relatório após editar, recusa de suporte suspenso e preservação da revisão anterior. A API local foi reiniciada em 8001; saúde, contrato/rota mecânicos e motores CAD/X3D foram conferidos, e o frontend respondeu em 5173. O projeto antigo do usuário não foi substituído. As respostas de IA dos testes são programadas: nenhuma geração livre de mecanismo com modelo real foi executada nesta etapa. Permanecem os dois avisos de depreciação da API e o aviso de tamanho do SDK WebLLM.

## Auditoria geral e folga de movimento — 2026-10-06

A auditoria está descrita em [audit-2026-10-06.md](audit-2026-10-06.md). A verificação final passou em Windows/PowerShell:

| Verificação | Resultado |
|---|---|
| TypeScript completo | 387 testes: 56 web, 270 agente, 59 domínio e 2 golden |
| API Python completa | 300 passaram, 1 ignorado, em 586,42 s |
| Domínio Python | 78 passaram; Ruff e mypy passaram |
| Navegador com API e motores reais | 23 passaram, em 5,1 min |
| Typecheck, lint web e build Vite | Passaram |
| Ruff e mypy da API | Passaram; mypy verificou 40 arquivos |
| `git diff --check` | Passou |

Depois da rodada completa da API, as últimas simplificações de trabalho booleano e o teste adicional de encerramento de descendentes receberam duas rodadas direcionadas: 57 testes passaram/1 ignorado e, na revisão final, 34 passaram/2 ignorados. A última cobre montagem, encaixes roscados, folga de movimento e clientes locais. Os casos ignorados exigem POSIX e não executam no Windows; foram adicionados para a execução Linux do CI, que não foi executado remotamente nesta sessão. Os resultados direcionados não são somados ao total da suíte completa.

A suíte de navegador passou integralmente após adequar o limite de espera do teste complexo de reparo rosqueado: ele já havia passado isoladamente em 31,5 s e excedia o limite original de 30 s sob concorrência. Conserva todas as verificações de geometria, rosca, acabamento, salvamento e download. Permanecem dois avisos de depreciação da API e o aviso de bundle grande do WebLLM.

O par recuperado `base`/`fuso_volante` reproduziu 481,7884 mm³ no curso mínimo. A estratégia de folga no receptor fixo eliminou as interferências detectadas nas seis poses, preservando o programa inteiro do fuso e seus movimentos. O STEP reimportado contém dois sólidos válidos. Essa evidência cobre o subconjunto recuperado, não a montagem completa de oito componentes nem o estado mais recente da aba do usuário. Testes adicionais exercitam posições intermediárias e os eixos X/Y/Z.

Os testes usam motores reais e respostas de IA programadas. Não houve inferência real, commit ou publicação. O servidor existente do usuário não foi reiniciado. Colisão geral continua amostrada e a verificação não certifica fabricação. Os números nas seções históricas abaixo correspondem às revisões anteriores.

## Checks

Reverificação de 2026-10-06 para encaixes roscados: suites TypeScript completas (379 testes), typecheck, lint web, build Vite, Ruff e mypy da API passaram. Os testes direcionados da API (`test_cad_thread_fits.py`, `test_cad_assembly_fits.py`, `test_cad_interference_work.py`) passaram: 21 casos em 144,49 s. Playwright passou os 20 testes em 4,4 minutos, incluindo CAD externo, assinaturas, retomada, importação, exportações e X3D. O novo caso de reparo roscado usou motor/API reais, preservou os movimentos e a rosca externa, salvou a revisão e baixou STEP com zero chamadas de inferência. Os números históricos abaixo correspondem à baseline anterior.

| Suíte | Resultado |
|---|---|
| Frontend TypeScript | 52 testes passaram |
| Agentes TypeScript | 218 testes passaram |
| Domínio TypeScript | 57 testes passaram |
| Relatórios golden | 2 testes passaram |
| API Python, incluindo compatibilidade MCP | 254 testes passaram |
| Domínio Python | 78 testes passaram |
| Playwright, API e motores reais | 9 testes passaram |
| TypeScript, lint web, Ruff e mypy | Passaram |
| Build Vite | Passou |

São **670 casos de teste**, sem contar reexecuções, após a ampliação de operações CAD e as correções de montagem, política espacial X3D e retomada de quota descritas abaixo. Todas as suítes acima foram repetidas na ampliação CAD. A API emitiu dois avisos de depreciação de Starlette/httpx/anyio. O build ainda informa bundles grandes do SDK WebLLM; seu worker tem aproximadamente 6 MB e a biblioteca 5,9 MB. O chunk principal ficou em 434,36 kB, com áreas CAD/X3D carregadas sob demanda.

## Ampliação de recursos CAD

O motor e o agente aceitam quinze formas/operações. Os testes verificam as nove adições: roscas, tubos, toros, rasgos, furos com acabamento, loft, fillet, chamfer e shell. Os mesmos programas são aceitos por schemas JSON, Python e TypeScript; os arquivos gerados são comparados aos modelos Pydantic. Parâmetros impossíveis, acabamentos deslocados, lofts fora de ordem e movimentos ligados sem fatores coerentes são rejeitados.

Roscas métricas/trapezoidais dos dois sentidos e roscas de duas, três e quatro entradas foram construídas e reimportadas de STEP. Pontos de crista e raiz verificam presença de filetes, sentido e avanço axial, além de volume/validade. A construção longa em uma única extrusão falhou nessas verificações apesar de `isValid()`; a versão final usa segmentos de até uma volta. Flancos usam splines aproximadas com tolerância de construção de 0,00001 mm para reduzir a complexidade; isso não certifica tolerâncias ou classes de ajuste.

Quatro combinações de perfil/sentido/entradas verificam porca e fuso nas seis poses, com curso de ±2,3 mm e posição atual de 1,7 mm. Rotação do fuso e translação da porca usam fatores por grupo. A API verifica salvamento, STEP/STL, componente individual e outra revisão na extremidade do curso. Um teste de oito corpos rosqueados longos verifica que a prévia conserva todos os sólidos e cabe em 50.000 triângulos, sem modificar volumes ou limites.

No navegador, o suporte com sete operações mantém rosca interna, acabamentos, loft, rasgo e furos rebaixados, salva e baixa ambos os formatos, apresenta prévia válida e recupera o projeto. O mecanismo rosqueado verifica os dois controles ligados, -414°/2,3 mm no final do curso, salvamento, exportação da porca e recuperação dos valores. Os nove testes de navegador passaram em aproximadamente 2,7 minutos; a suíte Python completa da API passou em 4 minutos e 25 segundos. Roscas e interseções continuam mais caras que primitivas simples.

## Fluxos verificados

Etapas omitidas em correção de rascunho importado (2026-10-05): a reprodução programada de edição parcial conserva os passos anteriores e aplica somente substituições por ID/inserções. Casos inválidos cobrem IDs desconhecidos, conflitos, duplicações, limites, dimensões inválidas, exclusões sem autorização e substituição de rosca por cilindro; instruções negativas não autorizam exclusões. Uma correção topológica pode excluir explicitamente um corte obstrutivo, conservando os demais recursos. A edição HTTP continua exigindo o programa completo e conserva suas retentativas de formato.

No navegador com API e CadQuery reais, **Corrigir interferências** resolve um encaixe sem inferência; outra montagem recebe somente um corte de folga em resposta programada, sem planejamento e mantendo a rosca/acabamento. Dois pares independentes verificam pausa depois do primeiro progresso, exportação do rascunho e **Retomar correção** solicitando apenas a segunda peça, preservando ambas as correções na revisão final. Nenhuma chamada real aos modelos foi feita. O backend CAD, X3D e seus contratos HTTP não foram alterados nesta atualização.

Esta atualização passou nas suítes TypeScript completas (56 web, 256 agente, 57 domínio e 2 golden), typecheck, lint e build. Os 19 testes de navegador passaram em 3 minutos, incluindo API externa, X3D, roscas, retomada de quota e as novas correções de conjuntos importados. A API Python não foi reexecutada nesta atualização, pois seu código e contratos não mudaram; os motores reais foram exercitados pelos testes de navegador. O servidor local existente permaneceu ativo e respondeu em 5173/8001. A validação com modelos reais continua pendente.

Retomada de interferências e trabalho do kernel (2026-10-05): a espera reportada foi observada no processo local da API, calculando limites exatos de sólidos em `BRepBndLib.AddOptimal`; não havia processo de inferência ativo. Um rascunho de oito corpos foi recuperado em `.cache/recovery/atuador-linear-recuperado.json`. Uma inspeção local desse rascunho com a primeira otimização levou 118,6 s e reportou 28 colisões distribuídas nas seis poses; isso não comprova validade do conjunto nem constitui comparação controlada de velocidade com a versão anterior. Depois dessa medição, também foram retirados limites calculados antecipadamente para diagnósticos de operações booleanas válidas.

Testes de regressão verificam uma única interseção para um par fixo com seis diagnósticos de pose, ausência de limites exatos em pares separados, caixas conservadoras contendo sólidos curvos rotacionados e construção booleana válida sem calcular diagnósticos de erro. Encaixes com cones unidos nas pontas são verificados com CadQuery e STEP reimportado. A assinatura recebe dois pares independentes: uma correção resolve o primeiro, o conjunto parcial é conservado e a retomada pede somente o segundo componente; uma correção sem progresso conserva o rascunho anterior. O teste de navegador importa um conjunto sem inferência, recusa uma importação inválida sem substituir o conjunto e exige salvamento validado antes de baixar STEP. As chamadas aos modelos são programadas; nenhuma inferência real foi executada nesta revisão.

Verificação adicional com os dados recuperados: o subconjunto `suporte_esquerdo`, `suporte_direito` e `guia_inferior` reproduziu os volumes de interferência de 416,73 e 416,74 mm³. Duas propostas da estratégia compartilhada eliminaram essas colisões sem alterar a guia; o STEP do subconjunto foi reimportado e conservou três corpos válidos. Essa verificação cobre os encaixes informados, não as outras interferências do conjunto completo de oito componentes. O arquivo de recuperação mantém o rascunho original.

Checks desta atualização: suítes TypeScript completas aprovadas, 286 testes da API aprovados em 309,52 s e 16 testes de navegador aprovados em 3,7 min. Typecheck, lint web, build, Ruff e mypy passaram. Após simplificar o texto do contador de tempo, typecheck, lint e build foram repetidos e passaram. Permanecem os dois avisos de depreciação da API e o aviso de tamanho do bundle WebLLM. O domínio Python não foi alterado nem reexecutado nesta atualização.

Auditoria de respostas incompletas e consumo (2026-10-05): a execução atual não faz inferências reais. Clientes Codex/Claude são simulados com JSON direto, 32 operações e textos com aspas/acentos. Testes verificam interrupção sem retentativa de formato, envelopes HTTP inválidos, cancelamento anterior ao início da inferência, retomada de componentes concluídos e candidatos cuja inspeção ficou indisponível, limites de correção CAD/X3D e rejeição antecipada de posições/movimentos inválidos. Os mesmos erros de formato continuam recebendo o reparo anterior no provedor externo. Os testes históricos com clientes reais abaixo precedem a mudança para JSON direto; não validam a qualidade de geração do novo protocolo com modelos reais.

Nesta revisão passaram 358 testes TypeScript (55 web, 244 agente, 57 domínio, 2 golden), 280 testes da API e os 15 testes do navegador. Typecheck, lint web, build, Ruff e mypy passaram. A API mantém dois avisos de depreciação e o build mantém o aviso de tamanho do WebLLM. Após acrescentar a conservação do resultado concluído, a suíte TypeScript foi repetida e o teste de retomada do navegador foi reexecutado: dois suportes reais, JSON incompleto no segundo, retomada só desse componente, erro 503 programado ao salvar e repetição do salvamento sem nova inferência. Ao todo, cinco respostas programadas (classificação, plano, primeiro suporte, segundo incompleto e segundo completo), uma inspeção por suporte e downloads STEP/STL. Novos testes também recusam IDs ausentes ou numéricos ainda no planejamento. O domínio Python não foi alterado nem reexecutado nesta revisão.

Regressão de metadados CAD (2026-10-05): programas e peças legadas conservam 14–16 premissas longas sem alterar dimensões ou gastar retentativas de formato. O conjunto constrói `suporte-esquerdo` e `suporte-direito` com as mesmas geometrias e uma única chamada por componente. O teste de navegador usa respostas programadas pelo adaptador Codex/Terra, conserva 28 premissas, valida dois sólidos no motor real e baixa STEP/STL. Textos de tipo incorreto e uma dimensão negativa continuam rejeitados. Perguntas longas também são preservadas. Esta regressão verifica o contrato da aplicação, não a qualidade do modelo real.

Em 2026-10-05, os clientes oficiais locais autenticados (Codex 0.160.0 e Claude Code 2.1.283) devolveram `{"ok":true}` em chamadas reais pelo serviço e pelo diálogo do navegador. O Claude identificou assinatura Team. Cada diagnóstico pela interface levou aproximadamente 5,5 s; isso mede um pedido mínimo, não um benchmark de modelagem.

Uma chamada real ao Codex pelo agente CAD gerou e salvou uma placa de 60 × 40 × 8 mm com quatro furos passantes Ø5 nos centros X=±22/Y=±12. A API confirmou um sólido e volume de 18.571,6815 mm³, correspondente à placa menos os quatro furos, e disponibilizou STEP de 29.977 bytes e STL de 102.284 bytes. Não houve reparo de geometria nessa execução. Artefatos e capturas de teste ficam em `.cache/browser/codex-live-plate.*`, `codex-live-settings.png` e `claude-live-settings.png`. O snapshot CAD foi capturado durante a atualização da malha anterior; o spec/STEP persistidos e o volume são a evidência geométrica.

Testes independentes verificam comandos sem shell, remoção de variáveis de faturamento, fechamento por timeout/desconexão, drenagem de saída excessiva, rejeição de respostas incompletas/ferramentas e bloqueio de Host/Origin/clientes remotos. Testes de navegador com IA programada verificam configuração não salva, ambos os clientes, uso nos agentes e diagnóstico de quota anterior à geometria. Os modelos reais foram usados somente nas verificações descritas acima.

- CAD composto: classificação, planejamento, construção, salvamento automático, STEP/STL completos, componente STEP, movimento, nova revisão e recuperação após reload.
- CAD individual: criação e ambos os downloads; dimensão inválida mantém a malha anterior, bloqueia exportação do rascunho e não altera a revisão salva.
- X3D: criação local, validação XSD/semântica, canvas no iframe sandbox e downloads X3D/HTML, sem servidor MCP. Receitas com 9 e 65 objetos também passaram pela validação local real.
- Interface móvel: largura de 390 px, sem transbordamento horizontal, e abertura das configurações da IA.
- Desempenho CAD: regressões verificam uma construção de cada componente por inspeção do curso e reutilização do STEP entre inspeção e salvamento.
- Inicialização: `node scripts/dev.mjs`, executado pelo `npm run dev`, abriu frontend na 5173 e API na 8001. Saúde retornou CAD disponível e X3D local; o encerramento liberou as portas.

## Retomada de CAD após quota

Testes verificam duas interrupções sucessivas durante a correção de um componente: o programa parcial é conservado, a etapa de reparo pendente é retomada e a criação original não é repetida. O limite de reparos concluídos continua registrado. Uma quota durante a reconsideração de esclarecimento também interrompe imediatamente, sem ser confundida com falha de formato. O programa completo deixou de ser enviado duas vezes na mesma chamada de reparo.

O provedor foi testado com `Retry-After`, `RetryInfo` do Gemini, quota diária, faturamento e requisição excessiva. Prazos bloqueiam novas chamadas antecipadas e liberam novas tentativas após expirar; o corpo bruto e mensagens privadas não são expostos. Sem informação suficiente, o diagnóstico permanece desconhecido. Esses casos usam respostas HTTP programadas, sem chave real nem medição da quota da conta do usuário.

No navegador, um conjunto de oito corpos foi interrompido no sexto componente, retomado e interrompido novamente. A troca de modelo foi aplicada sem navegação/reload. Só os três corpos restantes foram solicitados ao novo modelo: oito inspeções individuais ao todo, nenhum componente concluído reconstruído. O motor real validou o conjunto e os downloads STEP/STL. Um teste adicional verificou a preservação da cena, sessão e conversa X3D ao trocar de provedor. Checkpoints ainda ficam em memória nesta aba e se perdem após reload.

## Artefato concreto

A ampliação produziu [mechanical_mount.step](../examples/cad/mechanical_mount.step) e [mechanical_mount.stl](../examples/cad/mechanical_mount.stl): um sólido de 100 × 70 × 29 mm, volume 98.425,5739 mm³ e STL com 113.970 triângulos. O [threaded_drive.step](../examples/cad/threaded_drive.step)/[STL](../examples/cad/threaded_drive.stl) tem três sólidos, volume 6.165,7899 mm³ e 64.576 triângulos. O script `generate_feature_samples.py` também conferiu suas prévias: 18.236 e 9.984 triângulos, respectivamente. Todos os arquivos foram gerados pela implementação final e reimportados antes de exportar STL.

[manual_press.step](../examples/cad/manual_press.step) e [manual_press.stl](../examples/cad/manual_press.stl) foram gerados do [spec de exemplo](../examples/cad/manual_press.json). A validação encontrou três sólidos, limites de 120 × 70 × 113,5 mm e volume de 356.982,9340 mm³. O STL tem 1.888 triângulos. O [script](../examples/cad/generate_assembly_sample.py) reproduz os arquivos com reimportação STEP e verificação amostrada de interferências.

## Reparo de montagem com colisões simultâneas

O usuário relatou uma tampa ocupando z=[57,65] em uma carcaça que termina em z=60. O erro tinha sobreposição de 13.910,97 mm³. O JSON original não estava disponível; o [fixture de regressão](../tests/fixtures/cad_motor_overlap.json) reconstrói esses limites e esse volume de sobreposição, acrescenta uma segunda tampa sobreposta e um rotor independente. A carcaça reconstruída tem volume diferente do original; não é uma cópia exata do projeto do usuário.

A API encontrou 12 registros: duas colisões em cada uma das seis poses. Após corrigir a primeira tampa, conservou seis colisões da segunda. O agente acumulou as duas correções de posição para z=64,5 e z=-64,5 sem alterar a geometria, IDs ou movimento. O navegador salvou quatro sólidos, baixou STEP/STL e salvou outra revisão com o rotor em 360°. A IA foi programada somente para classificação, plano e quatro componentes; nenhum reparo adicional do provedor foi necessário.

Seis casos do agente cobrem ambos os lados nos eixos X/Y/Z, incluindo deslocamentos nos sistemas local/global e nomes diferentes. A política central também foi testada contra novas colisões, piora de outra pose, diagnóstico incompleto, ciclos, orçamento esgotado, propostas sem verificação, falha de rede e conservação de checkpoints. O limite de interferência da API permaneceu em 0,1 mm³.

## Política espacial X3D

O usuário relatou 23 sobreposições em uma célula industrial. O bloqueio usava caixas delimitadoras, que são conservadoras para primitivas curvas/rotacionadas, e o navegador convertia uma frase de separação das caixas transportadas numa proibição global de conexões da cena. A correção centraliza as políticas visual/estrita e retira essa inferência textual e o deslocamento automático do fluxo padrão.

O [fixture de célula industrial](../tests/fixtures/x3d_industrial_cell.json) tem 59 objetos e 64 operações: esteira, seis caixas, robô, bandejas, painel, cerca e torre de sinalização. É uma reconstrução para regressão, sem acesso ao plano original da falha. Em modo visual, XSD/semântica passaram, todos os objetos/posições foram preservados e avisos de limites espaciais ficaram associados à revisão. A edição da cor de um braço também passou preservando as posições. Em modo estrito, a mesma composição foi rejeitada antes de alterar a revisão.

O navegador verificou a prévia, downloads X3D/JSON, alteração de material e conservação dos 59 objetos. Foi necessária uma resposta programada da IA para criar a cena e outra para editar, sem reparos adicionais. Testes de política também cobrem esferas separadas com caixas sobrepostas, impedimento de burlar a separação global com `allowOverlap`, avisos limitados com contagem total e envio de pares além do limite da mensagem humana ao reparo da IA. Os avisos visuais não afirmam que a cena esteja livre de penetrações indevidas; essa qualidade ainda deve ser conferida na composição.

Os testes do agente/navegador usam respostas de IA programadas. Eles verificam o fluxo, mas não demonstram qualidade, latência ou acerto de um modelo real em pedidos livres. Não foi repetida a validação independente FreeCAD dos exemplos históricos. A verificação mecânica permanece limitada ao contrato e às amostras descritos em [cad-readiness.md](cad-readiness.md).

## Encaixes roscados — 2026-10-06

O rascunho de oito componentes disponível localmente reproduziu os 831,0915 mm³ entre `fuso_volante` e `porca`. A rosca interna estava centrada em x=9 como se a posição fosse uma entrada, deixando metade da porca sem o corte. Centralizar esse corte ainda deixou 61,0929 mm³ porque o cilindro Ø10 do fuso ocupava os sulcos da rosca trapezoidal Ø12/passo 3, cuja raiz é Ø9. A proposta final alivia somente esse trecho antes de unir a rosca real, conserva os munhões, centraliza o corte interno e o estende além das faces. A inspeção completa levou 135,48 s: eliminou os seis registros desse par (posição atual e cinco amostras), reduzindo o diagnóstico de 28 para 22 registros, sem introduzir pares nem aumentar volumes de outras colisões. Esse rascunho antigo ainda contém interferências em outros pares; não representa as correções mais recentes conservadas na aba do usuário e não é um conjunto aprovado para exportação.

Quatro regressões com CadQuery e STEP reimportado verificam eixos X/Y/Z e um eixo inclinado, perfis métrico/trapezoidal, sentidos direito/esquerdo, uma/duas entradas, deslocamentos locais, fase fracionária e movimento ligado. Além de conferir zero interferência nas amostras e três sólidos válidos após reimportação, consultam pontos nos munhões, cristas e raízes, evitando aceitar uma simples substituição por geometria lisa. O agente verifica recusa de parâmetros incompatíveis, núcleo ambíguo ou excessivo, engate incompleto, sólido inválido e regressão de montagem, preservação de corpos não alterados, ausência de repetição e correção sem chamada ao provedor. O limite de interferência da API permanece em 0,1 mm³. Nenhuma inferência real foi feita para esses testes.
