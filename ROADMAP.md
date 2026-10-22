# Forma — roteiro até a versão 1.0

Atualizado em 2026-10-21. Complementa o [PRD](PRD.md), o [estado atual](ISSUES.md) e a [arquitetura](docs/architecture.md). Datas são ordem de prioridade, não compromissos de calendário.

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

### 0.6 — Qualidade visual de mercado

Three.js
- Personagens com malha contínua: gerar `SkinnedMesh` procedural a partir do rig atual (pele única com pesos), em vez de peças rígidas; clipes exportáveis em GLB.
- Importar GLB **com** esqueleto e animações (Mixamo/Quaternius/Kenney do próprio usuário), com mapeamento automático para o rig do Forma (idle/andar/correr/atacar/morrer).
- Biblioteca de materiais (madeira envelhecida, pedra musgosa, metal pintado, tecido) com variação por instância e decalques (sujeira, musgo, pichação).
- Vegetação com vento em shader, grama instanciada em massa (100 mil lâminas com LOD), água com reflexo planar/refração e espuma de borda.
- Iluminação: sondas de luz/irradiância assadas por cena, nuvens volumétricas leves, sombras em cascata.
- Critério de saída: comparação visual cega com capturas de referência e medição de FPS em 3 classes de GPU (integrada, média, dedicada).

CAD
- Esboços 2D com restrições (coincidência, paralelismo, distância, ângulo) como nova etapa do `CadProgramSpec`.
- Seleção de faces/arestas por IDs persistentes para fillet/chamfer.
- Interface de lista de projetos salvos (hoje só o último de cada representação).

X3D
- Persistir projetos e conversa X3D em SQLite.
- Empacotar X3DOM localmente para a prévia funcionar sem internet.

### 0.7 — Profundidade de jogo

Three.js
- Física de corpos rígidos opcional (Rapier WASM): caixas empurráveis, pilhas, gangorras, ragdoll de inimigos derrotados; colisão exata de objetos móveis.
- Navmesh gerada da cena (Recast) para inimigos e NPCs: perseguição contornando obstáculos, patrulhas por rota, fuga.
- Sistema de eventos encadeados declarativo (gatilho → condição → ações em sequência, com atrasos), cobrindo puzzles de múltiplos passos.
- Missões de NPC (aceitar, progresso, recompensa), lojas simples com moedas, diálogo ramificado com escolhas.
- Veículos dirigíveis (carro, barco, nave) e montaria.
- Chefes com fases (mudança de padrão de ataque por vida restante) e telegráfos visuais.
- Critério de saída: 20 fases de referência, uma por gênero, jogáveis do início ao fim por teste automatizado com bot.

CAD
- Classes de ajuste ISO e raízes de rosca arredondadas; engrenamento verificado entre engrenagens.
- Sequência de montagem/desmontagem verificada.

### 0.8 — Escala e conteúdo

Three.js
- Mundos maiores por streaming de células e LOD automático (impostores para vegetação distante).
- Geração incremental: planejamento por regiões, construção por etapas e edição local sem reenviar o mundo inteiro.
- Persistência de projetos e assets em IndexedDB e no servidor; biblioteca pessoal de assets reutilizáveis.
- Seleção múltipla, agrupamento, alinhamento/distribuição e pincéis de dispersão no editor.
- Critério de saída: cena de 20 mil objetos navegável a 60 FPS em GPU média.

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

**Personagens:** humanoides (aldeões, guardas, magos, astronautas, robôs), inimigos humanoides (goblins, esqueletos, orcs), fauna e quadrúpedes (lobos, cervos), criaturas (aranhas, golens, dragões, drones), com rig, animação procedural e, a partir da 0.6, malha contínua com pele.

## Riscos e decisões

- **Qualidade depende do modelo.** O motor compensa coordenadas imprecisas (pré-fabricados, layout automático, médico de cena), mas criatividade e fidelidade variam por provedor; por isso a 1.0 exige benchmark real.
- **Tamanho do prompt.** O catálogo cresce; manter o contrato compacto (pré-fabricados parametrizados, padrões `auto`) é preferível a descrever cada peça.
- **Desempenho em GPU integrada.** Clima, sombras e personagens têm orçamento; a 0.6 precisa medir antes de ampliar limites.
- **Áudio sem arquivos.** Síntese local evita licenças e downloads, mas tem timbre limitado; amostras do usuário ficam opcionais.
