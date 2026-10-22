# Forma — roteiro até a versão 1.0

Atualizado em 2026-10-22, com as prioridades do usuário para a 0.6 (personagens, HUD, animação) e a 0.7 (mundos vastos). Complementa o [PRD](PRD.md), o [estado atual](ISSUES.md) e a [arquitetura](docs/architecture.md). Datas são ordem de prioridade, não compromissos de calendário.

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

Hoje as cenas são ilhas e arenas de algumas centenas de metros. A 0.7 cria mundos reais para explorar.

**Terreno em escala de quilômetros**
- Mundo de 4×4 km (alvo inicial) em blocos com streaming e LOD contínuo (CDLOD/quadtree com transição suave), sem limite visível de borda.
- Geração por mapas de clima (temperatura, umidade, altitude) que definem biomas contínuos; montanhas, vales, planaltos, falésias e litoral; erosão hidráulica simplificada; rios que descem pelo relevo até lagos e mar.
- Materiais por camadas (splat) com mistura por inclinação, altura e umidade; horizonte distante com montanhas em impostores e dispersão atmosférica.

**Conteúdo distribuído pelo mundo**
- Vegetação instanciada por densidade de bioma, com impostores à distância e grama apenas perto da câmera.
- Assentamentos (vilas, castelos, portos, acampamentos), masmorras, ruínas e marcos posicionados por regras de terreno e conectados por estradas que seguem o relevo.
- Regiões com identidade (nome, bioma, perigo, música) e transição de ambiência/música ao cruzá-las.

**Geração com IA em duas escalas**
- A IA produz um **atlas** do mundo (regiões, biomas, cidades, masmorras, rotas e história) e, sob demanda, detalha cada região/local com o pipeline atual de cenas — sem precisar gerar o mundo inteiro numa resposta.
- Edição local: "coloque uma vila de pescadores na costa leste" altera só aquela região.

**Exploração**
- Mapa do mundo com névoa de guerra, pontos descobertos e viagem rápida; montaria ou veículo para cruzar distâncias; ciclo dia/noite e clima dinâmico por região.
- Persistência de mundos e progresso em IndexedDB (e servidor opcional); contrato de mundo (`ThreeWorldDocument` 2.0) com regiões e cenas por bloco, mantendo compatibilidade com cenas 1.x como locais.

**Critérios de saída:** atravessar o mundo de ponta a ponta sem carregamentos visíveis, a 60 FPS em GPU média; geração de atlas + 3 regiões detalhadas dentro do prazo configurado com provedor real, medida.

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
