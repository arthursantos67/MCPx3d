# Exemplos CAD

Os arquivos STEP contêm sólidos B-rep; STL contém malha em milímetros. Os documentos `.FCStd` históricos guardam sólidos importados. O histórico paramétrico editável pertence aos specs e revisões do Forma, não aos arquivos importados no FreeCAD.

## Conjunto composto

- [functional_linear_stage.json](functional_linear_stage.json) e [STEP](functional_linear_stage.step): atuador de oito corpos com Tr12×3 real, duas guias, mancais, volante removível, retenção axial e 12 vínculos mecânicos verificados. `generate_functional_sample.py` verifica o conjunto e reimporta STEP antes de escrever o arquivo. Os fixadores e adesivos declarados precisam ser instalados; o exemplo não dimensiona carga ou fabricação. Consulte [o perfil, a sequência proposta e os requisitos de montagem](../../docs/mechanical-assemblies.md).

- [manual_press.json](manual_press.json): prensa simplificada com estrutura, fuso/haste e prato, três corpos independentes e movimento vinculado.
- [manual_press.step](manual_press.step): conjunto com três sólidos validados após reimportação.
- [manual_press.stl](manual_press.stl): malha dos mesmos corpos, 1.888 triângulos.

Para reproduzir, em `apps/api`:

```bash
uv run python ../../examples/cad/generate_assembly_sample.py
```

O script verifica geometria, interferências em amostras do curso e STEP reimportado antes de escrever os arquivos. É um exemplo geométrico: não representa rosca real, resistência, tolerâncias ou projeto mecânico aprovado.

Na interface, use **Projeto livre** para um pedido novo ou **Conjunto composto** para uma montagem explícita. Propostas aprovadas são salvas e liberam STEP/STL completos e por componente. Ajustar curso ou posição exige salvar uma nova revisão.

## Peça com programa livre

### Recursos mecânicos e roscas

- [mechanical_mount.json](mechanical_mount.json): suporte com arredondamento, chanfro, loft, rasgo, dois furos rebaixados e rosca interna M12 × 1,75.
- [mechanical_mount.step](mechanical_mount.step) e [mechanical_mount.stl](mechanical_mount.stl): um sólido, limites de 100 × 70 × 29 mm, 113.970 triângulos no STL; prévia com 18.236 triângulos.
- [threaded_drive.json](threaded_drive.json): pedestal separado, haste com cabeça sextavada e rosca M12 × 2, porca com folga radial de 0,15 mm. Rotação da haste e translação da porca compartilham um comando; o curso de ±2,3 mm inclui frações do passo para verificar o encaixe.
- [threaded_drive.step](threaded_drive.step) e [threaded_drive.stl](threaded_drive.stl): três sólidos reimportados e validados, 64.576 triângulos no STL; prévia com 9.984 triângulos.
- `generate_feature_samples.py`: valida STEP reimportado, interferências amostradas e prévia, e escreve STEP/STL dos dois exemplos. Execute em `apps/api`: `uv run python ../../examples/cad/generate_feature_samples.py`.

São exemplos geométricos sem certificação de classe de ajuste, resistência ou fabricação. O pedestal do segundo exemplo está ao lado do mecanismo para servir de corpo fixo; não é um suporte funcional de bancada. O mecanismo completo pode ser solicitado usando os [prompts de teste](../../docs/cad-prompts.md).

[construction_program.json](construction_program.json) e [construction_program.step](construction_program.step) descrevem uma peça conectada com perfil extrudado, ressalto e furo transversal. `check_construction_program_freecad.py` preserva o verificador independente usado no marco histórico.

## Peças históricas

| Arquivo | Geometria |
|---|---|
| `mounting_plate.step` / `.FCStd` | Placa 120 × 80 × 10 mm, furos e chanfros |
| `mounting_bracket.step` / `.FCStd` | Suporte em L 120 × 80 × 70 mm com furos |
| `rounded_plate.step` / `.FCStd` | Placa com cantos arredondados e furos |
| `round_flange.step` / `.FCStd` | Flange circular com furo central e furos de fixação |
| `composite_mount.step` / `.FCStd` | Placa com ressalto unido e furos |

Os scripts `generate_*`, `create_*_freecad_*` e `check_*_freecad*` reproduzem a geração e os checks históricos. A API mantém os contratos 2.x, mas os editores de moldes foram retirados; projetos novos usam programa 3.0 ou conjunto 4.0.

No FreeCAD, abra o STEP ou documento nativo, escolha uma vista axonométrica e **Ajustar tudo**. Para mover um corpo importado, selecione-o na árvore e use **Transformar** no menu de contexto.

[Capacidades e limites atuais](../../docs/cad-readiness.md) · [Verificações desta reorganização](../../docs/verification.md).
