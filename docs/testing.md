# Desenvolvimento e testes

Instale conforme o [README](../README.md). Execute as etapas em sequência em máquinas com pouca memória. Não é necessário iniciar a aplicação para os testes unitários; Playwright inicia seus próprios serviços.

## TypeScript e build

Na raiz:

```bash
npm run lint:web
npm run typecheck
npm test
npm run build
npm run docs:check
```

As suítes de frontend, agentes e domínio usam um processo de testes por vez. Testes de agentes usam respostas programadas e não consomem assinatura. A verificação de documentação confere links locais e âncoras Markdown.

## Python

Use Python 3.12 e os locks versionados. Em `apps/api` e depois em `packages/domain/python`:

```bash
uv sync --frozen --python 3.12
uv run ruff check .
uv run mypy src
```

No domínio: `uv run pytest`. Na API, execute `uv run python ../../scripts/run-api-tests.py`. O executor roda cada arquivo em processo separado e sequencial; `--isolate-cases` libera memória nativa entre casos individuais, inclusive parâmetros. O CI usa essa opção no CAD para não acumular sólidos e caches de roscas. O prazo padrão é de 900 segundos por seleção. `--group core`/`--group cad` e `--shard 1/2` permitem dividir a suíte sem perder cobertura no conjunto das execuções.

Para um teste CAD local pequeno com teto de memória/prazo, após instalar a API:

```bash
uv run --project apps/api python scripts/run-cad-tests.py --memory-mb 1536 --timeout 150 apps/api/tests/test_cad_gears.py -q
```

O executor limitado controla processo/filhos no Windows. Execute somente um grupo nativo por vez e evite simultaneidade com navegador, build ou modelo WebLLM. A suíte completa exige mais recursos e pode ser executada no GitHub Actions. No Windows sem uv no PATH, substitua `uv` por `python -m uv`.

Para regenerar schemas CAD a partir do domínio Python, use `uv run --project apps/api python scripts/generate-cad-schemas.py`. Os testes TS/Python verificam fixtures compartilhadas e compatibilidade de schema.

## Navegador

```bash
npx playwright install chromium
npm run test:browser
```

Playwright usa um worker. O projeto `cad-x3d` inicia API em 8011 e Vite em 5181; bancos isolados ficam em `.cache/browser`. Respostas da IA são simuladas, enquanto motores, validação, visualizadores e downloads são exercitados de fato.

Para selecionar um caso CAD/X3D:

```bash
npm run test:browser -- --project cad-x3d tests/browser/cad-parametric.spec.ts
```

Para Three.js sem iniciar API:

```bash
npm run test:browser:three
npm run test:browser:three -- tests/browser/three-studio.spec.ts
```

A suíte Three.js usa renderer real em SwiftShader, com API/provedor simulados. Isso verifica fluxos e contratos, mas não mede FPS/aparência em GPU real. Se necessário, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` aponta para um navegador já instalado; sem essa variável, usa o Chromium do Playwright.

Falhas geram screenshots/traces em `test-results/`; abra com `npx playwright show-trace <arquivo.zip>`. Capturas usadas em comparações de animação permanecem nos próprios testes; não são geradas imagens auxiliares em todas as execuções. Resultados e bancos de teste não são versionados.

## CI

O workflow [CI](../.github/workflows/ci.yml) executa documentação, lint/tipos/testes/build TypeScript, API, domínio Python e navegador. API CAD é dividida em grupos e cada caso roda em um processo descartável. Three.js usa shards em executores distintos e não inicia CadQuery. Cada executor de navegador mantém um worker. Artefatos de falha são anexados à execução no GitHub.

## Avaliações opcionais

`tests/golden` contém corpus e verificações de relatórios. `npm run benchmark:cad -- --run --suite` usa API já iniciada e cliente autenticado, faz chamadas reais e consome uso do provedor; não integra o CI. `--case ID` seleciona pedidos. Resultados devem permanecer em `.cache/`, sem versionar dados de uma máquina.

`scripts/benchmark-three-fps.mjs` mede GPU real com um navegador compatível; `--out` e `--compare` recebem caminhos de relatório. Uma medição depende de hardware, resolução e cena. Não confunda teste com provedor simulado com avaliação da qualidade de uma IA real.
