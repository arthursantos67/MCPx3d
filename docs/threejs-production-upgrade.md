# Revisão do gerador Three.js — 15 de outubro de 2026

Esta revisão trata o gerador anterior como protótipo. O foco é tornar a criação por conversa o caminho principal, melhorar a construção procedural e identificar defeitos antes da apresentação. Não estabelece qualidade artística universal nem equivalência com um jogo comercial.

## Experiência

A cena ocupa a área central. O compositor fica abaixo dela, com sugestões iniciais e uma única ação principal. A escolha de criar, editar ou corrigir é inferida do pedido; **Opções de criação** permite escolher explicitamente a ação e o prazo. Depois de gerar, o pedido é limpo e novas alterações usam a cena existente. Pedidos de outra cena ou de criação do zero iniciam um mundo novo.

**Editor avançado** abre hierarquia, propriedades, gizmos, timeline e estatísticas. **Projeto** reúne exemplos, importação/exportação, captura e verificação. **Atividade** mostra o histórico e as observações sem ocupar permanentemente o espaço da cena. Falhas abrem o diagnóstico; o modo avançado também mantém os relatórios acessíveis após a geração. Arquivos existentes e rascunhos são preservados.

**Jogar** ocupa toda a janela e retira os controles de autoria. A ajuda completa é opcional pela tecla H; os controles essenciais permanecem numa faixa pequena. Esc ou **Sair do jogo** retorna ao projeto. Tela cheia também funciona na apresentação e oferece entrada no jogo sem exibir uma timeline obrigatória.

## Terreno e superfícies

- `geometry.terrainStyle`: `rolling`, `ridged`, `terraced`, `dunes`. O estilo padrão preserva o ruído dos projetos anteriores; as alternativas acrescentam cristas, terraços suaves e dunas direcionais.
- `geometry.biome`: `none`, `meadow`, `alpine`, `desert`, `volcanic`, `forest`, `snow`, `tropical`, `swamp`, `lunar`, `alien`. As cores dos vértices variam por altitude, inclinação física e manchas determinísticas. Normais consideram dimensões e escala. A paleta combina baixadas, vegetação, solo seco, rocha e cumes. O mapa de cor único não tinge todas as regiões com a mesma textura; normal e rugosidade continuam ativos. JSON e GLB preservam esse visual.
- A deformação dos poliedros usa ruído contínuo, evitando espículas aleatórias a cada vértice. Normais coincidentes são suavizadas sem perder UVs. O sombreamento facetado continua disponível nos materiais que o pedem.
- Rochas têm fissuras menos abruptas; árvores possuem ramificações e copas secundárias com tesselação maior e sombreamento suave. Casas recebem caixilhos, travessas, peitoris, beirais, batentes, degraus, coroamento de chaminé e maçaneta. A porta mantém folga durante a animação.

As áreas aplainadas usam a influência mais forte; em núcleos sobrepostos, a área posterior prevalece, para que uma estrada criada antes de uma casa não deforme seu piso. Estradas são reprojetadas após o posicionamento das construções e após correções do relevo. Junções entre estradas sobre o mesmo suporte são contatos intencionais. IDs de estradas evitam colisões com IDs dos templates.

`node.role` opcional distingue `structure`, `vegetation`, `prop` e `path`. Os pré-fabricados recebem essa classificação automaticamente; árvores deixam de ser confundidas com construções que exigem terreno plano. Caminhos permanecem fixos durante reparos. Projetos antigos sem esse campo mantêm a análise por geometria.

## Geração e edição

`sceneDirection.ts` prepara instruções de composição para pedidos de mundos e fases. Orienta marcos visuais, escala humana, rotas, áreas de descanso, paleta e materiais; prefere fases compactas a mapas grandes vazios e não exige combate em exploração tranquila.

Após a construção e o reparo espacial, uma revisão determinística verifica cenas muito vazias/repetitivas, paisagens sem relevo, cenas noturnas sem luzes práticas e objetivos sem as mecânicas necessárias. Esses sinais são heurísticas, não uma nota artística. Se houver problemas, a segunda chamada tenta refiná-los. A construção usa no máximo duas chamadas; mundos complexos recebem antes uma chamada de planejamento espacial, totalizando no máximo três. Uma versão com mais sobreposições não substitui uma candidata melhor. Se o refinamento falhar, o resultado já construído permanece disponível com observações.

A edição envia materiais, comportamentos e geometria relevante mesmo sem objeto selecionado. Cenas grandes têm contexto limitado, priorizando seleção, ancestrais, grupos e problemas diagnosticados. O modelo recebe aviso dos nós omitidos.

O patch aceita `removals: [IDs]` para pedidos de remoção: excluir um grupo remove seus descendentes e limpa contatos e alvos de interação. Reparos conservam os objetos, mesmo se o modelo tentar excluí-los. Edições também podem alterar comportamentos, exposição, iluminação, sombras e reflexões. Uma alteração parcial em `environment.player` preserva início, direção, câmera, vida e demais configurações.

Se a remoção eliminar a última animação de um grupo, seus controles de alternância são desligados, mantendo o projeto válido mesmo quando o grupo permanece na cena.

O solucionador de sobreposições deixa de escolher deslocamentos verticais que seriam desfeitos pelo assentamento no terreno. O raio de ocupação dos grupos considera as transformações dos cantos das peças, reduzindo áreas de exclusão exageradas em objetos longos e finos.

## Cena de referência

**Vale dos Ventos** abre quando não há rascunho. São 982 objetos, terreno com bioma, quatro plantas arquitetônicas, moinho, bosque, caminhos e acessos, iluminação, pontos de controle, sete cristais e destino. A câmera de apresentação enquadra a arquitetura com ângulo mais baixo.

O layout validado fica em `sceneShowcaseLayout.ts`: a abertura não executa uma inspeção física síncrona. Para recalcular após alterar a referência:

```bash
node scripts/bake-three-showcase.mjs
```

O comando recusa atualizar o arquivo se restarem problemas na auditoria. O teste de regressão também inspeciona a cena final e verifica objetivo, coletáveis, referências e independência entre aberturas.

## Verificação e limites

Os testes cobrem determinismo de terreno/bioma, inclinação física, migração JSON, compartilhamento de materiais, estradas no relevo final, exclusão de grupos e referências, edição parcial do jogador, inferência de ação, refinamento limitado e preservação de resultados após falha. Os testes de navegador exercitam a experiência simples, o editor, geração por conversa com provedor simulado, modo jogo, tela cheia, importações, exportações, cancelamento e falhas.

```bash
node --test --test-concurrency=2 apps/web/tests/three/*.test.ts
npx playwright test --config playwright.three.config.ts
```

A configuração dedicada inicia somente o frontend, sem precisar instalar ou iniciar o motor CAD/API. A configuração geral de Playwright continua disponível para integração do produto inteiro.

Não foi medido ganho de qualidade com um provedor real nem desempenho em GPU física nesta revisão. O navegador de teste usa Chromium/SwiftShader; não permite prometer FPS para hardware do usuário. Permanecem os limites do [estúdio](threejs-studio.md): colisão móvel aproximada, ausência de física de corpos rígidos e assets procedurais. O build ainda sinaliza bundles grandes de Three.js/WebLLM.

## Arquitetura habitável e edição semântica

`sceneArchitecture.ts` compila a especificação de uma casa em malhas indexadas, agrupadas por material. O Three.js recebe geometria pronta; o agente escolhe uma planta em vez de posicionar cada batente, parede ou degrau.

`prefab.building` aceita `style` (`cottage`, `townhouse`, `lodge`, `villa`), `floors` (1 ou 2), `width` (7,5–16 m), `depth` (8,5–16 m) e `furnished`. Os estilos diferenciam volumetria, cobertura, proporções e acabamentos. Sobrados e lodges possuem varanda acessível. Todas as plantas usam vãos recortados nas paredes, vidros transparentes, caixilhos e peitoris visíveis dos dois lados. Luzes vêm de luminárias internas. Escadas possuem degraus, abertura na laje, patamares e guarda-corpos; mesas, cadeiras, cozinha, sofá e cama respeitam a circulação principal.

O grupo conserva `node.asset`, validado e exportado no JSON. Edições podem usar `rebuilds: [{ id, prefab }]` para recompilar uma casa com outro pavimento, estilo ou planta, preservando posição, rotação, escala e parentesco. IDs estáveis mantêm interações e referências; alvos removidos são limpos. A revisão avalia arquitetura repetitiva, escala humana, interiores pedidos e falta de pavimento superior também no fluxo de edição. Edições continuam limitadas a duas chamadas; a criação complexa pode usar uma chamada anterior de planejamento. Essas verificações são requisitos observáveis, sem avaliação artística por um modelo visual.

As malhas mantêm UVs em metros para evitar esticar a textura ao longo de uma parede inteira. Coordenadas arquitetônicas são quantizadas em 0,01 mm. Com a vegetação ramificada, o JSON completo da referência ocupa aproximadamente 5,27 MB; o rascunho deduplicado ocupa 2,25 MB em UTF-8 (4,51 MB em UTF-16). Batching conserva os vãos e a colisão por triângulos. Paredes, pisos e móveis colidem; vidros transparentes deixam de produzir sombras opacas.

O renderer implementa a opção de oclusão ambiente com SSAO espacial, sem acumulação temporal, excluindo vidros e mantendo a projeção sincronizada com a câmera. No jogo, a sombra solar concentra resolução em 48 m ao redor do jogador e sua projeção acompanha uma grade de texels. O controlador transpõe degraus de até 26 cm quando há apoio e espaço livre para a cápsula. Inícios dentro de casas procuram o piso próximo aos pés, evitando o antigo salto para o telhado.

Em **Projeto → Casa com dois pavimentos**, uma referência pequena permite conferir entrada, interior, escada e varanda. O Vale apresenta quatro plantas em escala humana. Rascunhos existentes continuam preservados; abrir um exemplo substitui a cena pelo fluxo habitual, com desfazer.

Os testes arquitetônicos verificam raios pelos vãos nos dois sentidos, paredes sólidas ao lado das janelas, colisões nas poses de porta, subida/descida integral da cápsula, inícios nos dois pisos, reconstrução por parâmetros e refinamento semântico do agente. O reparo consulta os triângulos das malhas arquitetônicas para encontrar o piso, inclusive em lotes que contêm pavimentos e teto. Recompensas parentadas à construção são analisadas individualmente; seu reparo preserva a casa. Itens alcançáveis no andar superior permanecem na posição solicitada.

Os testes de navegador acrescentam inspeções externas/internas e reconstrução por conversa com provedor simulado, incluindo uma recompensa no quarto superior. Corrigiu-se também o compositor em telas médias, onde uma regra responsiva antiga consumia altura excessiva. A configuração de testes Three.js permite 90 s para capturas WebGL em software; mantém as mesmas verificações de geometria, comportamento e preservação do documento.


## Estabilidade de superfícies e cadeia de geração

O piso de madeira e a face superior da fundação de pedra ocupavam exatamente y=0,22 m. O renderer alternava qual superfície desenhar, produzindo o padrão de interferência da captura do usuário. O compilador agora separa o corpo da fundação, o revestimento e a borda de pedra. Peitoris, apoios da varanda, degraus e encontros do teto também receberam espessuras e folgas coerentes.

`sceneAssetMigrations.ts` corrige documentos antigos ao abrir: remove somente a face de pedra concorrente e reconstrói sua borda. Preserva materiais, transformações, objetos personalizados e as outras faces. A migração é idempotente; lotes movidos ou modificados fora das coordenadas canônicas não são reescritos automaticamente.

`sceneSurfaceQuality.ts` acrescenta uma auditoria específica de faces coplanares expostas. Projeta triângulos no plano comum e mede sua interseção real; arestas adjacentes não contam. Consultas BVH com orientação de faces descartam encaixes enterrados. A auditoria inclui encontros dentro da mesma montagem, que antes eram ignorados. O orçamento é de 200 mil triângulos e até quatro segundos dentro do prazo restante da inspeção; a cobertura incompleta é reportada separadamente. Malhas transparentes/recortadas, superfícies animadas e cruzamentos dentro de uma única malha não recebem essa verificação estática.

Pedidos complexos usam `scenePlanning.ts`: um agente de planejamento entrega zonas, conexões, capacidade de ocupação, famílias de casas e objetivo ao agente construtor. O plano é validado antes da construção; a revisão determinística compara quantidades, plantas, posição das casas, terreno e objetivo com o documento construído. Não é um terceiro modelo visual: a revisão usa requisitos e geometria. Há no máximo uma conclusão para o plano e duas para construção/refinamento. Pedidos simples e edições mantêm o fluxo curto. Cancelamento e quota interrompem a cadeia; um plano inválido permite construir com o pedido original e aviso explícito.

`node.assetPart` identifica as peças compiladas. `sceneAssets.ts` substitui a estrutura sem apagar conteúdo autoral nem pré-fabricados aninhados. Se uma peça removida ainda é o sistema de coordenadas de um objeto personalizado, seu grupo e transformação são conservados. Interações com peças substitutas são remapeadas; controles sem alvo são limpos.

## Vegetação, sombras e rascunhos

`sceneVegetation.ts` gera troncos afunilados, galhos secundários e agrupamentos de folhas recortadas/agulhas, determinísticos por semente. As folhas usam mapas RGBA locais e alpha test, com variação de cor e orientação. A geometria é agrupada em cinco ou seis lotes por árvore. O passe de oclusão exclui os cartões recortados porque sua substituição por material normal não respeitaria o alpha, evitando sombras retangulares artificiais.

`sceneShadows.ts` distribui quatro mapas de sombra entre as luzes práticas solicitadas mais próximas do foco. Mapas estáticos são reutilizados; movimento ou mudança de visibilidade de um objeto na área da luz invalida o cache. Luzes que saem do orçamento liberam seus mapas. Recompensas luminosas não projetam sombras. Os testes verificam invalidação e seleção, sem afirmar ganho de FPS em GPU física.

`sceneDraft.ts` armazena geometrias repetidas numa biblioteca local ao documento. A leitura expande referências antes da validação, com limite de tamanho expandido e cópias independentes dos arrays. O JSON exportado continua completo, sem referências de rascunho. O Vale foi rebalanceado para a nova vegetação: 982 objetos e nenhum problema na auditoria do layout. Cenas maiores ainda podem exceder a quota disponível; a interface mantém o diagnóstico de falha de salvamento.

## Estradas contínuas, terreno detalhado e plano verificável

A captura seguinte mostrou outro defeito: a faixa da estrada possuía apenas dois vértices por estação. Seus vértices podiam estar sobre o terreno enquanto o interior dos triângulos cortava uma elevação. Havia também uma dependência ausente: um terreno referenciado apenas em `roads.onto` podia ser expandido depois da estrada, deixando uma faixa plana sem suporte.

`sceneRoads.ts` agora recorta a área de cada caminho contra a triangulação real do terreno. Cada fragmento usa o mesmo plano do triângulo de apoio, com folga de 6 cm. Trechos curvos recebem junções; a subtração de cobertura dá um único dono a cada pedaço dos cruzamentos, evitando camadas coincidentes. `node.path` conserva suporte, pontos XZ e largura. `sceneGrounding.ts` recompila a rede após alterações de relevo, plataformas ou posição do caminho. Faixas antigas com o padrão inequívoco do compilador recebem essa fonte automaticamente; malhas arbitrárias permanecem autorais. Rascunhos/importações passam pela reconstrução dos caminhos compatíveis ao abrir.

O assentamento de estradas também deixou de amostrar, a cada passo, o terreno que ele próprio acabara de deformar. Os apoios usam uma cópia estável do campo anterior. `sceneGroundQuality.ts` acrescenta consultas no interior e nas arestas dos triângulos para apontar caminhos enterrados/flutuantes, apoio ausente e superfícies de chão concorrentes. Declarar contato com o terreno não desliga essa auditoria. A inspeção tem orçamento de 60 mil triângulos e informa cobertura incompleta; a detecção de chãos concorrentes usa amostragem limitada, sem constituir prova geral de não interseção.

`sceneTerrainMaterial.ts` substitui a remoção do mapa de cor em biomas naturais por camadas PBR em metros. `terrainUv` mantém o detalhe físico ao ampliar o mapa; `terrainLayers` mistura grama/solo, rocha em encostas e neve em regiões alpinas altas. Mapas procedurais de 512 px acrescentam fibras, grãos, fissuras, normais e rugosidade. Imagens e acabamentos artísticos explícitos mantêm seus materiais. JSON preserva os parâmetros; GLB recebe uma alternativa com UVs em metros, pois o glTF padrão não transporta a mistura personalizada de shaders. Isso não acrescenta deslocamento geométrico nem assets fotográficos.

O plano deixou de ser somente instrução no prompt. `scenePlanRealization.ts` materializa rotas omitidas, com desvios em torno dos envelopes das casas, e define um início ausente na zona de chegada. Um bioma omitido recebe o bioma planejado em terrenos naturais. Fonte explícita de caminhos, início autoral, materiais personalizados, altura e estilo de terreno são preservados; divergências ficam na revisão.

`sceneRouteReview.ts` rasteriza a união das superfícies reais em células de 75 cm e verifica conexão entre zonas, degraus/declives e passagens bloqueadas por casas. A revisão também considera visibilidade dos ancestrais, escala física da arquitetura, posição/perigos do início, entidades dos objetivos e quantidades explícitas de cristais/moedas no pedido original. O histórico registra zonas, ligações e famílias previstas, além dos requisitos ainda pendentes após a construção. Mantêm-se uma chamada de planejamento e no máximo duas de construção/refinamento, com cancelamento e quota. A revisão espacial é conservadora e não substitui um navmesh completo nem inspeção artística com modelo visual.

## Ampliação temática e correções da cadeia

**Temas.** `sceneIntent` reconhece o tópico `space` (espaço sideral: planetas, asteroides, órbitas, frotas), separado de interiores de estação, e superfícies planetárias (Lua, Marte, exoplanetas) como paisagens. Florestas, selvas, praias, neve, pântanos, vulcões, fundo do mar, cavernas, cidades, ruínas e acampamentos passam a contar como mundos. `themeBrief` entrega ao construtor, para até quatro temas detectados, bioma, pré-fabricados, céu, neblina e iluminação recomendados. `structuredTopologies` (interior, plataformas, arena, espaço) concentra a regra de não impor relevo, bioma, casas ou rede de estradas; planejamento, realização e revisão usam a mesma lista.

**Espaço.** A revisão pede `sky: "space"`, voo livre ou convés amplo e uma fonte de luz legível, sem exigir terreno. `applyThemeDefaults` corrige deterministicamente céu e modo de voo quando o modelo os esquece, com nota em **Atividade**.

**Biomas e pré-fabricados.** Seis biomas novos com paletas próprias e camadas PBR coerentes (neve usa a textura de neve como base; lunar usa grãos de areia em cinza). Dezenove pré-fabricados novos: `planet` (seed ímpar com anéis), `asteroid`, `spaceship`, `satellite`, `spaceStation`, `rocket`, `mushroom` (bioluminescente com `lit`), `log`, `stump`, `palm`, `cactus`, `coral`, `seaweed`, `crystalCluster`, `column` (quebrada em seeds múltiplas de 3), `tent`, `car`, `boat` e `skyscraper`. Peças móveis ficam em subgrupos animados; `scenePrefabVariants.test.ts` expande todos os tipos com três combinações de semente, tamanho e iluminação e exige zero interseções e zero conflitos coplanares. O teste revelou e corrigiu sobreposições coplanares antigas no guarda-corpo da torre e no corrimão da ponte. Amplitudes de `float`, `bounce` e `orbit` escalam com `size`.

**Planejamento reparador.** `repairScenePlan` corrige a resposta do planejador em vez de descartá-la: limita valores, encaixa e reduz zonas sobrepostas, remove rotas inválidas, liga zonas inalcançáveis à zona alcançável mais próxima, move a chegada para uma zona segura, reduz casas à capacidade, diversifica plantas e retira casas/relevo de gêneros estruturados. As alterações aparecem no progresso. `validateScenePlan` continua estrito.

**Dispersão consciente.** Templates `scatter` são expandidos depois dos objetos explícitos e evitam as áreas de rochas, escarpas, monumentos e outras cópias dispersas (núcleos a 45% da soma das extensões), além de construções, estradas e água. Decoração não colidível pode flutuar (vaga-lumes, partículas) sem ser assentada nem reportada.

**Runtime de jogo.** Saltar sobre um inimigo volta a derrotá-lo (a velocidade de queda é lida antes da colisão). Quedas longas não atravessam pisos finos: velocidade terminal de 30 m/s e empurrão pela normal quando a cápsula cruza um triângulo. Alvos de mostrar/ocultar autorados como invisíveis podem ser revelados. Objetivos contam só itens e inimigos alcançáveis e não vencem no primeiro quadro sem conteúdo correspondente. O diálogo de vitória volta a aparecer em novas partidas; a captura PNG restaura as camadas exatas da câmera; início em voo com voo proibido é assentado no chão; o `OutputPass` é descartado. Edições feitas durante ações assíncronas não somem do histórico, e relatórios de inspeção intermediários não são atribuídos ao documento errado. GLB com escala de nó ou unidades em milímetros é convertido (escala incorporada às dimensões e redução uniforme acima de 1.000 m), em vez de recusado.

Esses testes usam IA programada; não medem a qualidade de um modelo real em pedidos livres.

