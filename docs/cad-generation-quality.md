# Qualidade de geração CAD — 2026-10-07

As alterações tratam três falhas observáveis: muitas estratégias de correção somando seus limites locais, STL bloqueado por um limite compartilhado de 10 MB e alojamentos de cabeça que podem ficar enterrados ou atravessar todo o bloco. Também reduzem trabalho nativo concorrente, que provocou falta de memória durante a verificação neste computador.

## Planejamento e correções

Conjuntos com três ou mais corpos recebem uma revisão antes da construção. O modelo confere eixos locais/globais, engate nas extremidades, paredes, apoios e acesso às cabeças. IDs, quantidade de componentes e modo de verificação são conservados. A revisão pendente é um checkpoint: quota não exige repetir o plano inicial.

Pedidos de fuso/atuador recebem um exemplo numérico adaptável do [atuador verificado](../examples/cad/functional_linear_stage.json). Ele explica núcleo abaixo da raiz da rosca, munhões separados, guia contra giro, offsets locais e volante removível com retenção axial. O modelo continua escolhendo a decomposição; copiar/adaptar o exemplo não aprova o novo conjunto.

Criação/edição compartilha até 20 chamadas de IA, 48 verificações distintas e 20 minutos. Correção de montagem compartilha 5 chamadas, 16 verificações e 4 minutos. Dois candidatos repetidos encerram uma correção por falta de progresso. Campos JSON reordenados não geram um candidato novo. Os caches geométricos têm 64 entradas por tipo, na instância da aba; salvamento revalida na API. O prazo libera a interface e cancela a requisição/provedor, mas não mata necessariamente um cálculo nativo já iniciado.

Prévia, inspeção e exportação CAD entram numa fila por processo/event loop da API, com espera de até 60 s. Uma fila ocupada responde `CAD_ENGINE_BUSY`, sem pedir correção paga. OpenCascade usa duas threads por padrão (`CAD_KERNEL_THREADS`, 1–8). Isso reduz simultaneidade e picos de memória; não impõe um teto de RAM nem substitui isolamento de processo.

O mesmo benchmark encontrou outra rejeição indevida: duas guias individuais referenciavam furos corretos de um padrão linear, mas o motor rejeitava qualquer padrão receptor. Agora cada eixo precisa corresponder a exatamente uma instância coaxial; a instância escolhida recebe todas as provas existentes de engate, folga e material. Padrões ausentes/ambíguos, eixos positivos repetidos e padrões circulares receptores não são aceitos. O reparo antecipado do agente continua limitado a recursos simples; a decisão sobre os padrões ocorre na verificação nativa final.

## Cabeças de parafusos e material

O benchmark de oito corpos revelou também um falso negativo no verificador mecânico: a prova de material usava o raio do furo simples mesmo dentro do rebaixo da cabeça. A região corretamente removida era interpretada como falta de parede. A prova agora acompanha o raio do rebaixo ou do escareado em cada profundidade, verifica vazio/material e amostra as transições. Rebaixos sem assento, sem parede, fora do stock ou preenchidos posteriormente continuam sendo rejeitados.
Rebaixo cilíndrico e escareado já eram cortes reais no motor. O editor agora explicita o alojamento e coloca furos novos na face externa de um bloco/cilindro alinhado. Presets M3–M10 usam cabeça cilíndrica, furo de passagem e altura da cabeça. A referência nominal vem da [tabela de fixadores Bossard, seção de parafusos de cabeça cilíndrica](https://www.ruuvikeskus.fi/attachments/1amgl.pdf). O preset acrescenta **1 mm no diâmetro do alojamento e 0,3 mm na profundidade**, premissas de projeto editáveis, sem certificação de ajuste. Cabeças cônicas usam escareado; outras geometrias e ferramenta de aperto exigem dimensionamento próprio.

Em blocos novos alinhados, sem uniões, a preparação pode ampliar dimensões inferidas para conservar parede ao redor de cavidades. Conserva eixos e dimensões explícitas; crescimento que enterraria cortes roscados axiais é bloqueado. Entradas inequívocas de rebaixos, inclusive padrões coplanares, passam para a face externa. Edições não recebem crescimento automático de stock. A inspeção estática de blocos simples identifica entrada enterrada, rebaixo inteiramente fora do material e ausência de assento. Cavidades complexas, acesso completo e sequência de instalação continuam fora dessa análise simplificada.

No editor, o rebaixo M5 inicial só é escolhido quando há stock primitivo conhecido com pelo menos 1 mm de assento e parede radial. Stock fino/estreito/desconhecido inicia furo simples, mantendo o diâmetro de passagem; não escolhe automaticamente um parafuso menor. Selecionar um alojamento ou preset explicitamente mantém suas medidas e exige stock compatível.

## Exportação

STL tem limite dedicado de **64.000.000 bytes**, configurável por `MAX_CAD_STL_BYTES`. STEP/X3D conservam 10.000.000 bytes. A exportação usa `Shape.exportStl(relative=False)`, cópia sem triangulação anterior, deflexão linear absoluta configurada de 0,1 mm e tentativas angulares de 0,1/0,2/0,35/0,5 rad. O helper genérico do CadQuery não transmite `relative`, por isso não era suficiente passar essa opção no dicionário `opt`.

Cabeçalhos `X-CAD-STL-*` e `report.stl` informam contagem/tolerâncias aplicadas; não equivalem a certificação dimensional. Todos os corpos entram na malha. O ZIP de rascunho admite 128.000.000 bytes (`MAX_CAD_DRAFT_BUNDLE_BYTES`); se apenas um STL não couber, conserva os STEP/JSON e registra sua omissão. Reimportação STEP, validade de sólidos e aprovação de montagem continuam separadas.

O conjunto salvo de oito sólidos reproduziu o problema: a exportação antiga produziu **39.313.784 bytes**, acima de 10 MB. A nova rota retornou **200**, **37.571.384 bytes**, **751.426 triângulos**, tolerâncias configuradas de 0,1 mm/0,1 rad. A revisão/spec original não foi alterada. Esse teste comprova recuperação do download, sem aprovar novamente o funcionamento desse projeto.

## Medição com modelo real

`npm.cmd run benchmark:cad -- --run` usa Codex autenticado pelo cliente local, o modelo padrão do CLI, limites normais e o kernel real. Não há respostas programadas. Arquivos ficam em `.cache/cad-quality-live`; nenhum projeto é gravado no banco. A opção `--complex` mede um atuador roscado de oito peças; `--resume` reutiliza seu rascunho exportado como entrada de edição numa nova ação, em vez de refazer a geometria disponível. O script não faz retentativas automáticas e interrompe casos restantes em quota.

| Pedido real | Resultado | IA / inspeções | Duração |
|---|---|---|---|
| Placa com quatro alojamentos M5 | Validada; STEP/STL em ZIP | 1 / 1 | 48,5 s |
| Eixo estacionário com dois suportes e engate mínimo | Conjunto mecanicamente validado; STEP/STL em ZIP | 5 / 4 | 136,8 s |
| Atuador roscado de oito peças, execução inicial | Prazo inicial de 600 s atingido; base conservada e ZIP exportado | 4 / 1 | 600 s |
| Atuador de oito peças, retomada com prazo de 1.200 s | Gerou os oito corpos; ZIP de 14.969.504 bytes. Verificador antigo rejeitou alojamentos/padrões válidos | 14 / 13 | 1.187,4 s |

O caso de oito peças mostrou que planejamento e revisão podiam consumir quase todo o prazo antes da construção. O limite de criação foi ajustado para 1.200 s e foi acrescentada a referência mecânica numérica; reparos continuam em 240 s. A retomada também revelou os falsos negativos de alojamento/padrões tratados acima. Após corrigir o verificador, **o mesmo JSON completo de oito corpos passou numa reinspeção nativa em 121,3 s, sem alterar sua geometria nem fazer novas chamadas de IA**: HTTP 200, `mechanicalStatus=verified`, oito sólidos e STEP reimportado de 1.856.808 bytes. Isso é aprovação após recuperação e correção do motor, não um sucesso imediato da execução original nem do primeiro prazo de dez minutos.

Poucas medições não estabelecem uma taxa geral de sucesso, nem uma comparação estatística de qualidade. Cargas, fabricação, vida útil e movimento contínuo não são aprovados por esses testes.
