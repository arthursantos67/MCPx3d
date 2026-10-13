# Revisão geral e avaliação real — 2026-10-08

A continuação da [auditoria de fidelidade e estabilidade](audit-2026-10-08.md) amplia o catálogo de 18 para **21 recursos**, conserva melhor a intenção mecânica durante reparos e encerra trabalho nativo quando o cliente desconecta. A avaliação inicial com Codex autenticado aprovou **15 de 16 pedidos (93,75%)** nos critérios definidos. A amostra e uma tentativa posterior interrompida pelo provedor **não demonstram 99%** de sucesso geral.

Foram examinados os contratos Python/TypeScript, agente, motor CadQuery/OpenCascade, API, persistência, interface, scripts de avaliação, documentação vigente e histórico disponível. Alterações que já estavam no workspace foram conservadas. Esta revisão acrescenta os itens abaixo ao trabalho anterior; não atribui todo o estado do projeto a esta etapa.

## Geometria e recursos

| Recurso | Comportamento implementado | Limites e interpretação |
|---|---|---|
| `pipe_bend` | Varredura circular maciça ou tubular sobre arco real; diâmetros externo/interno, raio central e ângulo | 1–270°; parede e distância da seção ao centro de curvatura ≥0,1 mm. Arco local XY começa em `(bendRadius,0,0)` e avança para +Y. |
| `helical_spring` | Arame circular sobre hélice real, dois sentidos e voltas fracionárias | 1–32 voltas por recurso e 64 acumuladas com padrões; diâmetro médio na linha central. Extremidades abertas, sem retificação/fechamento; sem cálculo de rigidez/carga. |
| `sweep` | Seção circular maciça ou tubular em trajetória 3D aberta de segmentos retos | 2–16 pontos; 128 segmentos acumulados com padrões. Junções em esquadria; rejeita trechos degenerados e exige validação da topologia final. Não interpola uma curva spline. |
| Região de acabamento | `selectionBox` restringe `fillet`/`chamfer` aos centros das arestas previamente selecionadas | Coordenadas da peça, mínimo ≤ máximo em cada eixo. Região vazia é erro. Não se aplica a `shell`, não equivale a seleção por face/ID topológico persistente. |

Agente, campos do editor, presets, schemas gerados e validadores TS/Python aceitam os mesmos contratos. [Exemplos](../examples/cad/README.md) acompanham os novos recursos. Os contratos existentes permanecem 3.0/4.0, com campos opcionais compatíveis e novos discriminadores de forma.

Os testes verificam volumes analíticos das curvas, cavidades abertas, sentido e voltas fracionárias da mola, deslocamento local da trajetória e material das arestas conservadas. O STEP é reimportado e confrontado com a geometria original. A opção de spline foi examinada e retirada desta implementação porque o round-trip apresentou divergência acima do limite de fidelidade existente; esse limite não foi afrouxado.

Referências da implementação: [API oficial do CadQuery](https://cadquery.readthedocs.io/en/latest/classreference.html) e [exemplo oficial de hélice varrida](https://github.com/CadQuery/cadquery/blob/master/examples/Ex025_Swept_Helix.py). Os limites acima são regras deste projeto.

## Agente e fidelidade do pedido

Reparos não podem substituir silenciosamente engrenagem, cremalheira, mola, curva ou sweep por uma primitiva simples. As proteções anteriores de rosca continuam. Furos declarados conservam término cego/passante, fundo mínimo e tipo de alojamento durante correções. Todas as famílias de provedores usam a mesma verificação de autorização de remoção, incluindo negações como “não remova”. Substituição explicitamente solicitada continua possível.

`cad-explicit-requirements.ts` confere instruções literais de recurso e parâmetros no formato `campo=valor` antes da chamada nativa. É uma defesa conservadora, não um interpretador completo de desenhos ou de qualquer frase dimensional. Recursos pedidos para um conjunto não são exigidos indiscriminadamente de cada componente.

`cad-fastener-contract.ts` reconcilia somente limites **inferidos** de folga com passagens já dimensionadas para fixação `bolted`/`threaded`. Exemplo encontrado na avaliação: passagem Ø4,5 para M4 exige `(4,5−4)/2=0,25 mm`, embora a folga da rosca interna permaneça 0,1 mm. Um contrato com `maxClearance=0,1` recusava essa montagem. A correção ajusta apenas o limite do contrato para 0,25, conserva corpos/diâmetros/engate e declara a premissa. Máximos explícitos, diâmetros incompatíveis e passagens excessivamente grandes bloqueiam a inferência; inspeção mecânica completa permanece obrigatória.

O [candidato original rejeitado](../tests/fixtures/cad/m4-contract-regression.json) acompanha o projeto como fixture. Com a reconciliação, a inspeção real retornou HTTP 200, `mechanicalStatus=verified`, dois sólidos, volume 25.627,289341 mm³ e STEP de 1.588.958 bytes. A regressão nativa conserva o fundo cego nas duas roscas após reimportar STEP e confirma que o contrato anterior ainda é recusado. Isso verifica o reparo do candidato disponível; não transforma a primeira tentativa de geração em sucesso.

## Cancelamento e consumo nativo

O middleware lê uma única vez o canal ASGI, repassa o corpo por fila limitada e sinaliza desconexão para endpoints síncronos. Pedidos desconectados enquanto aguardam não entram no motor. O supervisor verifica cancelamento em esperas de até 100 ms e encerra o processo/descendentes, além das proteções anteriores de memória/prazo.

Um lock do sistema operacional serializa workers entre processos da API com o mesmo `CAD_WORKER_LOCK_PATH`. A espera padrão é 60 s (`CAD_WORKER_QUEUE_TIMEOUT_SECONDS`); timeout retorna ocupação sem tratar o caso como defeito geométrico. Encerramento do processo dono libera o lock pelo sistema operacional. O arquivo permanece no disco e é ignorado pelo Git. Checkouts diferentes precisam compartilhar um caminho absoluto para coordenar o consumo; máquinas diferentes continuam independentes.

Isso limita a concorrência dos workers; não é um teto de RAM de todo o computador. Interface, provedores, outros programas e os próprios servidores continuam consumindo memória. As verificações desta revisão usaram um worker nativo por vez, 1.536 MB e uma thread; não foi repetida a bateria nativa completa nem o atuador complexo.

## Avaliação com IA real

O [relatório no projeto](benchmarks/cad-2026-10-08.json) conserva os 16 casos iniciais, a falha, medidas reais e a tentativa posterior. Provedor: `local-codex`; modelo: `client-default`, sem identificação adicional do modelo resolvido pelo cliente. Não se atribui o resultado a uma versão de modelo não registrada.

| Medida da avaliação inicial | Resultado |
|---|---|
| Pedidos executados | 16/16 |
| Geometria + requisitos conferidos + exportação | 15/16 — 93,75% |
| Limite inferior unilateral exato a 95% | 73,60% |
| Chamadas de IA / verificações CAD | 23 / 21 |
| Mediana / p95 de geração e inspeção | 16,655 s / 169,750 s |
| Casos aprovados com uma chamada de IA | 14 |

O conjunto de três corpos passou após cinco chamadas; a montagem em base roscada falhou após quatro. A falha da montagem combina limite de folga incompatível com suas passagens e JSON inválido no replanejamento. O rascunho completo foi conservado e exportado; isso não conta como aprovação da montagem. A reconciliação acima foi verificada separadamente.

A tentativa real posterior da montagem falhou antes da primeira inspeção, após duas chamadas, por **indisponibilidade temporária do serviço do modelo**. Essa tentativa permanece no relatório: não é descartada e não é apresentada como validação da geração corrigida. Considerando todas as 17 tentativas registradas, houve 15 entregas aprovadas (88,24%); a primeira rodada e a rodada posterior usam estados diferentes do agente e permanecem separadas.

O benchmark agora confere objetos/arrays completos de requisitos (trajetórias, regiões, padrões, coordenadas), defaults do schema, orientação equivalente de eixos, limites/volumes **medidos** e estado mecânico quando solicitados. Exportação ausente, vazia ou com erro impede contar entrega bem-sucedida. `--case` aceita IDs separados por vírgula; `CAD_BENCHMARK_OUTPUT` preserva rodadas distintas e `CAD_BENCHMARK_MODEL` fixa um modelo escolhido. Tempo de download/exportação não integra `durationMs`; a medição termina após geração/inspeção e registra a exportação separadamente.

São casos usados para orientar melhorias, não um conjunto reservado e independente. O benchmark não verifica todos os detalhes de engenharia de cada frase. Repetir este corpus não comprova 99% para qualquer mecanismo. Sob hipóteses de amostragem representativa e independente, 299 sucessos em 299 tentativas dão limite inferior unilateral acima de 99%; essas hipóteses também precisam ser justificadas.

## Verificação e próximos limites

Resultados finais de testes, análise estática, navegador e build estão em [verification.md](verification.md). Logs, JSONs e ZIPs completos locais estão em `.cache/cad-quality-live/{improvements-2026-10-08,regressions-2026-10-08,threaded-fix-2026-10-08}`; o relatório essencial e a regressão foram incluídos no projeto para não depender do cache.

O trabalho seguinte deve ampliar pedidos reservados de mecanismos, medir fidelidade de engenharia e falhas de provedor e persistir checkpoints completos entre reloads. Também faltam solver geral de mates/esboços com restrições, engrenamento mecânico, rolamentos/guia prismática, novas famílias de engrenagens, sequências de instalação/remoção e dimensionamento por carga. A mola nova é geometria real, mas não uma simulação elástica. A verificação de movimento atual continua amostrada, sem prova contínua de ausência de colisões.

Reinicie a API para carregar os novos modelos/recursos e o cancelamento; não é necessário apagar bancos nem revisões. O servidor temporário usado na avaliação foi encerrado e o servidor do usuário em 8001 foi conservado.
