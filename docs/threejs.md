# Three.js: estúdio e mundos interativos

## Criar e editar

Abra Three.js · Estúdio de cenas. A cena ocupa a área principal; Projeto reúne exemplos, arquivos e biblioteca. Editor avançado expõe hierarquia, inspector, materiais, luzes, geometria e animações. W/E/R selecionam mover/girar/escalar; ? mostra os atalhos.

Para criar por conversa, configure a IA e descreva o resultado. Opções de criação permite escolher Criar nova cena, Editar cena atual ou Corrigir cena. Edições aplicam mudanças por ID e preservam objetos omitidos. Correção inspeciona superfícies/movimentos e só aceita melhora sem novos defeitos. Projeto → Verificar cena executa inspeção local, sem IA.

Atividade mostra etapa e diagnóstico. Ações de cena podem usar prazos de 2, 5 ou 10 minutos. Criação/edição conservam a melhor candidata construída e indicam problemas restantes. Cancelamento preserva o documento anterior conforme o fluxo da ação.

## Modelos, materiais e ambiente

A biblioteca fornece modelos estáticos e personagens animados, com licenças/atribuições nos diretórios [KayKit](../apps/web/public/models/kaykit/README.md) e [catálogo](../apps/web/public/models/catalog/README.md). GLB importado pelo editor deve ser estático e não depender de referências externas.

O catálogo procedural inclui terreno, perfis, tubos, texto, poliedros, objetos de cenário, personagens e construções. O ambiente oferece céu, dia/noite, neblina, água, vento, vegetação, clima, luzes, sombras, bloom e gradação conforme a qualidade escolhida.

## Jogar

Clique ▶ Jogar ou pressione P. WASD move, mouse olha, Shift corre, Espaço pula, E interage/conversa, clique ataca e botão direito faz ataque pesado. V alterna câmera; F alterna voo quando permitido. B abre inventário; 1–5/roda selecionam atalhos; Q esquiva; Esc pausa; M silencia; ? mostra ajuda. Configurações também oferecem controles de gamepad.

As experiências podem incluir portas, coleta, inimigos, NPCs, diálogo, armas, poderes, missões, fabricação, equipamentos, consumíveis, água nadável e construções colocáveis. Inventário usa slots com arraste e bancada contextual. Regras e HUD completo/discreto dependem da cena; sandbox permite exploração sem campanha obrigatória.

Alterações durante o jogo pertencem ao progresso; o documento autoral deve permanecer preservado ao sair. Áudio sintetizado inicia mediante interação e pode ser silenciado. Colisões são aproximações; não há simulação geral de corpos rígidos.

## Mundos

`ThreeWorldDocument` 2.0 descreve semente, terreno, regiões, locais, rotas e orçamentos. Terreno é gerado em workers e transmitido em blocos com níveis de detalhe. Biomas, rios, lagos, vegetação e locais compõem a exploração. Mapa com névoa, viagem rápida e montaria dependem do mundo.

A geração combina um atlas com detalhe local sob demanda. Terreno, colisão e pré-carga precisam estar prontos antes da entrada em uma região. Cenas e mundos mantêm orçamentos explícitos; a cena jogada tem limite de 2.000 nós. Desempenho varia conforme GPU, resolução e complexidade, e não é garantido por testes em SwiftShader.

## Salvar e exportar

| Formato/armazenamento | Conteúdo e limite |
|---|---|
| Projeto JSON | Documento para importar e continuar editando; cenas 1.3 e mundos 2.0 |
| GLB | Geometria, materiais e animações suportadas; não inclui o motor de jogo |
| PNG | Captura da imagem do viewport |
| Armazenamento local | Rascunho de cena, sujeito à quota do navegador |
| IndexedDB | Documento/progresso de mundo, sujeito à quota do navegador |

O editor aceita cenas compatíveis 1.0–1.2 e as migra ao importar. Pele/esqueleto e clipes suportados são exportáveis; a aparência de shaders é aproximada no GLB. Exportação JSON é a forma de transportar o projeto. Limpar os dados do navegador remove rascunhos/progresso locais.

## Requisitos

Edição, reprodução e jogo usam WebGL2 e funcionam sem API. Geração por IA depende do provedor; somente WebLLM exige WebGPU. Recursos grandes podem exceder RAM, VRAM ou armazenamento: reduza complexidade/qualidade e exporte JSON. [Requisitos completos](../PRD.md#7-threejs) · [Testes](testing.md).
