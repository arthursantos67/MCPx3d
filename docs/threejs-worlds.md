# Mundos vastos — Three.js 0.7

Em andamento desde 23 de outubro de 2026. Objetivo e fases em [ROADMAP.md](../ROADMAP.md#07--mundos-vastos): mundos de 4×4 km sem reduzir o FPS nem a qualidade das cenas atuais. Este documento registra o que já existe, como foi medido e o que falta.

## Medição

`node scripts/benchmark-three-fps.mjs` gera o build de produção, abre o Chrome do sistema com GPU real (ANGLE/Direct3D 11) e recusa renderizadores por software. Cada cenário abre o exemplo pelo menu, entra no modo jogo e segue uma rota fixa: um giro completo e depois os pontos de interesse da cena (interações, personagens, objetivo), na mesma ordem em toda execução. Mundos usam rotas próprias (a pé com corrida ou voo acompanhando o relevo a 36 m/s). O jogador não recebe dano durante a medição.

A sonda só existe com `?bench=1` na URL (`apps/web/src/three/sceneBench.ts`). Ela registra, por quadro: intervalo entre quadros, tempo de CPU do quadro na thread principal, draw calls e triângulos somando todas as passadas, tempo de GPU por consultas `EXT_disjoint_timer_query_webgl2` quando disponíveis e, em mundos, tempo de seleção, de streaming e quadros com nível de detalhe ainda não carregado. Também estima a memória de GPU pelos bytes únicos de geometrias e texturas. Tarefas longas vêm do `PerformanceObserver`.

Duas passadas por cenário, três execuções cada, em ordem alternada:

- **gpu:** resolução nativa da qualidade média (1920×1080, razão de pixels 1).
- **cpu:** resolução interna 0,25 para isolar o custo da thread principal, já que a GPU de entrada domina a passada nativa.

O ruído de cada cenário é o maior entre 2 × o desvio absoluto mediano das execuções e 3% da mediana. `--compare` aplica o gate: cenas 1.x não podem piorar mediana ou p95 além do ruído, nem aumentar draw calls, triângulos ou bloqueios; cenários de mundo também precisam ficar dentro do orçamento absoluto (CPU ≤ 8 ms na passada cpu, ≤ 600 draw calls, ≤ 1,5 M triângulos, streaming ≤ 2 ms por quadro, nenhum quadro > 100 ms na passada cpu, nenhuma tarefa > 100 ms, nenhum quadro com detalhe faltando).

## Linha de base

Medida em 23/10/2026 antes do runtime de mundos ([JSON](benchmarks/0.7-baseline.json)). Hardware: NVIDIA GeForce GT 710 2 GB (driver 475.14, Direct3D 11 via ANGLE), Intel Core i7-8700, 16 GB, Windows 10, Chrome 155, monitor de 75 Hz com vsync. A GT 710 é de entrada; as classes integrada, média e dedicada estão **não medidas** (a GPU integrada desta máquina está desativada). Três execuções de 60 s por cenário e passada.

| Cena | Quadro gpu (mediana / p95, ms) | GPU por quadro (ms) | Quadro cpu (mediana / p95, ms) | CPU por quadro (mediana / p95, ms) | Draw calls | Triângulos | GPU estimada (MiB) | Até jogar | Troca de cena | Maior bloqueio na carga | Maior bloqueio em jogo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Vale dos Ventos | 160 / 173,4 | 147,4 | 40 / 53,4 | 5,5 / 8,7 | 276 | 0,55 M | 107 | 6,8 s | 10,3 s | 2283 ms | 0 ms |
| Mercado de Valemar | 133,3 / 146,8 | 122,3 | 26,7 / 40 | 8,9 / 14,9 | 578 | 0,46 M | 123 | 0,5 s | 12,7 s | 965 ms | 272 ms |
| Floresta encantada | 133,4 / 173,6 | 120,3 | 26,6 / 40 | 4,3 / 6,6 | 123 | 0,58 M | 67 | 4,0 s | 5,2 s | 880 ms | 0 ms |
| Ermo dos Saqueadores | 106,6 / 133,3 | 95,4 | 13,4 / 26,7 | 5,0 / 7,7 | 219 | 0,07 M | 69 | 6,9 s | 6,3 s | 6734 ms | 2054 ms |
| Ilha do Farol | 146,7 / 226,7 | 123,7 | 26,7 / 40,3 | 3,4 / 5,9 | 86 | 0,36 M | 90 | 3,9 s | 3,7 s | 1331 ms | 0 ms |

Na resolução nativa todas as cenas são limitadas pela GPU (95 a 147 ms de GPU por quadro). Problemas já existentes, registrados para não serem confundidos com regressões: o Ermo bloqueia a thread principal por ~2 s durante o jogo e até 6,7 s na carga; trocas de cena e a entrada no modo jogo bloqueiam 0,5 a 2,3 s (texturas procedurais e pele do avatar, áudio, captura de reflexos), e o Mercado já passa de 600 draw calls em alguns trechos. A primeira execução da linha de base foi descartada porque o Chrome limitou janelas encobertas a 1 quadro por segundo; o script agora detecta isso e repete a execução.

## Contrato ThreeWorldDocument 2.0

`apps/web/src/three/world/worldDocument.ts`. Um mundo tem semente, terreno (`none`, `synthetic` ou `climate`, tamanho até 16 km, faixa de altitude, nível do mar, relevo e erosão), regiões com identidade (centro de Voronoi ponderado, bioma, perigo, ambiência, música, clima, premissa), locais (tipo, região, posição, rotação, área reservada, descrição e uma cena `ThreeSceneDocument` 1.x opcional), rotas entre locais, orçamentos (densidade de vegetação, nós por local, luzes com sombra por região) e o ambiente global. Os limites são verificados antes de aceitar o documento, e referências quebradas, IDs duplicados ou pontos fora do mundo são recusados.

Uma cena 1.x migra para um mundo sem terreno com um único local na origem; `worldAsScene` devolve a cena idêntica. `parseProject` continua abrindo projetos 1.x como cenas: nada é migrado sem pedido, e exemplos, rascunhos e arquivos salvos seguem pelo runtime de sempre.

## Terreno em blocos

Arquivos em `apps/web/src/three/world/`.

- **Relevo:** `worldTerrain.ts` define uma única função de altura por mundo (`synthetic-v1`: fBm com amortecimento por derivadas, cordilheiras, platôs com falésias e litoral). `worldNoise.ts` usa somente hash inteiro e aritmética float64, então thread principal, workers e testes produzem os mesmos bits. O menor comprimento de onda é 5 m, para que vértices a 1 m nunca gerem aliasing.
- **Quadtree CDLOD** (`cdlod.ts`): nós de 64×64 células; o nível 0 tem 1 m entre vértices e cada nível dobra. Todas as malhas dividem as células pela mesma diagonal, então cada nível está contido no seguinte. Por isso a diferença entre dois níveis é máxima em um vértice da malha mais fina, e o erro de cada nível em relação ao nível 0 é medido exatamente em todos os pontos de 1 m do mundo (`measureBlockErrors`, em workers, ao abrir o mundo). As faixas de distância vêm desse erro: um nível só aparece onde seu erro projetado é ≤ 1 pixel, e o morph para o nível seguinte só começa onde o erro do nível seguinte também é ≤ 1 pixel. As faixas pelo menos dobram por nível, o que mantém vizinhos a no máximo um nível de diferença e as bordas sem trincas.
- **Desenho** (`terrainRenderer.ts`): o terreno inteiro é uma malha instanciada de quartos de nó (33×33 vértices) em um draw call. As alturas ficam em uma `DataArrayTexture` R32F de capacidade fixa, uma camada por bloco residente; trocar um bloco só reescreve a sua camada. O vertex shader lê as alturas com `texelFetch`, faz o morph e calcula a normal por diferenças centrais. Um segundo conjunto de instâncias, só com os blocos próximos do jogador, projeta a sombra do sol. O material é único e compilado antes de jogar; o streaming nunca cria material nem muda luzes.
- **Streaming** (`terrainStream.ts`, `workerPool.ts`, `world.worker.ts`): até 4 workers geram blocos (alturas 67×67 com borda, mínimos e máximos) e devolvem `Float32Array` transferível. A thread principal copia blocos prontos para a textura até gastar 2 ms por quadro, os mais grossos primeiro. Blocos dentro de 1,25× da faixa são pedidos antes de serem necessários. Quando falta memória, saem os blocos não usados no quadro, finos antes de grossos; a raiz nunca sai.
- **Colisão** (`terrainCollider.ts`): os blocos de nível 0 em 72 m do jogador respondem a raios e cápsulas com o mesmo float32 e a mesma diagonal da malha desenhada, agrupados em blocos de 8×8 células com limites de altura. `combineShapes` soma o terreno à BVH estática da cena, com a mesma interface usada pelo jogador, inimigos, projéteis e linha de visão. A física do jogador espera enquanto a colisão sob ele não estiver residente.
- **Origem flutuante:** o three.js calcula `modelView` em float64 na CPU, então só geometrias com coordenadas locais grandes perdem precisão no float32 da GPU. O terreno usa coordenadas relativas a uma origem de render que acompanha o jogador em passos de 256 m (recentrada após 512 m); a lógica de jogo continua em float64. Todas as frequências das texturas do chão vezes 256 m são inteiras, então recentrar não desloca nenhuma textura.

## Limites atuais

Fase 2 em validação: o gate completo (três execuções, cenas 1.x comparadas à linha de base) ainda não rodou. Medição preliminar na GT 710 do relevo sintético: CPU mediana de 2 ms por quadro, streaming ≤ 0,1 ms, 5 a 6 draw calls, 0,9 M triângulos em 1080p e nenhum quadro com detalhe faltando a pé ou em voo a 36 m/s.
