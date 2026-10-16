# Executar e interpretar os testes

Instale dependências conforme o [README](../README.md). O submódulo precisa estar inicializado para usar schemas X3D e testes MCP.

## TypeScript e frontend

Na raiz:

```bash
npm run lint:web
npm run typecheck
npm test
npm run build
```

`npm test` executa testes do frontend, agentes, domínio TypeScript e relatórios golden. Os testes de agentes usam propostas programadas e verificam parsing, validação, reparos, cotas, retomada e cancelamento; não são um benchmark da IA.

Para o gerador Three.js isolado, `node --test --test-concurrency=2 apps/web/tests/three/*.test.ts` verifica o núcleo e `npx playwright test --config playwright.three.config.ts` executa as regressões de navegador iniciando apenas o frontend. A API e o modelo são simulados nessa configuração. Tanto a configuração isolada quanto o projeto `three` da suíte completa usam 90 s por teste, pois capturas e leituras de quadros no SwiftShader podem consumir boa parte do prazo. O projeto `cad-x3d` mantém o prazo geral de 60 s, com limites maiores nos casos nativos complexos.

## Python

Em `apps/api` e depois em `packages/domain/python`, instale e confira tipos/lint:

```bash
uv sync
uv run ruff check .
uv run mypy src
```

Testes do domínio não carregam o motor CAD: `uv run pytest` em `packages/domain/python`. Para testes nativos locais, execute **um grupo por vez**, com teto de memória/prazo, da raiz:

```powershell
apps/api/.venv/Scripts/python.exe scripts/run-cad-tests.py --timeout 120 apps/api/tests/test_cad_gears.py -q
apps/api/.venv/Scripts/python.exe scripts/run-cad-tests.py --timeout 150 apps/api/tests/test_cad_holes.py -q
```

O executor usa por padrão 1.536 MB, uma thread, temporários em `.cache/temp` e encerra a árvore de processos ao atingir o prazo. `--memory-mb` permite 512–4.096 MB e `--timeout` 1–600 s. Escolha grupos pequenos; não execute o atuador complexo simultaneamente com navegador/build ou outro grupo nativo. O teto também inclui os workers filhos no Windows. O CI tem recursos próprios e mantém a suíte completa; sua aprovação não foi medida nesta revisão.

No Windows sem uv no PATH, use `python -m uv` ou o Python do ambiente: `.venv/Scripts/python.exe -m pytest`. Configure `UV_CACHE_DIR`, `TEMP` e `TMP` em F: antes de uma instalação manual neste computador.

A API verifica sólidos CadQuery, reimportação STEP, STL, interferências, revisão, persistência, schemas e cenas X3D. Testes de compatibilidade MCP iniciam e encerram seu próprio serviço isolado; não precisam de um serviço já em execução.

Os testes de recursos CAD conferem filetes em pontos de crista/raiz e sua direção antes/depois do STEP, roscas de 1–4 entradas, porca/fuso em curso fracionário, furos rebaixados/escareados, acabamentos, cascas e orçamento de prévia com oito corpos rosqueados. Para regenerar schemas depois de alterar Pydantic, execute da raiz `.venv/Scripts/python.exe` do ambiente da API com `scripts/generate-cad-schemas.py`; os testes do domínio detectam divergência dos arquivos gerados.

## Navegador

Na raiz:

```bash
npx playwright install chromium
npm run test:browser
```

Para usar Chrome já instalado no Windows:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd run test:browser
```

Playwright inicia API na porta 8011 e Vite na 5181, usa SQLite separado em `.cache/browser` e o backend X3D local. Nas suítes CAD/X3D, somente respostas HTTP do provedor de IA são simuladas. A suíte independente Three.js também simula indisponibilidade da API e falhas de armazenamento/WebGL2, pois seu motor é local. React, API, CadQuery, validadores, visualizadores e downloads são reais. A prévia X3D ainda carrega X3DOM pela internet.

Para verificar apenas o novo estúdio:

```bash
npm run test:browser -- tests/browser/three-studio.spec.ts tests/browser/three-quality.spec.ts tests/browser/three-game.spec.ts
node --test apps/web/tests/three/*.test.ts
```

Os testes de contrato Three.js cobrem árvores inválidas/cíclicas, limites, números não finitos, duplicação de subárvore, histórico, round trip JSON, compatibilidade de documentos estáticos, expansão procedural, amostragem de animações, reparo limitado e cancelamento. Os testes de navegador usam o renderer Three.js real (exceto o caso de WebGL2 indisponível), seleção por raycast, inspector, troca de área, reload, importação/exportação, viewport móvel e falhas de persistência. A geração usa respostas programadas do provedor, verifica animação no canvas, cancelamento, prazo configurável com relógio virtual, identificação da etapa interrompida/histórico de correção e conservação da cena anterior; não consome uma assinatura real. A suíte de qualidade também verifica tela cheia/fallback, cena procedural detalhada, diagnóstico em worker, reparo/edição de uma cena existente e importação GLB real com recusa de clipes/referências externas. Não são um benchmark de cenas complexas. A suíte `three-game.spec.ts` renderiza o exemplo jogável com céu, luzes e pós-processamento sem erros de shader, exporta GLB (cabeçalho, clipes e luzes) e PNG, entra no modo jogo por teclado, coleta por proximidade, abre uma porta com E, dispara gatilho de tecla, anda, alterna voo e confirma que o documento exportado não muda; também cobre gizmos/atalhos, deslocamento por setas, exclusão/desfazer, referência de atalhos, luz spot, céu noturno e bloom. Os testes unitários `sceneGame.test.ts` cobrem migração 1.2, validação de luzes/interações, novas primitivas e alturas do terreno, keyframes e animações disparadas, runtime de portas/coletáveis/teclas/proximidade, cápsula com BVH/caixas/voo, receitas em grade/dispersão/`onto`, patches de ambiente, mapas de teclado e a ilha jogável sem interferências. Testes também reproduzem receitas imperfeitas (segmentos fora do limite, `onto` entre grupos, geometria inválida, referências inexistentes), entrega da melhor cena com prazo esgotado ou falha do provedor na chamada de ajuste, descarte apenas no cancelamento do usuário e, no navegador, a cena aplicada com observações e diagnóstico. O renderer roda em SwiftShader: FPS e aparência não representam GPU real.

Os casos cobrem:

- Criação mecânica com vínculos obrigatórios, fixação real, inspeção sem IA e download STEP; deslocamento manual que rompe contato impede salvar e conserva a revisão anterior. Inspeção legada aponta o vão de 24 mm. Casos históricos de conceitos geométricos selecionam esse modo explicitamente.

- Folga do volante na base durante o curso, preservação do corpo rosqueado, salvamento sem inferência e revisão em posição intermediária.
- Recuperação independente de peça/conjunto e resposta tardia de um provedor substituído.

- Conjunto com dois corpos, STEP/STL completos, componente STEP, alteração de movimento, nova revisão e recuperação.
- Peça isolada, STEP/STL, edição inválida, última prévia válida e recuperação da revisão intacta.
- Cena X3D validada, canvas no iframe sandbox e downloads X3D/HTML com MCP desligado.
- Layout móvel sem transbordamento e configuração da IA.

Screenshots de inspeção ficam em `.cache/browser`; falhas produzem screenshot e trace em `test-results`. Para abrir um trace: `npx playwright show-trace <arquivo.zip>`. Esses diretórios não são versionados.

## Alcance

Passar nesses testes demonstra os contratos e os fluxos exercitados. Não demonstra que qualquer pedido livre produzirá uma máquina correta. Uma avaliação da IA real precisa de modelo/provedor disponível, pedidos representativos, dimensões esperadas, número de tentativas, latência e critérios geométricos.

O CI executa TypeScript/build, API, domínio Python e navegador em jobs separados. Os resultados executados neste ambiente estão em [verification.md](verification.md).

## Benchmark de fidelidade com IA real

O comando abaixo **consome a assinatura autenticada**, usa a API local já iniciada e executa sequencialmente 16 pedidos de [cad-benchmark-prompts.json](../tests/golden/cad-benchmark-prompts.json). Não roda como parte de `npm test`:

```powershell
npm.cmd run benchmark:cad -- --run --suite
```

`--case ID` seleciona um pedido, ou uma lista separada por vírgulas; `--repeat N` repete de 1 a 100 vezes os selecionados. Sem `--run`, apenas mostra o uso. O modo histórico de dois pedidos, `--complex` e `--resume` permanece disponível. Resultados ficam em `.cache/cad-quality-live/report-suite.json`, com receitas e ZIPs, sem salvar projetos no banco. `CAD_BENCHMARK_OUTPUT` escolhe outro diretório para conservar rodadas anteriores; `CAD_BENCHMARK_API` escolhe a API e `CAD_BENCHMARK_MODEL` fixa o modelo. Modelo vazio usa o padrão do cliente e precisa ser identificado como tal na interpretação. Não há repetição automática após falhas; quota interrompe a série e o relatório conta casos não executados.

Sucesso exige aprovação do kernel, correspondência aos recursos/quantidades esperados e ausência de falha de exportação. Requisitos podem declarar campos aninhados, coordenadas, direção de eixo, componente de destino, dimensões medidas, intervalo de volume e estado mecânico; medidas precisam da inspeção real, não são deduzidas da receita. O relatório inclui taxa observada, duração mediana/p95, chamadas/verificações, exportações e limite inferior unilateral exato a 95%. A interpretação exige amostra independente e representativa; repetição de 16 prompts não comprova acerto universal ou dimensionamento mecânico. [project-improvements-2026-10-08.md](project-improvements-2026-10-08.md) registra a avaliação real e seus limites.
