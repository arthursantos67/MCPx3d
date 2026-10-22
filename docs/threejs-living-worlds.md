# Mundos vivos — Three.js 0.5

Atualizado em 22 de outubro de 2026. [Roteiro até a 1.0](../ROADMAP.md), [estúdio](threejs-studio.md), [PRD](../PRD.md).

A versão 0.5 transforma cenas jogáveis em fases com identidade: personagens animados, inimigos com estilos de combate, armas, inventário, NPCs que conversam, som sintetizado, clima e gradação de cor. Tudo continua declarativo: a IA devolve somente dados validados; nenhum áudio, textura ou modelo é baixado.

## Contrato `ThreeSceneDocument` 1.3

Importa 1.0–1.3 e exporta 1.3. Todos os campos novos são opcionais; projetos antigos recebem padrões neutros (`audio` automático, sem clima, gradação neutra, mãos como arma, avatar explorador).

| Onde | Campo | Significado |
|---|---|---|
| `environment.audio` | `ambience`, `music` (`auto`/`none`/preset), `volume` 0–1 | Ambiência e música geradas localmente. `auto` escolhe pelo bioma, céu, clima, tema e objetivo. |
| `environment.weather` | `none`, `rain`, `snow`, `embers`, `fireflies`, `dust`, `bubbles`, `leaves`, `ash` | Partículas em GPU que acompanham a câmera. |
| `environment.grade` | `none`, `warm`, `cool`, `cinematic`, `vivid`, `noir`, `dreamy`, `retro` | Gradação de cor, vinheta e granulação após o mapeamento tonal. |
| `environment.player` | `weapon` (`none`, `sword`, `blaster`, `bow`, `staff`), `avatar` (`explorer`, `knight`, `wizard`, `astronaut`, `robot`) | Arma do jogador e personagem da terceira pessoa. |
| `environment.objective.type` | `survive` | Vence quem sobrevive até `timeLimit` (padrão 60 s). |
| `node.sound` | `preset`, `volume`, `radius` | Fonte sonora posicional em loop (fogo, água, ondas, vento, máquina, magia, pássaros, insetos, gotejamento, motor, sinos, alarme, portal, multidão). |
| `node.behavior` | tipos `npc` e `launcher`; `health` (golpes), `attack` (`touch`, `melee`, `ranged`, `charge`), `flying`, `delay` (s) | NPCs passeiam e conversam; lançadores arremessam o jogador `range` metros para cima; inimigos têm resistência, estilo de ataque, voo e aparição tardia (ondas). |
| `node.interaction` | ações `heal`, `powerup`, `dialogue`; `item`, `requires`, `amount`, `power` | Coletáveis entram no inventário com `item`; qualquer interação pode exigir um item; curas restauram `amount`; poderes (`speed`, `jump`, `shield`, `strength`) duram `amount` segundos; diálogos separam falas com `|` (até 600 caracteres). |

Nomes de itens são comparados sem diferenciar maiúsculas e acentos. Itens exigidos não são consumidos.

## Personagens e criaturas

`sceneCharacters.ts` compila 13 personagens procedurais com proporções, roupas, armaduras e acessórios: NPCs `villager`, `knight`, `wizard`, `astronaut` e `deer`; inimigos `goblin`, `skeleton`, `orc`, `wolf`, `spider`, `drone`, `golem` e o chefe `dragon`. Cada um tem juntas (`j_*`) para um rig bípede, quadrúpede, aracnídeo, voador ou flutuante, e um comportamento padrão (velocidade, alcance, dano, resistência e estilo de ataque) que a receita pode ajustar. Os avatares do jogador usam os mesmos modelos.

`sceneCharacterRig.ts` anima as juntas por procedimento, sem keyframes no documento: ciclo de caminhada/corrida proporcional à velocidade, respiração ociosa, golpe com antecipação, recuo ao levar dano, queda ao morrer, pose aérea, bater de asas e gestos de fala. No editor os personagens respiram com a timeline; no jogo seguem a velocidade real, o ataque e o estado do inimigo. Inimigos derrotados terminam a animação de queda antes de desaparecer.

Limite: as peças continuam rígidas (sem pele contínua); a malha com `SkinnedMesh` está no roteiro da 0.6.

## Combate e jogabilidade

- **Armas** (`sceneCombat.ts`): mãos e espada atacam em arco corpo a corpo; blaster, arco (com gravidade) e cajado disparam projéteis com varredura contra o BVH e caixas, sem atravessar paredes. E/clique interage com o que está na mira; sem alvo de interação, ataca.
- **Inimigos** (`sceneEnemies.ts`): corpo a corpo com antecipação e possibilidade de esquiva, investida com carga e arrancada, tiro à distância mantendo distância e lateralizando (torretas com velocidade 0), voo acima do terreno e NPCs que passeiam, param e encaram o jogador. Resistência por golpes com barra no alvo da mira.
- **Progresso** (`sceneRuntime.ts`): inventário, interações bloqueadas com aviso “Precisa de: …”, curas, poderes temporários (velocidade, super pulo, escudo, força), diálogos em sequência, ondas por `delay`, pontuação e fila de eventos consumida pelo HUD e pelo áudio.
- **Plataformas** (`sceneMovingPlatforms.ts`): superfícies animadas e colidíveis carregam o jogador (translação e giro); `launcher` arremessa à altura configurada.
- **HUD**: arma, pontuação, inventário, poderes ativos, caixa de diálogo, cadeado em interações bloqueadas, pontuação na vitória e M para silenciar.

## Mundo e jogabilidade: 25 objetos novos

`scenePrefabsWorld.ts`: muralha e torre de castelo, portão (com `text` = chave exigida), chafariz, estátua, barraca de feira, carroça, feno, baú (abre; pode exigir chave), alavanca, estandarte, lápide, arco em ruínas, píer, farol (feixe giratório), contêiner, console, reator, antena radar, torreta (inimigo fixo), plataforma móvel, plataforma de salto, coração (cura), chave (item) e orbe de poder. Todos passam pela verificação de variantes (sementes, tamanhos e iluminação) sem interseções ou faces coplanares.

## Som, clima e imagem

- **Áudio** (`sceneAudio.ts`): Web Audio com ruídos e reverberação gerados localmente; 16 ambiências em camadas, música generativa em 9 humores com intensidade que sobe durante perseguições, 23 efeitos (passos, pulo, coleta, dano, golpes, tiros, portas, vitória…) e fontes posicionais HRTF. Inicia ao entrar no jogo, silencia com M e suspende ao sair.
- **Clima** (`sceneWeather.ts`): uma chamada de desenho por tipo, posições envolvidas em caixa ao redor da câmera calculadas na GPU, respeito à neblina e brilho próprio para brasas e vaga-lumes. Limite: o clima não sabe o que é interior; chove também sob telhados.
- **Gradação** (`sceneGrading.ts`): exposição, temperatura, lift/gain, curva de contraste, saturação, vinheta e granulação após o `OutputPass`.
- **Água** (`sceneWater.ts`): materiais com textura de água ondulam com mapas deslocados em direções diferentes.

## Geração com IA

O prompt do construtor descreve o catálogo novo e acrescenta uma camada de **direção criativa**: antes de construir, o modelo decide título, premissa, marco, 3–5 pontos de interesse com micro-história e 6–12 objetos cada, paleta, luz, gradação, clima, paisagem sonora e o ciclo início → desafio → recompensa → final. `sceneDirection.ts` reconhece 19 temas novos (castelo, feira, enseada pirata, cemitério, cripta, cyberpunk, base sci-fi, pós-apocalíptico, jardim japonês, faroeste, steampunk, terra dos doces, pré-histórico, vila de inverno, coliseu, corrida, sobrevivência, furtividade e chefe), intenções de gênero (tiro, sobrevivência, chefe, furtividade, corrida, RPG/NPCs, chaves, lançadores), inimigos adequados ao tema e revisões objetivas — por exemplo, uma porta que exige item que nenhum coletável fornece, vila habitada sem NPCs, pedido de tiro sem arma, sobrevivência sem ondas. Correções determinísticas só ocorrem quando o pedido é explícito (chuva, neve, música, arma).

Essas verificações não medem a qualidade artística de um modelo real; a medição por provedor permanece no roteiro.

## Exemplos novos

Em **Projeto**: **Cripta do Rei Esqueleto** (chave, portão trancado, esqueletos, golem e portal, espada e câmera em terceira pessoa), **Mercado de Valemar** (NPCs com diálogo, chave perdida e baú), **Ilhas Celestes** (plataforma móvel, plataforma de salto, orbe de super pulo, moedas e portal) e **Ermo dos Saqueadores** (sobrevivência de 90 s com ondas de goblins, orcs, aranha, lobo e drone, blaster e curas). Todos passam pela inspeção espacial e pela auditoria sem problemas.

## Verificação

Testes unitários: `sceneCharacters`, `scenePrefabsWorld`, `sceneAudio`, `sceneAtmosphere`, `sceneCombat`, `sceneMovingPlatforms`, `sceneRuntimeV13`, `sceneCreativity`, além das ampliações de `sceneEnemies`, `sceneDirection`, `sceneThemes` e `sceneExperiences`. O áudio foi exercitado com um `AudioContext` simulado; shaders e som não foram avaliados em GPU/alto-falante físicos nesta entrega.
