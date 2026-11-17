# Exemplos CAD

Os arquivos JSON são projetos/receitas para importar, inspecionar e editar. STEP/STL são gerados sob demanda, sem guardar resultados de uma máquina no repositório.

| Exemplo | Conteúdo |
|---|---|
| [parametric-flange.json](parametric-flange.json) | Flange por medidas |
| [construction_program.json](construction_program.json) | Programa com perfil, ressalto e furo |
| [pipe_bend.json](pipe_bend.json) | Curva tubular por arco |
| [helical_spring.json](helical_spring.json) | Mola helicoidal |
| [sweep.json](sweep.json) | Tubo em trajetória segmentada |
| [mechanical_mount.json](mechanical_mount.json) | Suporte com furos, rosca e acabamentos |
| [threaded_drive.json](threaded_drive.json) | Corpos com rosca real e movimento vinculado |
| [threaded_blind_mount.json](threaded_blind_mount.json) | Passagens/rebaixos e base com roscas cegas M4 |
| [manual_press.json](manual_press.json) | Conceito geométrico de prensa com três corpos |
| [functional_linear_stage.json](functional_linear_stage.json) | Conjunto com fuso Tr12×3, guias, mancais e vínculos |

Na interface CAD, importe o contrato correspondente, confira o diagnóstico e valide/salve para liberar os arquivos da revisão. Um conceito sem `mechanics` não recebe aprovação mecânica. Fixadores/adesivos são requisitos declarados, sem cálculo de carga ou certificação de fabricação.

Os scripts `generate_*.py` constroem exemplos usando a API. Execute da raiz, por exemplo:

```bash
uv run --project apps/api python examples/cad/generate_assembly_sample.py
```

Executam geometria nativa: rode um por vez. Os arquivos exportados são ignorados pelo Git. [Guia CAD](../../docs/cad.md) · [Contratos](../../packages/domain/README.md).
