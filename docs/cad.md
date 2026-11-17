# CAD: peças, conjuntos e exportação

## Criar uma peça

Abra CAD → Projeto livre, descreva medidas em milímetros e indique furos, roscas, acabamentos e restrições. O agente escolhe peça ou conjunto, constrói o JSON e solicita inspeção. Uma peça aprovada é salva automaticamente e libera STEP/STL. Mudanças manuais exigem validar e salvar uma nova revisão.

Para trabalhar sem IA, abra Peças paramétricas. Placa, cantoneira, flange, caixa aberta e bucha têm campos dimensionais e relações verificadas antes de construir. Exporte o projeto paramétrico JSON para conservar as medidas.

## Formatos

| Contrato | Função |
|---|---|
| `CadProgramSpec` 3.0 | Sequência de construção de uma peça |
| `CadAssemblySpec` 4.0 | 2–8 peças, posições, movimentos e vínculos |
| Projetos paramétricos | Famílias dimensionais sem inferência |
| STEP | Sólidos B-rep para ferramentas CAD |
| STL | Malha em milímetros |
| JSON | Receita/parâmetros editáveis, sem garantia de aprovação do sólido |

O catálogo inclui base/união/corte, primitivas, perfis, furos, loft, casca, chanfro, arredondamento, padrões, roscas reais, engrenagem reta, cremalheira, tubos curvos, molas e sweeps. Consulte os [schemas](../packages/domain/schemas/) para campos e intervalos. Os contratos CAD 2.x também são aceitos pelas rotas correspondentes.

## Conjuntos e vínculos

Use Conjunto composto para solicitar corpos separados. Cada corpo tem posição e movimento fixo, linear, rotativo ou helicoidal. Grupos ligam comandos por fatores, por exemplo rotação de fuso e avanço de carro.

A verificação mecânica é exigida por padrão. O contrato `mechanics` declara a peça ancorada e as conexões por IDs de recursos. O perfil suporta contato plano adesivo, união adesiva eixo/furo, fixação parafusada com passagens/base roscada, captura, guias cilíndricas, mancais e fuso estacionário com carro guiado. Duas guias paralelas separadas são exigidas para um carro linear nesse perfil.

**Verificar montagem** não chama IA. **Corrigir interferências** inspeciona o conjunto existente, tenta reparos locais e pede edição do componente pendente quando necessário. **Modificar conjunto com IA** permite alterações gerais. Projetos sem vínculos são identificados como `unverified`; desativar a exigência mecânica cria um conceito geométrico.

Fixadores e adesivos declarados são requisitos de montagem. Não há dimensionamento de carga, pré-carga, resistência, fabricação ou sequência de instalação. Movimento é cinemático e colisão é amostrada, não contínua.

## Aprovação e salvamento

Uma peça deve ser conectada, topologicamente válida e sobreviver à exportação/reimportação STEP. Conjuntos são inspecionados na posição atual e em cinco amostras adicionais do curso. Verificação mecânica e ausência de interferência são condições distintas.

Uma revisão salva é a fonte de STEP/STL do conjunto e dos componentes. Se uma alteração falhar, a revisão anterior permanece intacta. Erro 409 indica atualização concorrente: recupere o estado antes de salvar novamente.

## Recuperação e rascunhos

1. Preserve a aba após interrupção. Retomar o mesmo pedido reutiliza plano e componentes concluídos.
2. Use Baixar rascunho com erro (JSON) para conservar a receita. Importar rascunho CAD (JSON) recupera o documento para inspeção e edição.
3. Havendo sólidos recuperáveis, Baixar rascunho STEP/STL (ZIP) inclui geometria, receita original e relatório de partes/etapas omitidas. Acabamento inválido pode resultar em exportação do prefixo válido.
4. Um rascunho não cria revisão aprovada. Valide e salve para habilitar os downloads da revisão.

Pedido, geometria e diagnóstico recuperáveis são guardados no navegador. O checkpoint completo de IA fica na memória da aba; reload não conserva o orçamento/estado completo da geração. Falha apenas no salvamento permite reutilizar o resultado concluído sem outra inferência enquanto ele estiver na aba.

## Limites e recursos

Por padrão, um worker CAD usa até 2.048 MB, 240 segundos e duas threads do kernel. A fila/lock permite uma operação nativa por vez e espera de até 60 segundos. Ajuste as variáveis em [apps/api/.env.example](../apps/api/.env.example); checkouts separados precisam compartilhar o caminho absoluto do lock para compartilhar a fila.

STEP/artefatos gerais têm limite de 10 MB, STL de 64 MB e ZIP de rascunho de 128 MB. O STL usa tolerâncias próprias; simplificação da prévia não reduz a precisão do STEP. Roscas complexas e conjuntos grandes podem consumir minutos.

Chanfros, filetes, roscas, tolerâncias e vínculos dependem do perfil implementado; uma proposta de IA não garante fabricação. [Exemplos disponíveis](../examples/cad/README.md) · [Requisitos CAD](../PRD.md#5-cad).
