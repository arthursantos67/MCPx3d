# Estúdio Three.js — autoria, edição e inspeção

Atualizado em 14 de outubro de 2026. [PRD](../PRD.md), [arquitetura](architecture.md), [planejamento](../ISSUES.md).

## Objetivo e estado atual

Construir cenas visuais detalhadas e animadas por descrição, com edição manual e correção da cena existente. O motor permanece separado das garantias CAD e da representação X3D. Kiro e Workik são referências de experiência citadas pelo usuário; não há equivalência de produto nem medição comparativa de confiabilidade.

A revisão inicial restringia a IA a quatro primitivas e não diagnosticava interferências. A revisão de 14/10 amplia o catálogo, iluminação e materiais, acrescenta importação de malhas GLB, tela cheia e edição por patches. Isso remove limites de autoria; não comprova qualidade universal de pedidos livres nem equivale a um renderizador offline com iluminação global.

## Como usar

- **Tela cheia** expande apenas o viewport, com câmera, seleção e reprodução. Escape sai da alternativa expandida; o navegador também oferece sua saída nativa. Quando a API Fullscreen não está disponível, a expansão ocupa a janela da aplicação. **Enquadrar cena/seleção** calcula o enquadramento pelos cantos da caixa projetados na câmera.
- **Ação da IA → Criar nova cena** produz uma receita procedural; **Editar cena atual** envia o contexto da cena e solicita patches por ID, conservando objetos não mencionados; **Corrigir sobreposições** inspeciona a cena atual e solicita ajustes de posição, rotação e órbitas.
- **Verificar sobreposições** executa a análise local em worker, sem IA. O diagnóstico mostra pares, poses, contatos declarados e se a cobertura foi concluída. Selecionar um par enquadra o objeto correspondente.
- **Contatos intencionais** no inspector permite declarar encaixes por pares. Isso não ignora os demais objetos. Reparos por IA não podem alterar essas exceções para esconder erros.
- **Exemplo detalhado** abre o Observatório Helix, com 139 nós, perfis de revolução/extrusão, condutos por curvas, revestimentos solares e materiais físicos. O pavilhão original continua disponível em **Abrir exemplo**. Exemplos substituem o documento com possibilidade de desfazer.
- **Importar GLB** converte um arquivo local estático em grupos/malhas editáveis. **Exportar JSON** guarda a receita, malhas e imagens de cor incorporadas. Desfazer/refazer conserva até 50 edições na aba.

Inserir/duplicar usa os limites conservadores dos objetos existentes no referencial do grupo pai, com margem de 0,25 unidade local. Isso evita colocar objetos largos na mesma origem. Não resolve automaticamente todo layout, movimento ou contato do projeto.

## Geometria e materiais

Catálogo: caixa, caixa arredondada, esfera, cilindro, cone, toro, nó toroidal, perfil extrudado com recortes, perfil de revolução, tubo por curva Catmull–Rom, malha triangular e grupos. Curvas e perfis são dados; não há execução de JavaScript gerado pela IA.

`geometry` contém parâmetros relevantes ao tipo: `segments`, `radius`, `bevel`, `closed`, `profile` (pares XY ou raio/altura), `holes`, `points` XYZ, `vertices`, `indices`, `normals` e `uvs`. Perfis extrudados rejeitam auto-interseções, recortes cruzados ou externos; malhas verificam índices e triângulos degenerados. Toda geometria é centralizada e normalizada para a caixa `dimensions`. O inspector permite ajustar parâmetros JSON das geometrias pequenas; malhas densas conservam transformação/material editáveis.

O renderer usa `MeshPhysicalMaterial`, ACES, ambiente de estúdio gerado por PMREM/RoomEnvironment, luz hemisférica/direcional e sombras PCF. Materiais oferecem cor, metalicidade, rugosidade, clearcoat, transmissão, emissão, opacidade/transparência/dupla face, imagem de cor e texturas procedurais de metal, madeira, concreto, células solares e revestimento. Emissão não equivale a uma luz indireta que ilumina outros objetos. Sombras e reflexões podem ser desligadas no ambiente. Não há HDRI externo, path tracing ou pós-processamento/bloom.

Geometrias, materiais e texturas são reutilizados por parâmetros e descartados quando deixam de ser usados. DPR fica limitado a 2. Reprodução agenda frames somente enquanto a área está ativa; pausa usa invalidação sob demanda. Repetir um template não é instanciamento GPU: ainda existem draw calls por objeto/passe.

## Contrato, migração e limites

`ThreeSceneDocument` 1.1 contém `name`, `nodes`, `environment` e `timeline`. Importações 1.0 recebem padrões compatíveis para os campos adicionados e são exportadas como 1.1; a chave de rascunho local é mantida para recuperar projetos existentes.

Nós têm IDs, `parentId`, nome, tipo, visibilidade, transformação local, dimensões, material, geometria, animação e `overlapWith`. Eixo vertical Y, metros e rotações XYZ em graus. Trocar o pai conserva valores locais. IDs de contatos precisam existir; duplicação remapeia os contatos internos e exclusão remove referências aos objetos excluídos.

- Até 500 nós, 12 níveis de hierarquia e orçamento conservador de 2 milhões de triângulos no documento.
- Projeto JSON de até 32 MB. GLB de até 16 MB. Imagens de cor são convertidas para PNG de no máximo 2048 px e aproximadamente 2 MB por imagem.
- Posições ±10.000 m, rotações ±360°, dimensões 0,01–1.000 m, escala 0,01–100. Esses limites locais não limitam isoladamente a extensão global de árvores escaladas.
- Perfis/curvas: até 64 pontos, oito recortes de até 32 pontos e 8–128 segmentos. Malha: até 100.000 vértices e 100.000 triângulos por nó, dentro do orçamento global.
- Materiais: rugosidade, metalicidade, clearcoat e transmissão 0–1; emissão 0–10, textura repetida 0,1–32; cores #RRGGBB. Ambiente: exposição 0,1–3, intensidade 0–5.
- Rascunho em localStorage. Projetos com malhas/texturas podem exceder a quota do navegador mesmo abaixo do limite JSON. A interface informa a falha; o usuário deve exportar JSON para conservar o trabalho. Não há armazenamento de assets no servidor nem fallback silencioso para IndexedDB.

GLB aceita geometria triangular estática e materiais suportados. Arquivos com skins, morphs/clipes nativos, referências externas, Draco/Meshopt/KTX2, escala espelhada ou cisalhamento são recusados com diagnóstico. Imagem de cor/UV0 e valores escalares são preservados; mapas especiais (normal/metalicidade/rugosidade/emissão) e transformações/canais UV especiais geram aviso de simplificação. Luzes/câmeras do asset não substituem o rig do editor. Não há exportação GLB nem edição esquelética.

## Diagnóstico espacial e reparo

A análise usa caixas conservadoras para descartar pares, BVHs dos dois lados para verificar cruzamento de triângulos e teste de contenção para formas fechadas suportadas. Isso permite, por exemplo, distinguir um objeto dentro do furo de um toro de uma interpenetração real. Contenção de malhas arbitrárias/tubos abertos não é certificada. Contato coplanar, superfícies abertas e tolerâncias numéricas exigem interpretação; não é um solver de sólidos CAD.

São inspecionadas a pose inicial e três amostras adicionais da timeline quando há movimento. A análise limita refinamentos a 3.000 pares e orçamento de 8 s no worker; um prazo externo de 15 s encerra a tarefa. Cobertura incompleta é explicitamente informada e não aprova geração/reparo. Não há prova contínua de ausência de colisões entre amostras.

Criação inspeciona o candidato e permite uma correção de receita antes de aplicar. Persistência de interferências inesperadas recusa a proposta e conserva a cena anterior. Edição contextual não pode introduzir novos pares. Reparo precisa reduzir os pares existentes, sem adicionar novos e com inspeção concluída; pode conservar progresso parcial, mostrando pares ainda pendentes. Reparos preservam geometria, dimensões, escala, visibilidade e hierarquia, sem ocultar/apagar objetos ou modificar exceções para passar na análise.

Patches são atômicos. Objetos não mencionados preservam seu conteúdo, inclusive malhas/imagens que não são enviadas integralmente ao modelo. Adições podem referenciar grupos existentes. Exclusões não são aceitas nesse fluxo; continuam sendo uma ação manual explícita no inspector.

## Geração, progresso e prazo

Receitas compactas aceitam até 80 templates e repetições lineares/radiais de 1–100 cópias, respeitando os limites expandidos. Animações iniciais: rotação, flutuação senoidal e órbita, com eixo, período, amplitude e fase. A timeline dura 1–120 s e pode ser buscada/reproduzida sem modificar a pose base ou criar histórico por frame.

Há no máximo duas chamadas de IA por ação, incluindo uma correção. Prazo total configurável de 2, 5 (padrão) ou 10 minutos. A ponte Codex/Claude Code mantém 300 s por chamada; escolher 10 minutos não amplia esse teto individual. Erros de provedor e truncamento não iniciam reparos automáticos de contrato.

O painel distingue preparação, espera pela IA, validação de contrato, construção, inspeção espacial e aplicação. Planejamento e receita ainda vêm juntos como JSON completo: não há acesso às subetapas internas do modelo nem percentual de conclusão. O histórico fica na memória da área. Timeout/cancelamento preserva a cena e exige nova tentativa; não recupera JSON interrompido.

## Próximos trabalhos

Gizmos e seleção múltipla; pipeline de assets com persistência IndexedDB/servidor, mapas físicos completos e exportação GLB; instanciamento, LOD e streaming; planejamento incremental para cenas maiores; câmera animada, keyframes livres, skins e pós-processamento. Antes de elevar limites, medir tempo p50/p95, FPS, memória, draw calls, fidelidade e conclusão por provedor/hardware. Não há benchmark que sustente desempenho constante ou zero erros em qualquer pedido livre.

## Referências

[Geometria extrudada](https://threejs.org/docs/pages/ExtrudeGeometry.html), [tubos por curvas](https://threejs.org/docs/pages/TubeGeometry.html), [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh). Dependências são empacotadas localmente; a cena de exemplo não carrega assets por CDN.
