# Jogabilidade de Aurora — 2026-10-28

Aurora passa a ter uma aventura com início, progressão e vitória. Abra **Projeto → Terras de Aurora 4 km → Jogar**. O jogador começa no Posto do Lírio, próximo de Mara, dos recursos e da primeira missão. As estradas ligam o posto, as ruínas e o farol.

## Como jogar

- **WASD**, mouse/setas e **Shift**: andar, olhar e correr; **Espaço** pula.
- **E** ou clique: conversar, coletar, golpear recursos ou atacar. Mire perto do objeto; recursos resistentes exigem vários golpes.
- **B** ou o botão Inventário: mochila, quantidades, receitas e uso de alimentos/bandagens. Fabricar consome os ingredientes. O inventário pausa a simulação; Esc fecha.
- **Q**: esquivar; **V**: alternar câmera; **Tab**: mapa; **I**: montaria quando disponível.
- Na água funda o personagem nada e flutua. **C** mergulha e **Espaço** sobe; o fôlego cai debaixo d’água, recupera na superfície e causa dano ao esgotar. Água rasa permite caminhar.

Mara apresenta quatro missões: obter madeira/pedra, fabricar um sinal com fibra, recuperar o núcleo nas ruínas derrotando dois lobos e acender o farol. O painel mostra etapas e contagens; a bússola aponta para personagens e alvos. Bandagens e caldo restauram vida. Árvores, rochas e arbustos deixam de aparecer e colidir depois da extração.

## Contrato declarativo e agente

Extensões opcionais preservam documentos 1.4/2.0 existentes:

- `SceneNode.resource = {item, amount, health}` torna um nó/subárvore extraível. O runtime separa resistência, inventário e remoção visual/física do documento original.
- `environment.gameplay = {naturalResources, startingItems, recipes, quests}` define as regras. `naturalResources` habilita recursos nas espécies compatíveis: Madeira, Pedra, Fibra e Cogumelo.
- Receitas: `{id, name, inputs:[{item,amount}], output:{item,amount}, healing}`. A operação verifica todos os ingredientes antes de consumir qualquer quantidade. Nomes de itens ignoram diferenças de caixa/acentos para comparação.
- Missões: `{id, title, giverId, steps, rewards}`. Etapas usam `{kind, target, count, label}`; tipos `gather`, `craft`, `talk`, `interact`, `visit` e `defeat`. São sequenciais, com aceitação por diálogo quando há `giverId`; recompensas são concedidas uma vez. Contagens de coleta/fabricação são cumulativas, mesmo após gastar itens.
- `objective.type = "quests"` termina quando as missões estão completas; um `goal` existente continua sendo a chegada final. Limites de tempo continuam valendo.

O construtor e o planejador recebem essas capacidades e a instrução de criar ações verificáveis, fontes de recursos e conclusão. A validação confere referências, diálogos, tipos de alvo, ingredientes distintos e dependências de fabricação. Isso não prova acessibilidade espacial de qualquer jogo gerado nem substitui testar com um provedor real.

Na composição de mundos, IDs de missões/receitas e referências locais recebem o prefixo do local; contagens genéricas de inimigos ficam restritas àquele local. Missões globais explícitas têm prioridade. Locais sem missão recebem tarefas compatíveis com seu conteúdo. O ajuste ao orçamento preserva subárvores funcionais; quando o conteúdo necessário não cabe, a geração solicita outra tentativa.

## Água, terreno e persistência

A entrada no jogo aguarda a construção da cena, o terreno, os blocos de colisão e a compilação inicial. O botão Jogar e o atalho P ficam indisponíveis durante a preparação. Na reabertura, o mundo é recuperado do IndexedDB e a cena é reconstruída com o terreno, preservando o rascunho local correspondente; uma recuperação com falha é mostrada e impede jogar somente os objetos sem terreno. Abrir outro projeto cancela a recuperação pendente. Isso corrige a entrada precoce que criava o jogador perto de y=0 antes de instalar o terreno de Aurora, a cerca de y=384, deixando objetos flutuando e movimento sem apoio.

O avatar armado evita gestos ociosos de coçar a cabeça e alongar os braços, que levavam a arma através do próprio corpo. O olhar ao redor, a caminhada e os golpes continuam ativos. Reiniciar uma partida pula a apresentação inicial e mostra o jogo assim que a preparação termina.

`worldMacro` preserva o relevo de grandes depressões que não se tornam lagos; antes, elas eram preenchidas até a cota de drenagem, produzindo planaltos artificiais. Os rios usam a cota local do terreno. A expansão da superfície nas margens usa a menor cota vizinha. A consulta física interpola os mesmos triângulos da malha de água, evitando uma superfície global de rio sobre regiões secas.

As áreas dos assentamentos têm suporte plano analítico, compartilhado com os workers e a colisão, além da regularização da grade. A geração mantém estradas com perfil caminhável. A campanha de exemplo tem verificação de apoio, água e inclinação ao longo das estradas geradas.

O progresso do mundo inclui inventário, missões, objetos removidos, inimigos derrotados, mecanismos acionados, vida e checkpoint, além de posição/mapa. A retomada reconcilia a altura com o terreno atual. Saves antigos de exploração não deslocam a nova campanha antes de ela começar. “Jogar de novo” inicia uma partida limpa.

O mundo sintético escolhe o nascimento depois dos lagos, em terreno seco com inclinação caminhável. Antes da primeira sondagem de apoio, o viewport instala os blocos de colisão já carregados; isso evita nascer sobre um adereço distante quando a câmera ainda está no editor. Os atributos dos impostores usam quatro componentes para posição/rotação e um atributo separado para escala, eliminando os erros de buffers WebGL encontrados na suíte.

## Verificação em 28/10/2026

- Typecheck, lint, build de produção e os **896 testes** passaram, incluindo a regressão da ociosidade armada.
- Antes da correção de entrada, **45 casos de navegador** foram verificados: a execução inicial passou 43 e encontrou dois problemas nos mundos; os dois casos foram corrigidos e repetidos com sucesso. Essa cobertura não incluía tentar jogar durante a recuperação do mundo salvo.
- Na correção de entrada, os cinco casos de mundo/jogabilidade passaram: preparo bloqueando Jogar/P, recuperação com falha e abertura de outro projeto, terreno/caminhada, Aurora recuperada com edição local preservada, coleta/fabricação/reinício e natação/mergulho. Há verificações sequenciais dentro de cada caso.
- A verificação final repetiu coleta/fabricação/reinício e natação, confirmou o fluxo de criação/entrada do Vale dos Ventos e reabriu Aurora entrando por P. Os seis casos distintos foram verificados ao longo dessas execuções; a última repetição de Aurora passou em 28/10/2026.
- Nova inspeção funcional em produção na **GT 710, ANGLE/D3D11, 1500×850**: reabertura de Aurora, entrada por P depois do preparo, deslocamentos reais com W/A/S/D e câmera em terceira pessoa. O nascimento ficou em y=383,83, sobre o terreno; a arma permaneceu ao lado do corpo após a correção dos gestos ociosos. Isso não substitui o gate de desempenho.
- Testes de lógica completam as quatro missões de Aurora, fabricam/consomem materiais, derrotam inimigos, ativam o farol e retomam o save sem duplicar recompensas ou recursos. Também verificam a escolha do nascimento, água/mergulho, suporte dos assentamentos, caminhos, identidade dos workers e ausência dos recursos nos substitutos distantes.
- Inspeção de produção **headless, GT 710, ANGLE/D3D11, 1600×900**: aceitar missão, caminhar, extrair árvore e abrir o inventário com madeira/receitas; nenhum erro WebGL. [Amostra registrada](benchmarks/0.7-gameplay-smoke-2026-10-28.json).
- Nessa amostra curta de 137 quadros: máximo de **1.422.205 triângulos**, **373 draw calls**, nenhum déficit de LOD, mediana de **66,7 ms/quadro** (cerca de 15 FPS). Houve tarefa de **473 ms antes de `sceneReady`**. É uma inspeção funcional com capturas, não o gate de três execuções de 60 s nem uma comparação de desempenho com as cenas 1.x. O requisito de ausência de tarefas acima de 100 ms continua pendente; CPU isolada, outras GPUs e provedor real não foram medidos.

## Limites

A extração remove objetos marcados e vegetação natural; não escava a malha do terreno, não desmonta construções por blocos e não implementa construção livre. Não há economia, equipamentos fabricáveis com atributos próprios, árvore de habilidades nem multiplayer. Pontes e o limite de 2000 nós dos locais continuam pendentes da 0.7. Qualidade da geração com modelo real e desempenho em outras GPUs continuam não medidos; estas mudanças não certificam o gate de desempenho completo.
