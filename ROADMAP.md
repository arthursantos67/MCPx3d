# Forma — roteiro até a versão 1.0

Atualizado em 2026-10-23, com as prioridades do usuário para a 0.6 (personagens, HUD, animação) e a 0.7 (mundos vastos, com orçamento de desempenho e regra de não regressão). Complementa o [PRD](PRD.md), o [estado atual](ISSUES.md) e a [arquitetura](docs/architecture.md). Datas são ordem de prioridade, não compromissos de calendário.

## Visão da 1.0

Forma é um estúdio local em que uma pessoa descreve o que quer e recebe um artefato **utilizável de verdade**:

- **Mundos jogáveis (Three.js):** fases completas, com identidade visual, personagens animados, som, mecânicas de jogo reais e exportação para jogar fora do estúdio. A IA atua como diretora de arte e level designer; o motor garante colisão, alcance, objetivos e desempenho.
- **Peças e conjuntos mecânicos (CAD):** geometria B-rep verificada, STEP/STL confiáveis e um perfil mecânico explícito, com medição pública de confiabilidade por provedor.
- **Cenas X3D:** cenas padronizadas e validadas (XSD + semântica), persistentes e visualizáveis offline.

Princípios que não mudam: a IA devolve somente dados estruturados; tudo que aparece no produto passa por validação determinística; nenhuma garantia é anunciada sem medição.

## Onde estamos

| Versão | Conteúdo |
|---|---|
| 0.1–0.3 | CAD com conjuntos, roscas, vínculos mecânicos e rascunhos; X3D local com XSD; estúdio Three.js jogável. |
| 0.4 | Biomas, pré-fabricados temáticos, arquitetura habitável, estradas sobre o relevo, planejamento espacial e médico de cena. |
| **0.5 (esta entrega)** | **Mundo vivo:** contrato 1.3, áudio procedural, personagens com rig e animação procedural, inimigos com estilos de ataque e resistência, armas e projéteis, inventário/chaves/portões, cura e poderes, NPCs com diálogo, plataformas móveis e de salto, objetivo de sobrevivência com ondas, clima com partículas, gradação de cor, água animada, 25 novos objetos de mundo e direção criativa ampliada para a IA. Detalhes em [docs/threejs-living-worlds.md](docs/threejs-living-worlds.md). |

## Marcos

### 0.6 — Personagens, HUD e um mundo que se move

Prioridade definida pelo usuário em 2026-10-22: personagens muito mais bem trabalhados, HUD com padrão de mercado e animação de personagem e de mundo.

**Personagens de qualidade comercial**

Estado técnico em 22/10/2026: pele procedural nativa, avatar, falanges, face, roupas, LOD/cache e exportação GLB com esqueleto/clipes estão implementados ([detalhes](docs/threejs-characters-hud.md)). Importação/redirecionamento de esqueletos externos e os critérios artísticos/FPS de saída abaixo continuam pendentes; a 0.6 ainda não recebe aprovação comercial por testes unitários.
- Malha contínua com pele (`SkinnedMesh`) gerada por procedimento: corpo modelado por seções transversais ao longo dos ossos (tronco, membros, mãos com dedos, pés), suavizado e com pesos de pele; sem peças rígidas visíveis.
- Rosto com olhos (esclera, íris, pálpebras que piscam), sobrancelhas, nariz, boca com articulação de fala e expressões básicas; cabelo em cartões/mechas e barba; mãos com dedos articulados.
- Roupas e armaduras em camadas sobre a pele (túnica, capa, couraça, botas, luvas, elmos), com variação por semente e paleta; materiais de pele com brilho subsuperficial, tecido com `sheen`, metal desgastado.
- Arquétipos parametrizados (idade, porte, altura, proporções heroicas ou realistas, estilo estilizado/realista) para que a IA crie personagens distintos sem repetir o mesmo modelo.
- Importar GLB **com** esqueleto e clipes (Mixamo, Quaternius, Kenney do próprio usuário) com redirecionamento automático para o rig do Forma.
- Orçamento e LOD por distância (3 níveis), para dezenas de personagens na tela.

**Animação de personagens**
- Máquina de estados com mistura (blend tree): parado ↔ andar ↔ correr pela velocidade, pulo (impulso, ar, aterrissagem), agachar, ataque leve/pesado em combo, esquiva, golpe recebido, morte, interação, conversa.
- IK de pés no terreno e em degraus, olhar da cabeça para o jogador/alvo, mãos em alavancas e portas.
- Movimento secundário por molas: capas, cabelo, caudas, alças e armas penduradas balançam com inércia.
- Ciclos de ociosidade variados (olhar ao redor, alongar, coçar) para NPCs e jogador.

**Mundo em movimento**
- Vento global em shader: árvores, arbustos e grama balançam conforme altura e rigidez, com rajadas que percorrem a paisagem; grama instanciada em massa que se curva à passagem do jogador.
- Água com ondas, reflexo, refração, espuma de margem e correnteza em rios; cachoeiras com névoa e respingos.
- Sistema de partículas em GPU: fogo e fumaça, faíscas, poeira de passos, respingos, folhas caindo, magia e impactos de golpes.
- Vida ambiente: pássaros em bando, borboletas, peixes, insetos; bandeiras e tecidos com simulação simples de pano.
- Ciclo dia/noite opcional com transição de céu, luzes práticas acendendo à noite e música/ambiência acompanhando.

**NPCs que vivem no mundo**
- Navmesh gerada da cena (Recast/Detour em WASM): rotas contornando obstáculos para NPCs e inimigos, evitação entre multidões.
- Rotinas por horário e local: trabalhar na barraca, sentar no banco, conversar em grupo, patrulhar a muralha, voltar para casa à noite.
- Reações: virar para o jogador, cumprimentar, fugir de perigo, alertar guardas.

**HUD com padrão de mercado**
- Sistema visual próprio (tipografia, ícones vetoriais, cores, animações de entrada/saída) aplicado a todo o modo jogo.
- Vida com rastro de dano, estamina e barra de habilidade; barra de chefe; números de dano; marcador de acerto na mira.
- Bússola ou minimapa com marcadores de objetivo, NPCs e pontos de interesse; rastreador de missões.
- Barra de atalhos com ícones de itens e armas; inventário em grade; cartão de item obtido.
- Rótulos e barras de vida sobre a cabeça de inimigos e NPCs; prompts de interação no mundo.
- Diálogo com retrato, nome e opções de resposta; cartão de título ao entrar na fase (nome, premissa); telas de pausa (volume, sensibilidade, qualidade gráfica), vitória e derrota com estatísticas.
- Glifos de teclado e gamepad; legendas para falas.

**Critérios de saída:** comparação visual cega com capturas de referência de jogos indie comerciais; personagens sem peças rígidas visíveis a 2 m; FPS medido em 3 classes de GPU (integrada, média, dedicada) com orçamento declarado; HUD revisado em 1280×720 e 1920×1080.

CAD
- Esboços 2D com restrições (coincidência, paralelismo, distância, ângulo) como nova etapa do `CadProgramSpec`.
- Seleção de faces/arestas por IDs persistentes para fillet/chamfer.
- Interface de lista de projetos salvos (hoje só o último de cada representação).

X3D
- Persistir projetos e conversa X3D em SQLite.
- Empacotar X3DOM localmente para a prévia funcionar sem internet.

### 0.7 — Mundos vastos

Hoje as cenas são ilhas e arenas de algumas centenas de metros. A 0.7 cria mundos reais para explorar **sem reduzir o FPS nem a qualidade visual das cenas atuais**. O desempenho é requisito de entrada de cada fase, não um ajuste final.

**Regra de não regressão**
- Antes de qualquer código da 0.7, um benchmark reproduzível (`scripts/benchmark-three-fps.mjs`): Chrome com GPU real, rota fixa em modo jogo, tempo de quadro (mediana, p95, máximo), quadros > 50 ms, draw calls, triângulos, memória de GPU estimada, tempo até o primeiro quadro jogável e tempo de troca de cena. Linha de base gravada para os exemplos atuais (Vale dos Ventos, Mercado de Valemar, Floresta encantada, Ermo, Ilha do Farol) e anexada a cada fase.
- Nenhuma fase é concluída se uma cena 1.x existente piorar mais que o ruído medido (mediana ou p95), se surgir quadro > 100 ms durante o jogo, ou se a página bloquear por mais de 100 ms em carga ou streaming.
- Medição em três classes de GPU (integrada, média, dedicada), declarando o hardware. Sem a máquina de uma classe, o resultado fica "não medido", nunca estimado.

**Orçamento por quadro (16,6 ms em GPU média, 1080p, qualidade média)**
- CPU da thread principal ≤ 8 ms: simulação e IA de NPCs ≤ 3 ms, preparação de render ≤ 3 ms, streaming (upload e anexação de blocos) ≤ 2 ms com fila fatiada por quadro.
- GPU: ≤ 1,5 M triângulos somando todas as passadas, ≤ 600 draw calls, sombra do sol limitada ao entorno do jogador, quantidade fixa de luzes pontuais com sombra.
- Fauna, partículas, grama e personagens com tetos por nível de qualidade, já existentes; personagens distantes com animação em frequência reduzida e sem IK/molas, a partir de distâncias em que a diferença não é visível.

**Arquitetura de desempenho**
- Geração de relevo, biomas, splat, rios, posicionamento de conteúdo e BVH de colisão em Web Workers, com dados transferíveis; a thread principal só anexa resultados prontos.
- Blocos (chunks) com LOD contínuo (CDLOD/quadtree, morph entre níveis) escolhido por erro em tela de até 1 pixel, de modo que a troca de nível não seja perceptível. Anéis de streaming: colisão e lógica perto, malha completa no meio, impostores e silhuetas de montanhas no horizonte.
- Origem flutuante: recentrar o mundo perto do jogador para manter precisão em 4 km, sem tremor de vértices ou de sombras.
- Instâncias e materiais compartilhados entre blocos; instâncias agrupadas por bloco para descarte por frustum e pela sombra. Assentamentos distantes como HLOD (malha combinada simplificada) ou impostores.
- Shaders: o conjunto de programas do mundo é compilado com `compileAsync` antes de jogar, no mesmo alvo do compositor. O streaming nunca cria variante nova de material nem altera a contagem de luzes ou sombras durante o jogo, o que recompilaria todos os materiais.
- Memória: orçamento de GPU por qualidade, descarte dos blocos distantes com histerese e cache em IndexedDB de blocos gerados por semente, para recarga rápida.
- Escalonamento dinâmico de resolução e de distância de visão fica opcional e desligado por padrão; nunca substitui a otimização sem perda.

**Terreno em escala de quilômetros**
- Mundo de 4×4 km (alvo inicial) em blocos com streaming, sem borda visível.
- Geração por mapas de clima (temperatura, umidade, altitude) com biomas contínuos; montanhas, vales, planaltos, falésias e litoral; erosão hidráulica simplificada, feita em worker; rios que descem pelo relevo até lagos e mar.
- Materiais por camadas (splat), com mistura por inclinação, altura e umidade, em um único material por bloco; horizonte com impostores e dispersão atmosférica.

**Conteúdo distribuído pelo mundo**
- Vegetação instanciada por densidade de bioma, com impostores à distância e grama apenas perto da câmera.
- Assentamentos (vilas, castelos, portos, acampamentos), masmorras, ruínas e marcos posicionados por regras de terreno e ligados por estradas que seguem o relevo. Locais detalhados são cenas 1.x carregadas por proximidade, compiladas e anexadas fora do caminho crítico.
- Regiões com identidade (nome, bioma, perigo, música) e transição de ambiência e música ao cruzá-las.

**Geração com IA em duas escalas**
- A IA produz um **atlas** do mundo (regiões, biomas, cidades, masmorras, rotas e história) e, sob demanda, detalha cada região ou local com o pipeline atual de cenas, sem gerar o mundo inteiro numa resposta.
- Edição local: "coloque uma vila de pescadores na costa leste" altera só aquela região.
- O agente recebe orçamentos explícitos no contrato: densidade por bioma, nós por local, luzes com sombra por região. O saneamento aplica esses orçamentos de forma determinística, para que nenhum mundo gerado ultrapasse o limite de desempenho.

**Exploração**
- Mapa do mundo com névoa de guerra, pontos descobertos e viagem rápida (destino pré-carregado antes da transição); montaria ou veículo para cruzar distâncias. O streaming é dimensionado para a velocidade máxima de deslocamento.
- Ciclo dia/noite e clima dinâmico por região, sem recaptura bloqueante de reflexos.
- Persistência de mundos e progresso em IndexedDB (servidor opcional); contrato de mundo (`ThreeWorldDocument` 2.0) com regiões e cenas por bloco, mantendo compatibilidade com cenas 1.x como locais.

**Fases, cada uma com gate de desempenho**
1. Benchmark e linha de base; contrato 2.0 com migração de 1.x (sem mudança no runtime).
2. Terreno em blocos com LOD, streaming em workers e origem flutuante, testado com relevo sintético antes de biomas.
3. Biomas, rios e splat.
4. Vegetação, impostores, HLOD e conteúdo por regras.
5. Atlas da IA, detalhamento sob demanda e edição local, com orçamentos no contrato.
6. Mapa, névoa de guerra, viagem rápida, montaria e persistência.

Cada fase só avança com o benchmark dentro do orçamento e sem regressão nas cenas 1.x.

**Critérios de saída:** atravessar o mundo de ponta a ponta na velocidade máxima da montaria sem carregamentos visíveis nem quadros > 50 ms, a 60 FPS (p95 ≤ 20 ms) em GPU média e ≥ 30 FPS em GPU integrada, medidos e publicados por classe de hardware; cenas 1.x existentes sem regressão de FPS; geração de atlas + 3 regiões detalhadas dentro do prazo configurado com provedor real, medida.

CAD
- Classes de ajuste ISO e raízes de rosca arredondadas; engrenamento verificado entre engrenagens.
- Sequência de montagem/desmontagem verificada.

### 0.8 — Profundidade de jogo e conteúdo

Three.js
- Física de corpos rígidos opcional (Rapier WASM): caixas empurráveis, pilhas, gangorras, ragdoll de inimigos derrotados; colisão exata de objetos móveis.
- Sistema de eventos encadeados declarativo (gatilho → condição → ações em sequência, com atrasos), cobrindo puzzles de múltiplos passos.
- Missões de NPC (aceitar, progresso, recompensa), lojas simples com moedas, diálogo ramificado com escolhas.
- Veículos dirigíveis (carro, barco, nave); chefes com fases e telegráfos visuais.
- Biblioteca pessoal de assets, seleção múltipla, agrupamento, alinhamento e pincéis de dispersão no editor.
- Critério de saída: 20 fases de referência, uma por gênero, jogáveis do início ao fim por teste automatizado com bot.

CAD/X3D
- Autenticação e propriedade de projetos antes de expor a API como serviço.
- Importar STEP/CAD no Three.js e X3D (conversão de malha com materiais).

### 0.9 — Publicação

- Exportar jogo HTML autocontido (um arquivo, sem servidor), com áudio procedural, HUD e controles; opção PWA.
- Controles por toque e gamepad; acessibilidade (legendas para diálogos, remapeamento, daltonismo).
- Multiplayer cooperativo local/rede (opcional), começando por sessões de exploração.
- Telemetria local opt-in de jogatina (mortes, tempo por zona) para ajustar dificuldade gerada.

### 1.0 — Confiabilidade medida

- Benchmark público e reproduzível por provedor (Codex, Claude, endpoints OpenAI, WebLLM) para os três motores: taxa de cena válida, fidelidade ao pedido, sobreposições, jogabilidade completa pelo bot, latência e custo. Meta proposta: ≥ 95% de cenas jogáveis do início ao fim nos 100 pedidos reservados, sem afirmar valores antes de medir.
- CAD: avaliação com pedidos reservados de engenharia; meta de confiabilidade declarada somente após medição.
- Documentação de usuário, tutoriais em vídeo e galeria de exemplos.
- Congelamento do contrato `ThreeSceneDocument` 2.0 com migração automática de 1.x.

## Catálogos-alvo da 1.0 (Three.js)

**Cenários:** paisagens naturais (floresta, selva, praia, deserto, neve, pântano, vulcão, fundo do mar, caverna), assentamentos (vila medieval, mercado, castelo, porto pirata, faroeste, vila de inverno), urbanos (cidade diurna, cyberpunk neon, ruínas pós-apocalípticas), fantasia (floresta encantada, terra dos doces, ilhas flutuantes), ficção científica (estação, base lunar, laboratório, nave por dentro, sistema solar), históricos (templo, coliseu, jardim japonês, pré-histórico) e estruturados (masmorra, arena, percurso de plataformas, corrida).

**Jogabilidades:** exploração, coleta, plataforma, quebra-cabeça com chaves e mecanismos, combate corpo a corpo e à distância, sobrevivência por ondas, chefe, corrida contra o tempo, furtividade, missões de NPC, veículos e construção leve.

**Som:** ambiências por bioma/tema, música generativa por humor com intensidade dinâmica, efeitos de jogo e fontes posicionais — tudo sintetizado localmente; na 0.7, bancos de amostras opcionais do próprio usuário.

**Personagens:** humanoides (aldeões, guardas, magos, astronautas, robôs), inimigos humanoides (goblins, esqueletos, orcs), fauna e quadrúpedes (lobos, cervos), criaturas (aranhas, golens, dragões, drones). A partir da 0.6: malha contínua com pele, rosto expressivo, roupas em camadas, máquina de estados de animação, IK e movimento secundário.

**Mundos:** a partir da 0.7, terrenos de quilômetros com streaming, biomas contínuos, rios, assentamentos conectados e atlas gerado pela IA.

## Riscos e decisões

- **Qualidade depende do modelo.** O motor compensa coordenadas imprecisas (pré-fabricados, layout automático, médico de cena), mas criatividade e fidelidade variam por provedor; por isso a 1.0 exige benchmark real.
- **Tamanho do prompt.** O catálogo cresce; manter o contrato compacto (pré-fabricados parametrizados, padrões `auto`) é preferível a descrever cada peça.
- **Desempenho em GPU integrada.** Clima, sombras e personagens têm orçamento; a 0.6 precisa medir antes de ampliar limites.
- **Áudio sem arquivos.** Síntese local evita licenças e downloads, mas tem timbre limitado; amostras do usuário ficam opcionais.
