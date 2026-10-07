# Vínculos mecânicos de montagem — 2026-10-06

Geometria sem colisões não recebe aprovação mecânica. A criação de conjuntos pela interface exige, por padrão, um plano de vínculos antes de construir as peças. Conceitos geométricos continuam disponíveis quando essa opção é desmarcada e são identificados como sem verificação mecânica.

## Contrato e aceitação

`CadAssemblySpec` permanece na versão 4.0 e recebe `mechanics` opcional para preservar dados antigos. O contrato contém `grounded`, o ID de uma peça fixa, e até 24 conexões. Cada conexão possui ID, tipo, componentes, IDs dos recursos, folga radial máxima, engate axial mínimo, método de fixação e diâmetro do fixador quando aplicável. Todas as peças precisam de um caminho de conexão até a peça ancorada; IDs inexistentes ou referências perdidas são rejeitados em TS/Python. A criação mecânica pela interface exige o contrato; callers do SDK ativam `requireMechanics=true`.

| Vínculo | Evidências verificadas |
|---|---|
| Fixo por adesivo | Superfícies planas opostas com área comum de pelo menos 1 mm²; alternativamente eixo/furo com material, folga e engate. O adesivo é requisito explícito de montagem. |
| Fixo parafusado | Superfícies de montagem em contato; pelo menos dois furos passantes coaxiais em padrão linear, abertos e com material ao redor; diâmetro do fixador compatível. Os parafusos precisam ser instalados. |
| Fixo capturado | Pequenas translações nos dois sentidos dos três eixos encontram batentes físicos; rotação de ±15° no eixo do movimento encontra antirrotação. Uma cavidade circular solta não fixa uma porca. |
| Guia linear | Eixo positivo e furo receptor alinhados em coordenadas globais, folga e engate dentro dos limites, material presente. O grupo rígido do carro exige duas guias paralelas separadas para impedir giro. |
| Mancal rotativo | Munhão liso e furo alinhados, material/engate e rotação relativa compatíveis. O eixo precisa de batentes que impeçam deriva axial nos dois sentidos em todas as poses amostradas. |
| Transmissão roscada | Roscas macho/fêmea de mesmo diâmetro, passo, perfil, sentido e entradas; material helicoidal exposto; engate e folga; relação de rotação/translação coerente com o avanço. Animação vinculada e metadados de rosca não bastam. |

Os centros/eixos incluem posição local, rotação do recurso, movimento e posição do componente. Furos começam na entrada e seguem Z local negativo; cilindros/roscas são centrados. Isso evita duplicar a altura da peça na geometria e na posição global, causa dos suportes suspensos do atuador anterior.

Um eixo individual pode usar o ID de um padrão linear receptor quando há exatamente uma instância coaxial. O verificador seleciona essa instância e conserva as provas de engate, folga e material. Correspondências ausentes ou ambíguas não são aceitas. Padrões positivos e receptores circulares exigem recursos individuais.

O motor usa os mesmos sólidos/poses da análise de interferência. Material em pares de recursos é amostrado em quatro direções e três estações axiais; roscas também verificam cristas/vales nas fases da hélice. Um recurso positivo seguido somente de uniões conserva seu material por construção; operações posteriores de corte/acabamento exigem consultar o sólido final. Vales de rosca e material dos receptores são sempre consultados. Contatos planos e provas de retenção usam interseções reais. Classificadores são reutilizados dentro da inspeção; poses exatamente equivalentes de rotação/translação reutilizam verificações e conservam diagnósticos por pose. Nenhum cache persiste entre specs diferentes.

Peças rotativas fixadas entre si formam um grupo rígido quando compartilham comando, fator e eixo global coaxial. A retenção axial consulta a geometria de todo esse grupo, permitindo um volante/ressalto removível que seja instalado depois do mancal. Compartilhar apenas o nome do comando não comprova fixação.

Uma revisão com contrato mecânico inválido não pode ser salva. Inspeção, prévia e salvamento aplicam as mesmas regras. Falhas de colisão incluem defeitos mecânicos quando presentes; o coordenador não aceita reduzir uma colisão criando ou modificando um defeito mecânico. Edições não podem descartar silenciosamente o contrato existente.

## Uso na interface

**Verificar vínculos mecânicos ao criar** fica ativo por padrão, inclusive quando Projeto livre identifica um conjunto. **Verificar montagem** chama a API sem IA. **Corrigir montagem com IA** solicita correção de posições, recursos, apoios e vínculos, mantendo as peças não afetadas. É uma ação diferente de corrigir somente interferências.

Rascunhos mecânicos que falham são conservados na área de edição e podem ser exportados. A criação/edição autônoma pode rever o plano uma vez após falha final, conservando as peças não afetadas; a ação de corrigir montagem também permanece disponível. Checkpoints ainda dependem da aba; exporte o JSON antes de reload.

O construtor distingue medidas explícitas do pedido original das dimensões inferidas no plano. A interface CAD delega decisões com `noQuestions=true`: não apresenta perguntas nem pedidos de autorização. O schema exige criação/edição e pergunta vazia; uma resposta de esclarecimento que ignore esse schema recebe até duas tentativas internas de resolução. Se o modelo insistir, o processo termina em falha técnica, conservando seu contexto para retomada. Quota ou cancelamento interrompem sem novas chamadas e mantêm a decisão pendente. Callers do SDK podem manter o modo antigo explicitamente.

Eixos e engate são comparados com os recursos dos corpos disponíveis nas seis poses antes de aceitar um componente. A guia Ø8×208 entre furos [-108,-96] e [96,108] tem 8 mm de engate: para exigir 12 mm em ambos, uma guia centrada precisa de pelo menos 216 mm. O comprimento pode ser escolhido no componente atual sem regenerar os suportes. Um munhão que sobressai 3 mm de um furo passante não necessariamente colide; o motor mede material em comum e verifica engate separadamente. A checagem antecipada interpreta recursos declarados; a validação nativa final continua obrigatória para comprovar material e interferências.

Se a validação do conjunto completo mostrar que é necessário rever peças concluídas, criação/edição autônoma pode fazer um único replanejamento seletivo com a geometria completa disponível, mantendo os componentes não afetados. **Corrigir interferências** continua no modo de reparo direto, sem outro planejamento. Nenhum fluxo aceita um resultado mecanicamente inválido para evitar uma falha técnica. Recursos não suportados e conflitos sem solução verificável não produzem perguntas ao usuário na interface.

Projetos antigos sem contrato permanecem acessíveis, com `mechanicalStatus=unverified`. A inspeção mostra distâncias entre corpos fixos separados e não inventa fixações a partir dos nomes das peças. Dados do atuador anterior reproduzem o vão de 24 mm entre base e suportes. Conjuntos verificados recebem `mechanicalStatus=verified`, referente a estes vínculos e às poses amostradas.

## Atuador reproduzível

[functional_linear_stage.json](../examples/cad/functional_linear_stage.json) contém oito corpos: base, dois suportes, duas guias, fuso, volante removível e carro com porca roscada integrada. Tem 12 conexões declaradas e curso de ±30 mm.

- Base: 240 × 100 × 12 mm, ocupando Z=0–12. Os suportes começam em Z=12, com altura 60 mm; não ficam suspensos.
- Guias Ø8 mm em Y=±30 e Z=45. Furos dos suportes usam Z local=33 com posição global Z=12, resultando em Z=45.
- Fuso em Z=30, com Tr12×3 direita, uma entrada e trecho útil de 180 mm. Munhões Ø9 em furos Ø9,4 permitem passagem pela rosca interna. O ressalto interno do fuso e o ressalto externo do volante retêm o eixo no mancal esquerdo. O volante Ø28 mm não intercepta a base e é uma peça separada, fixada por adesivo ao encaixe Ø9 do fuso.
- Carro com dois furos de guia e rosca interna integrada, com folga radial de 0,2 mm. A porca integrada evita depender de retenção de uma porca solta. Fuso: fator -120°/mm; carro: 1 mm/mm, no mesmo comando.
- Cada suporte requer dois fixadores passantes Ø6 mm, porcas e arruelas. A espessura nominal combinada é 72 mm; o comprimento final depende de cabeça, arruelas e porca e precisa ser dimensionado. Fixadores não são sólidos do STEP.
- As guias e o volante usam união adesiva declarada. Seleção/preparação do adesivo e capacidade de carga exigem avaliação de engenharia. O exemplo representa um protótipo com esses requisitos, não uma bancada dimensionada para qualquer carga.

Sequência proposta: rosquear o carro pela extremidade direita do fuso antes de instalar o apoio direito; passar os apoios sobre seus munhões lisos; inserir as duas guias pelos apoios e pelo carro; instalar os fixadores na base; instalar e aderir o volante pelo lado esquerdo, preservando a folga radial e sem colar o eixo ao mancal; aderir as guias e aguardar a cura antes de movimentar. O volante separado permite colocar o apoio esquerdo antes de fechar sua retenção axial. Esta sequência foi revisada pelas dimensões do exemplo; não há solver de caminhos de instalação nem verificação de acesso das ferramentas.

O [STEP gerado](../examples/cad/functional_linear_stage.step) conserva oito sólidos e a rosca real. Para reproduzir a geração e reimportação, em `apps/api`, execute `uv run python ../../examples/cad/generate_functional_sample.py`. Na interface, importe o JSON, use Verificar montagem e salve para obter STEP/STL pela revisão persistida. A montagem antiga do usuário não foi substituída por este exemplo.

## Limites explícitos

Este perfil não é um solver geral de mates e não simula forças. Verifica relações declaradas e evidências de geometria nas poses atual, 0%, 25%, 50%, 75% e 100%. Não comprova toda a trajetória, rigidez, resistência, desgaste, vibração, lubrificação, pré-carga, classes ISO, processo de fabricação ou sequência de instalação/remoção. Captura geométrica não comprova que uma peça pode ser inserida depois da fabricação.

Ainda não são verificados movimentos helicoidais do próprio corpo, guias prismáticas, engrenamento, fixações roscadas cegas, padrões circulares de fixadores ou padrões de eixos positivos. Padrões lineares receptores precisam de correspondência coaxial única. A criação mecânica escolhe uma alternativa suportada quando viável; se não houver solução verificável, termina em falha técnica. Conceitos geométricos continuam possíveis. A API não transforma uma montagem legada em um projeto funcional automaticamente.

Os testes usam CadQuery e STEP reais com respostas de IA programadas. Isso verifica o fluxo, as aceitações e as rejeições cobertas, sem medir a qualidade de geração livre de um modelo. Resultados estão em [verification.md](verification.md); expansão do perfil e prova de sequência de montagem estão priorizadas em [ISSUES.md](../ISSUES.md).
