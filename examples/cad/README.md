# Placa de fixação no FreeCAD

Abra `mounting_plate.FCStd` no FreeCAD para inspecionar o sólido de 120 × 80 × 10 mm. O arquivo `.step` contém a mesma geometria para intercâmbio com outros programas CAD. O documento nativo contém um corpo selecionável, criado a partir do STEP validado; os parâmetros editáveis de furos e chanfros permanecem no projeto CAD do aplicativo.

Para enxergar a espessura, escolha **Exibir → Vistas padrão → Axonométrica** ou clique num canto do cubo de navegação. Use **Ajustar tudo** se a peça estiver fora do enquadramento.

Para deslocar a peça com o mouse, selecione **Placa de fixação** na árvore de modelo, clique com o botão direito e escolha **Transformar**. Arraste as setas do manipulador que aparecer na vista 3D e confirme a transformação. Arrastar diretamente a face sem ativar esse comando apenas seleciona a geometria.

O documento é gerado por `create_freecad_document.py`. `check_step_freecad.py` verifica o STEP, e `check_freecad_document.py` reabre o documento nativo e confirma que o corpo é 3D e aceita uma mudança de posição.

## Suporte em L

Abra `mounting_bracket.FCStd` ou `mounting_bracket.step` para ver um suporte de 120 × 80 × 70 mm: base horizontal de 8 mm, parede traseira de 8 mm, dois furos na base e dois na parede. É um único sólido unido, com canto interno reto. No aplicativo, escolha **CAD → New CAD part → L bracket (base + upright)** para criar e editar esse tipo de peça.

`generate_bracket_sample.py` reproduz o STEP a partir da especificação versionada. `check_bracket_freecad.py` importa o STEP no FreeCAD e verifica sólido, dimensões, volume e furos. `create_bracket_freecad_document.py` gera o documento nativo; `check_bracket_freecad_document.py` confirma que ele reabre e pode ser deslocado.

## Perfis curvos

`rounded_plate.step` tem contorno retangular com raio de 12 mm nos quatro cantos e dois furos. `round_flange.step` é um disco de diâmetro 100 mm e espessura 12 mm com furo central e dois furos de fixação. Os arquivos `.FCStd` correspondentes permitem abrir e posicionar cada sólido no FreeCAD. A árvore nativa contém o sólido importado; os parâmetros editáveis ficam nas revisões do aplicativo.

No aplicativo, escolha **CAD → New CAD part → Rounded plate** ou **Circular flange**. Também é possível escrever "Crie uma placa com cantos arredondados" ou "Crie um flange circular com furo central e dois furos de fixação". `generate_curved_samples.py`, `check_curved_freecad.py`, `create_curved_freecad_documents.py` e `check_curved_freecad_documents.py` reproduzem e verificam os exemplos.

## Peça composta

`composite_mount.step` e `composite_mount.FCStd` contêm uma placa de cantos arredondados com ressalto cilíndrico unido, furo central atravessando base e ressalto, e quatro furos de fixação na base. O arquivo nativo contém um corpo selecionável importado do STEP; a parametrização e as revisões ficam no aplicativo. Escolha **CAD → New CAD part → Composite: base + fused cylinders** para editar esse tipo de peça. Os scripts `generate_composite_sample.py`, `check_composite_freecad.py`, `create_composite_freecad_document.py` e `check_composite_freecad_document.py` reproduzem as verificações.
