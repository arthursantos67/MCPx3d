# Forma — requisitos do produto

## 1. Propósito

Forma é um estúdio de criação 3D que combina linguagem natural, edição visual e validação determinística. O repositório MCPx3d contém uma interface web, uma API local e pacotes compartilhados. O produto oferece três workspaces independentes: CAD para sólidos e conjuntos, X3D para cenas declarativas e Three.js para cenas animadas e mundos interativos.

O resultado esperado é um projeto editável e exportável, com indicação clara de aprovação, avisos e limites. A IA propõe estruturas JSON; os motores da aplicação decidem se os contratos e a geometria são válidos.

## 2. Usuários e tarefas

| Perfil | Tarefa | Resultado |
|---|---|---|
| Pessoa que precisa de uma peça | Descrever dimensões ou usar um modelo paramétrico | Sólido inspecionado e arquivo STEP/STL |
| Pessoa que compõe mecanismos | Planejar corpos, posições, movimentos e vínculos | Conjunto com diagnóstico geométrico/mecânico e exportação por componente |
| Pessoa que cria cenas | Descrever, editar e reutilizar objetos | Cena X3D validada e manifesto reimportável |
| Pessoa que cria experiências | Compor objetos, terreno, personagens e regras | Projeto Three.js editável, explorável e exportável |
| Desenvolvedor | Integrar provedores e motores, alterar contratos | Schemas compartilhados e verificações reproduzíveis |

## 3. Escopo e fronteiras

- A aplicação interpreta dados tipados. Respostas de IA não são executadas como código, comandos, HTML ou XML.
- CAD, X3D e Three.js compartilham configuração e navegação, mas conservam contratos e motores distintos. Não há conversão automática de cena para sólido CAD.
- O modo padrão usa API local e biblioteca X3D incorporada por submódulo. Um servidor MCP é opcional.
- Three.js deve permitir editar, reproduzir e jogar sem API e sem IA. A geração por conversa depende do provedor selecionado.
- A instalação é destinada a uso privado. A API não possui autenticação multiusuário nem isolamento de projetos por conta.

## 4. Experiência compartilhada

O usuário seleciona o workspace, configura a IA quando necessário e acompanha a ação em andamento. A interface deve distinguir inferência, construção, inspeção e salvamento; mostrar erros acionáveis; permitir cancelamento; e conservar o último estado válido após falha.

Configurar, testar e aplicar um provedor são ações separadas. Um teste de conexão não altera o provedor ativo. Trocar modelo/provedor não deve permitir que uma resposta tardia substitua o estado atual.

Pedidos devem preservar medidas e recursos explícitos. Premissas e diagnósticos são metadados separados da geometria. Uma falha de contrato, indisponibilidade, quota ou cancelamento não pode ser apresentada como aprovação.

## 5. CAD

### 5.1 Criação e edição

O workspace oferece Projeto livre, Conjunto composto e Peças paramétricas. A criação livre escolhe peça ou conjunto; edições conservam a representação existente. A bancada sem IA inclui placa de fixação, cantoneira, flange, caixa aberta e bucha, com validação dimensional antes da construção.

Uma peça usa `CadProgramSpec` 3.0: sequência ordenada de base, união, corte e acabamento, em milímetros. O catálogo inclui primitivas, extrusão/revolução de perfis, tubos/toros, rasgos, furos simples/rebaixados/escareados, lofts, cascas, chanfros, arredondamentos, padrões lineares/circulares, roscas helicoidais, prismas, engrenagens retas, cremalheiras, curvas tubulares, molas e sweeps segmentados.

Roscas possuem diâmetro, passo, comprimento, perfil, sentido, número de entradas e folga aplicável. A geometria é real no STEP/STL; não representa certificação de tolerância. Reparos não podem substituir silenciosamente uma rosca por cilindro nem reduzir medidas explicitamente solicitadas.

Um conjunto usa `CadAssemblySpec` 4.0: 2–8 componentes independentes, transformações, movimentos fixos/lineares/rotativos/helicoidais e grupos com fatores. Cada componente deve ser um sólido conectado e válido. A simulação é cinemática; não calcula forças.

### 5.2 Verificação geométrica e mecânica

Schema, regras do domínio e kernel são verificações obrigatórias e distintas. Uma revisão aprovada exige construção válida, exportação/reimportação STEP, sólidos, volume e limites espaciais coerentes. Conjuntos passam por interferência na posição atual e em cinco amostras adicionais do curso.

A criação de conjuntos exige vínculos mecânicos por padrão. O contrato declara ancoragem, grafo de conexões, recursos por ID, apoios e fixações. A inspeção verifica contato, material, alinhamento, folga, engate, retenção e coerência entre avanço e movimento dentro do perfil suportado.

O perfil inclui contatos planos adesivos, adesão eixo/furo, montagem parafusada com passagens e base roscada, captura geométrica, guias cilíndricas, mancais lisos e fuso estacionário rotativo com carro guiado. Fixadores comerciais e adesivos são requisitos declarados; a aplicação não os dimensiona automaticamente.

**Verificar montagem** funciona sem inferência. Dados sem vínculos recebem estado `unverified`. Conceitos geométricos são permitidos quando o usuário desativa explicitamente a exigência mecânica. Falha mecânica impede salvar uma revisão que declare essa aprovação.

### 5.3 Agente, reparo e recuperação

O agente planeja componentes no mesmo referencial global, preserva componentes concluídos e usa inspeções para ajustar o candidato. A interface resolve decisões internamente; impossibilidade persistente deve terminar em diagnóstico técnico.

Reparos locais podem corrigir encaixes cilíndricos/roscados, fase helicoidal, folgas de movimento e acabamentos inferidos dentro de limites explícitos. Progresso parcial só é aceito quando reduz defeitos sem introduzir ou piorar outros. O kernel confirma o resultado em todas as poses amostradas. Correção de interferências atua no conjunto existente e solicita apenas o componente necessário quando precisa de IA.

Criação/edição têm orçamento global de até 20 chamadas de IA, 48 verificações distintas e 20 minutos; correção de montagem, até 5 chamadas, 16 verificações e 4 minutos. Candidatos repetidos interrompem o reparo. Limites por provedor e por ação podem encerrar antes desse máximo.

Quota, cancelamento ou indisponibilidade preservam componentes e checkpoints disponíveis na aba. A retomada reutiliza trabalho concluído. JSON, pedido e diagnóstico recuperáveis são guardados no navegador; o checkpoint completo da IA permanece em memória e não sobrevive ao fechamento/reload.

Quando houver sólidos recuperáveis, o usuário pode exportar um rascunho ZIP com STEP/STL, receita e relatório de omissões. Rascunhos não recebem aprovação de montagem e não substituem revisões salvas. Sem sólido recuperável, o JSON continua disponível.

### 5.4 Persistência e exportação

Projetos, revisões, inspeções e STEP aprovados persistem em SQLite. Criação aprovada por IA salva automaticamente; alterações manuais exigem nova validação/salvamento. Atualizações usam `expectedRevision`; conflito retorna 409 sem sobrescrever dados.

STEP preserva B-rep; STL representa malha em milímetros. Downloads de projeto e componente derivam da revisão persistida. A prévia pode ser simplificada independentemente dos arquivos exportados.

## 6. X3D

A IA retorna `ModelPlan`; o domínio aplica operações ao `ModelSpec` 1.0. A API serializa a cena e valida estrutura, domínio, XSD e semântica antes de publicar a revisão. Alterações inválidas conservam a última cena válida.

O backend padrão é local. O transporte MCP opcional deve conservar as mesmas garantias. Exportações disponíveis: X3D, HTML, ClassicVRML e manifesto JSON. X3DJ permanece indisponível enquanto o conversor incorporado não produzir saída válida.

A política espacial padrão é visual: sobreposições de caixas delimitadoras geram avisos, sem provar colisão de superfícies nem deslocar objetos automaticamente. Separação global explícita pode bloquear essas sobreposições. A prévia HTML roda em iframe com sandbox e carrega X3DOM externo.

Sessões e artefatos X3D são temporários. O manifesto JSON deve permitir exportar/importar a cena entre reinícios; receitas reutilizáveis persistem em SQLite.

## 7. Three.js

### 7.1 Estúdio e documentos

O viewport é o foco da interface. Projeto reúne arquivos, biblioteca e exemplos; Editor avançado expõe hierarquia, inspector, gizmos e controles de animação; Atividade apresenta progresso e diagnóstico.

O contrato de cena 1.3 representa objetos, hierarquia, materiais, luzes, ambiente, animações, personagens e regras de interação. Importação aceita documentos compatíveis e migra versões 1.0–1.2. O contrato `ThreeWorldDocument` 2.0 representa semente, terreno, regiões, locais, rotas e orçamentos; arquivos de cena continuam abrindo como cenas.

Criação, edição e correção por IA são ações distintas. Edição aplica patches por ID e preserva objetos omitidos. Correção usa inspeção espacial/temporal e exige melhora sem novos defeitos. Criação/edição conservam a melhor candidata construída e indicam pendências. O usuário pode escolher prazo total de 2, 5 ou 10 minutos para ações de cena.

O editor permite seleção, transformação, materiais, luzes, terreno, texto, geometrias, reprodução de animações, desfazer/refazer, biblioteca de modelos e importação de GLB estático. Verificar cena funciona sem IA. Exportações incluem projeto JSON, GLB com animações suportadas e PNG; GLB não transporta o motor de jogo.

### 7.2 Experiências jogáveis

O modo jogo oferece primeira/terceira pessoa, caminhada, salto, corrida, voo permitido por cena, colisões aproximadas, portas, coleta, NPCs, diálogo, inimigos, armas, combate e objetivos. O HUD oferece estados de entrada, pausa, vitória/derrota, inventário, configurações e controles de teclado/mouse ou gamepad.

As regras suportam missões, coleta/extração, receitas, inventário por slots, bancada, equipamentos, consumíveis, construções colocáveis e armazenamento. Sandbox não deve impor campanha ou chefe obrigatório. HUD completo ou discreto depende da configuração da experiência.

Personagens incluem rig/skin procedural, animações, níveis de detalhe e recursos compartilhados. Áudio usa Web Audio; clima, água, vegetação, céu e pós-processamento dependem da qualidade configurada e da capacidade do navegador.

### 7.3 Mundos e persistência

Mundos usam terreno determinístico em blocos, LOD, workers, streaming e origem flutuante. Biomas, drenagem, lagos/rios, vegetação, locais e rotas compõem a exploração. Geração em duas escalas combina atlas e detalhamento local; mapa, viagem rápida e montaria dependem do mundo.

Documentos/progresso de mundos usam IndexedDB; rascunhos de cena usam armazenamento local do navegador. Falha ou quota de armazenamento deve ser indicada com orientação para exportar JSON. Recursos precisam ser liberados ao trocar de cena ou encerrar o viewport.

## 8. Provedores de IA

WebLLM executa no navegador e exige WebGPU. Endpoints compatíveis com OpenAI recebem pedidos diretamente do navegador, usando URL/chave/modelo e CORS configurados pelo usuário. Clientes locais Codex/Claude Code são executados pela API no computador do servidor, autenticados no cliente oficial e acessíveis apenas por loopback autorizado.

A ponte local recebe mensagens e devolve JSON, sem entregar credenciais da assinatura ao navegador nem executar ferramentas propostas pelo modelo. Testar conexão faz uma chamada real pequena. Disponibilidade, modelos e quotas pertencem ao provedor.

429 deve distinguir quota permanente, limite temporário e tamanho de requisição quando houver dados suficientes. Quota esgotada não inicia retentativas automáticas. Timeout e cancelamento encerram a ação; respostas tardias não substituem o provedor/candidato atual.

## 9. Operação e recursos

| Item | Comportamento padrão |
|---|---|
| Frontend / API | Loopback, portas 5173 / 8001 |
| Dados persistidos | `apps/api/data/cad.sqlite3` e `recipes.sqlite3` |
| Sessão X3D | TTL de 3.600 segundos de inatividade |
| Trabalho CAD | Um worker nativo por vez por fila/lock compartilhado |
| Worker CAD | 2.048 MB, 240 s, duas threads do kernel |
| Fila CAD | Até 60 s; caminho de lock compartilhável por configuração |
| Artefato geral / STL / ZIP de rascunho | 10 MB / 64 MB / 128 MB |
| Navegador Three.js / WebLLM | WebGL2 / WebGPU |

Variáveis efetivas e limites configuráveis estão em `apps/api/.env.example` e `config.py`. O sistema operacional encerra workers que excedam o limite aplicável; falhas não publicam revisão. Desconexão HTTP sinaliza cancelamento. Instâncias com locks distintos não compartilham serialização.

## 10. Critérios de aceitação

| Fluxo | Critério observável |
|---|---|
| Instalação | Clone com submódulo, dependências e `npm run dev` iniciam os serviços documentados |
| CAD paramétrico | Medidas válidas produzem sólido e STEP/STL; medidas incompatíveis geram diagnóstico |
| CAD livre | Proposta aprovada salva revisão; falha conserva revisão anterior e rascunho disponível |
| Conjunto mecânico | Vínculos/interferências são inspecionados nas poses suportadas antes da aprovação |
| Revisão concorrente | `expectedRevision` obsoleto gera conflito e não sobrescreve projeto |
| Recuperação | Retomada reutiliza componentes; rascunho exportado identifica omissões |
| X3D | Cena passa por validadores; manifesto exportado pode ser importado em outra sessão |
| Three.js | Exemplo pode ser editado, jogado e exportado sem API; documento autoral permanece preservado após jogo |
| Provedor | Testar e aplicar são separados; cancelamento/quota não aprovam resultado incompleto |
| Recursos | Testes CAD liberam processos entre casos; navegador usa um worker por executor |
| Documentação | Links locais válidos e comandos coerentes com scripts e configurações |

Lint, tipos, testes unitários, testes de domínio/API, build e Playwright sustentam esses critérios. Casos automatizados usam respostas programadas para não depender de uma assinatura real. Métricas em software WebGL não são garantias de desempenho em GPU real. Consulte [testes](docs/testing.md).

## 11. Limites do produto

CAD não é um projetista universal nem um sistema de certificação de fabricação: não inclui solver geral de mates, esboços com restrições, análise de cargas, desgaste, classes de tolerância ou colisão contínua. Verificação mecânica se limita ao perfil declarado e a poses amostradas.

X3D usa caixas para a política espacial e depende de internet na prévia HTML. Three.js usa colisões aproximadas, sem física geral de corpos rígidos, multiplayer ou exportação do jogo completo em GLB. Malhas/texturas grandes podem exceder a quota do navegador; mundos mantêm limites de nós e recursos. Qualidade de geração depende do modelo, do pedido e dos contratos suportados.

Mudanças de comportamento, contratos, persistência ou exportação devem atualizar este PRD e o guia técnico correspondente.
