# Personagens e skins da 0.6

Atualizado em 22/10/2026. A implementação pode ser retomada a partir do código e dos testes deste repositório; o registro antigo em [v06-continuacao.md](v06-continuacao.md) descreve uma interrupção anterior.

## Estado implementado

- `sceneSkinGeometry.ts`: campos de distância, união suave, extração de superfície, refinamento, suavização, normais e inspeção de topologia.
- `sceneSkinPlan.ts` e `sceneSkinModel.ts`: planos por família, pesos com até quatro influências e três LODs compartilhando o esqueleto.
- `sceneSkinFeatures.ts`: olhos, pálpebras, sobrancelhas, boca, dentes, cabelo, barba, roupas e capas. As mãos possuem cadeias de falanges com gestos de repouso, punho, mão aberta e apontar.
- `sceneSkinMaterial.ts` e `sceneSkinMesh.ts`: doze regiões de material, com aparência de pele, tecido, couro, metal, cabelo e outras superfícies.
- `sceneSkin.ts`: cache, vinculação dos ossos aos holders do rig, rosto, mãos e troca de qualidade preservando o esqueleto em uso. O cache não descarta buffers/material enquanto alguma skin ainda os utiliza.
- `sceneAvatar.ts`: construção do avatar com o mesmo caminho de skins usado pelos personagens da cena. Explorador, cavaleiro e mago recebem pele contínua; robô permanece rígido. As armas do jogo substituem as armas padrão do modelo.
- `sceneBuild.ts`: esconde as peças substituídas apenas na renderização e preserva seus proxies para seleção e interação, respeitando a visibilidade dos ancestrais. A pele usa as dimensões, materiais e transformações das peças atuais do documento.

Humanoides orgânicos, lobo, cervo, aranha e dragão recebem pele. Esqueleto, golem, drone e robô conservam peças rígidas por decisão de modelagem. Não são falhas de integração.

No jogo, rosto e mãos acompanham a pose: a escalada e os golpes fecham os dedos, armas ficam empunhadas e interações podem apontar. NPCs com diálogo ativo recebem animação de fala. Cabelo longo e capas usam as molas já existentes. Alterações de qualidade gráfica atualizam as skins da cena e do avatar sem reiniciar a partida.

## Exportação

O GLB exporta o LOD de maior detalhe, esqueleto, índices/pesos de pele e clipes procedurais de ociosidade e caminhada. O documento permanece inalterado. Regiões de material são convertidas em cores de vértice e materiais PBR comuns, com triângulos agrupados por material para limitar a quantidade de primitivas.

Microtexturas e transições calculadas pelo shader do Forma são aproximadas nessa conversão; o shader não é código portátil de glTF. A exportação não grava a partida, ataques, decisões de NPCs ou interações do jogo. A importação de GLB externo com esqueleto e redirecionamento de clipes continua sendo outro trabalho, distinto da pele procedural nativa.

## Verificação e limites

`sceneSkin.test.ts` cobre as famílias, topologia, pesos, deformação, rosto, arquétipos, LOD, cache e tempo de geração. `sceneSkinIntegration.test.ts` cobre a construção real do avatar, seleção por proxies, dedos, troca de qualidade, vida útil dos recursos, conversão de materiais e clipes exportados. `three-skins.spec.ts` verifica a galeria no navegador, reabre o GLB com `GLTFLoader` e exercita diálogo, câmeras, qualidade e reinício do jogo.

O HUD, a animação e o mundo vivo já estão integrados ao viewport; [threejs-motion-fixes.md](threejs-motion-fixes.md) registra as correções de movimento e combate. Testes de navegador usam Chrome/SwiftShader. Não comprovam FPS em GPU física nem o critério artístico de comparação cega com jogos comerciais do roadmap. A geração inicial das malhas ainda é síncrona; o cache evita repetir modelos idênticos. Colisão e seleção continuam usando proxies, sem interseção por triângulo da pele deformada.
