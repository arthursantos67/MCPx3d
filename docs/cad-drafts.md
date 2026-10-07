# Recuperação e exportação CAD — 2026-10-07

As falhas recorrentes tinham causas distintas: a exportação dependia da aprovação completa, candidatos úteis ficavam somente no checkpoint interno, a falha de um corpo interrompia todos os seguintes, planos inventavam interfaces em referenciais diferentes e a interface encerrava a ação após uma única correção da assinatura. Um pedido de oito peças também podia ser classificado como um único sólido. As mudanças tratam esses caminhos sem conferir aprovação funcional a uma montagem incompleta.

## O que fica disponível

Após gerar uma receita estruturada, a interface conserva o rascunho, inclusive em quota ou falha de validação. Edições manuais e conjuntos importados não salvos também oferecem exportação de rascunho. **Baixar rascunho STEP/STL (ZIP)** executa somente o motor CAD. O pacote inclui:

- `<partId>-draft.step` e `.stl`, com os corpos disponíveis na posição atual;
- arquivos de cada corpo em `components/`, quando há mais de um sólido;
- `original-draft.json`, com a receita completa, incluindo operações que falharam;
- `report.json`, com pedido, falha de origem, peças planejadas ausentes, etapas executadas e omitidas.

STL tem limite independente de 64 MB e quatro tentativas angulares limitadas, com deflexão linear configurada de 0,1 mm absoluta. `report.stl` registra bytes, triângulos e tolerâncias. Se uma malha não couber, nome/diagnóstico ficam em `report.stl.omitted`; o STEP correspondente continua no pacote. ZIP admite até 128 MB; STEP conserva o limite de 10 MB.

Cada sólido incluído precisa ser válido e ter volume positivo. O STEP é reimportado e conferido por sólidos, volumes e limites; STL é derivado desse STEP. Corpos sobrepostos permanecem independentes. Não se fundem componentes para esconder interferências. O relatório declara `status=draft` e `assemblyValidation=not_run`, mesmo quando todos os corpos foram construídos.

Se o chanfro falhar após construir o eixo/volante, exporta-se o sólido anterior ao chanfro, sem executar as operações posteriores desse componente. Essas omissões são explícitas no relatório. Se nem a base puder formar um sólido, aquele corpo é omitido; os demais continuam disponíveis. Se não houver sólido algum, a rota retorna `CAD_DRAFT_EMPTY` e o JSON continua baixável. Não se cria um STEP/STL artificial de geometria inválida.

Rascunhos não criam revisões nem sobrescrevem projetos. Downloads normais de STEP/STL continuam usando a revisão aprovada, com verificação completa de interferências e vínculos declarados. Exportar um rascunho não comprova montagem, funcionamento ou fabricação.

## Construção e posicionamento

O planejador usa um referencial global único, separa a posição do componente de offsets internos e constrói referências antes de dependentes. O construtor recebe recursos completos das peças disponíveis e alvos numéricos: centro/eixo global, intervalo axial e centro equivalente no referencial local atual. Um furo parte da face de entrada e segue Z local negativo; cilindros comuns são centrados. O orçamento de construção permanece 32 etapas por componente e 128 no conjunto.

Para cilindros e furos simples sem padrões, ajustes inferidos de eixo/comprimento podem atender a todos os vínculos disponíveis e às seis poses. O motor verifica o candidato antes de aceitá-lo. Não se alteram diâmetros, roscas ou corpos já concluídos. Dimensões e coordenadas explícitas restringem o reparo automático. A guia Ø8×208 com furos em [-108,-96]/[96,108] passa para 216 mm e obtém 12 mm de engate em cada suporte sem chamar a IA. Um curso de ±4 mm requer 224 mm no fixture equivalente.

O pedido explícito de 2–8 peças prevalece sobre a classificação incorreta do modelo e é conferido no plano, deixando a decomposição a cargo da IA. O construtor de cada corpo recebe até 6.500 tokens de saída, sujeito ao limite do provedor.

## Orçamentos e retomada

A criação/edição inteira compartilha 20 chamadas de IA, 48 inspeções distintas e 20 minutos. Correção de montagem compartilha 5 chamadas, 16 inspeções e 4 minutos; seu coordenador local permite seis propostas/16 validações. Dois candidatos repetidos interrompem a correção antes do orçamento máximo. JSON com campos reordenados é o mesmo candidato. O prazo libera a interface e cancela requisição/provedor; não garante encerramento do kernel. Resultados são reutilizados em cache limitado na aba, mas salvar revalida na API.

Planos de três ou mais peças recebem uma revisão adicional antes da construção, dentro do orçamento global. Quota conserva a revisão pendente para retomada. Instruções priorizam material funcional e interfaces antes de acabamentos; presets e cálculos de cabeça/parede estão em [cad-generation-quality.md](cad-generation-quality.md).
A interface permite até três correções geométricas por programa em uma ação, além dos reparos determinísticos limitados. O histórico de candidatos rejeitados evita testar novamente a mesma geometria e acompanha a próxima correção. Uma falha de contrato permite uma resposta corrigida e, se ainda faltarem campos dimensionais conhecidos, um preenchimento focado. JSON truncado, quota, cancelamento e indisponibilidade do provedor interrompem imediatamente. O SDK sem orçamento explícito conserva a política anterior do provedor.

Quando somente a validação geométrica de um componente esgota o orçamento, sua receita fica pendente e a criação continua nos próximos corpos. Esse comportamento é optativo no SDK por `allowUnverifiedDrafts` e ativo na criação pela interface. A retomada na mesma aba reutiliza o plano e as peças concluídas e corrige as pendentes. Se o plano não declarou vínculos obrigatórios, a retomada solicita um plano mecânico para os corpos disponíveis, preservando os IDs e permitindo reutilizá-los. Uma peça pendente não é usada como referência já validada. O progresso distingue corpos concluídos e pendentes por ID, inclusive quando a primeira peça falha.

Geometria disponível, pedido e diagnóstico são guardados no navegador e recuperados após reload para prévia/download. Falha de armazenamento apresenta aviso para baixar o JSON. O checkpoint completo da IA, seus orçamentos e a classificação/plano interno ainda não são persistidos; recuperação de geometria não promete retomada exata após fechar a aba. O JSON de um conjunto completo pode ser importado no editor para continuar o trabalho.

## Limites restantes

O motor não representa todos os mecanismos e seleções arbitrárias de faces/arestas. Operações nativas ainda não têm cancelamento garantido nem prazo por processo. Interferências e vínculos são amostrados, não comprovados continuamente. As regressões usam CadQuery/STEP reais e modelos programados; as medições separadas com modelo real estão em [cad-generation-quality.md](cad-generation-quality.md). Essa amostra não estabelece uma taxa geral de sucesso. Esses limites estão registrados em [ISSUES.md](../ISSUES.md).
