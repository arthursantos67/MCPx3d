# Corpus e avaliações

Fixtures de prompts e verificações de métricas/relatórios para geração estruturada. `npm test` executa os testes `.test.mjs` sem chamar provedores reais.

| Arquivo | Uso |
|---|---|
| `benchmark-prompts.json` | Corpus de pedidos para cena/planos |
| `cad-benchmark-prompts.json` | Pedidos CAD com requisitos verificáveis |
| `multipart-furniture.json` | Caso de geração composta |
| `run-benchmark.mjs` | Relatório de amostras com metadados filtrados |
| `run-provider-benchmark.mjs` | Avaliação opcional de provedor |

`npm run benchmark:cad -- --run --suite` exige API iniciada e cliente autenticado, faz chamadas reais e consome uso do provedor. `--case ID` seleciona casos; `CAD_BENCHMARK_OUTPUT` escolhe a pasta de resultados. Mantenha relatórios em `.cache/`.

Métricas distinguem contrato, fidelidade, geometria, exportação, latência e quantidade de chamadas. Uma amostra não demonstra acerto universal nem certificação mecânica. [Instruções de testes](../../docs/testing.md).
