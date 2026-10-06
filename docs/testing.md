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

## Python

Em `apps/api` e depois em `packages/domain/python`:

```bash
uv sync
uv run ruff check .
uv run mypy src
uv run pytest
```

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

Playwright inicia API na porta 8011 e Vite na 5181, usa SQLite separado em `.cache/browser` e o backend X3D local. Somente respostas HTTP do provedor de IA são simuladas. React, API, CadQuery, validadores, visualizadores e downloads são reais. A prévia X3D ainda carrega X3DOM pela internet.

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
