# Capacidades CAD

CAD usa CadQuery/OpenCascade e contrato próprio, separado do X3D. O engine é instalado por padrão.

| Representação | Capacidades | Exportação |
|---|---|---|
| `CadProgramSpec` 3.0 | Um sólido conectado; base, união, corte e acabamento; blocos, cilindros, esferas, cones, perfis, tubos, toros, rasgos, furos, roscas, loft, prisma regular, engrenagem reta evolvente, cremalheira, curva de tubo, mola helicoidal e sweep segmentado; fillet/chamfer locais, shell e padrões | STEP e STL |
| `CadAssemblySpec` 4.0 | 2–8 componentes; posições/movimentos; grupos com fatores; contrato opcional de vínculos mecânicos, obrigatório por padrão na criação pela interface | STEP/STL completos e por componente |
| `CadPartSpec` 2.x | Placas, furos, suportes, perfis arredondados, flanges e ressaltos antigos | API e revisões mantidas; sem editor de moldes |

Programas aceitam até 32 operações, perfis com até 32 vértices e até 256 instâncias no total. Dimensões e STL usam milímetros. STEP conserva faces geométricas e sólidos; STL aproxima a superfície com triângulos e não contém histórico paramétrico.

## Verificações

Cada corpo deve ter volume positivo, topologia válida e um sólido conectado. STEP é reimportado e comparado por quantidade de sólidos, volumes e limites espaciais absolutos. Cada corpo de um conjunto deve corresponder ao componente original, além da comparação global.

Interferências são verificadas na posição atual e em 0%, 25%, 50%, 75% e 100% do curso. O backend rejeita interseções acima de 0,1 mm³, após filtro de caixas conservadoras para pares separados. Interseções inválidas ou volumes não finitos também são rejeitados. Isso não prova ausência de colisão entre amostras.

O diagnóstico retorna todas as colisões encontradas nessas poses. Reparos locais podem acumular progresso, mas cada avanço deve reduzir interferências sem acrescentar pares/poses em conflito nem piorar as restantes. Ciclos e tentativas são limitados; salvar continua exigindo ausência de interferências acima dos mesmos limites. A colocação de tampas considera a face real, a meia espessura e a folga, incluindo deslocamentos locais do corpo.

Salvar exige passar pelas verificações. Downloads de revisões usam o STEP salvo. Rascunhos têm exportação própria em ZIP, sem aprovação do conjunto: cada sólido disponível é verificado e o STEP é reimportado, inclusive quando existem colisões ou peças pendentes. Etapas impossíveis interrompem somente seu componente; o relatório indica o prefixo incluído e todas as omissões, sem modificar a receita original. Essa exportação não salva revisão nem comprova funcionamento. [cad-drafts.md](cad-drafts.md) descreve o contrato. STL deriva do mesmo STEP, com deflexão linear absoluta configurada de 0,1 mm e angular inicialmente de 0,1 rad, podendo aumentar até 0,5 rad em quatro tentativas limitadas para atender ao tamanho. Cabeçalho e contagem de triângulos também são conferidos. Uma edição inválida não sobrescreve uma revisão válida.

Conjuntos com `mechanics` também verificam ancoragem, fixações e recursos acoplados nas poses amostradas. São rejeitados apoios suspensos, furos desalinhados, furos declarados bloqueados, mancais sem material, engate insuficiente, carro sem duas guias separadas, porca capturada sem antirrotação e fuso sem batentes axiais nas poses verificadas. O movimento do par roscado precisa respeitar passo, entradas e sentido. Os detalhes, métodos suportados e requisitos de montagem estão em [mechanical-assemblies.md](mechanical-assemblies.md). Conjuntos antigos/geométricos recebem `mechanicalStatus=unverified`; ausência de colisão não é aprovação mecânica.

## Limites

Trabalho nativo da API usa processos descartáveis com teto padrão de 2.048 MB e prazo de 240 s. Operações acima desses limites terminam em erro técnico e conservam o rascunho. Cada programa admite até 1.024 dentes somando recursos/padrões.

Desconexão HTTP cancela a espera e sinaliza encerramento do worker (poll de 100 ms, seguido do encerramento da árvore). `CAD_WORKER_LOCK_PATH` serializa workers entre processos; checkouts separados precisam configurar o mesmo caminho absoluto. `CAD_WORKER_QUEUE_TIMEOUT_SECONDS` limita essa espera adicional. O bloqueio é liberado pelo sistema operacional mesmo se o dono cair.

`pipe_bend` varre uma seção circular/anular por arco XY de 1–270° com raio da linha central explícito. `helical_spring` varre arame circular por hélice centrada em Z, com 1–32 voltas inclusive fracionárias, dois sentidos e separação mínima de 0,1 mm entre espiras; orçamento de 64 voltas contando padrões. Não calcula rigidez nem deformação. `sweep` usa trajetória 3D aberta de 2–16 pontos e cantos em meia-esquadria; admite até 128 segmentos contando padrões. Splines arbitrárias não fazem parte desse recurso. Convenções e exemplos em [project-improvements-2026-10-08.md](project-improvements-2026-10-08.md).

Roscas têm perfil métrico truncado de 60° ou trapezoidal de 30°, mão direita/esquerda e 1–4 entradas. `pitch` é a distância entre filetes; avanço por volta é `pitch*starts`. Folga radial existe somente no corte interno, limitada a `min(2 mm,pitch/4)`. Comprimento admite 1–80 passos; cada programa admite até 160 passos contando repetições. Esses limites não garantem que toda combinação caiba no orçamento de artefatos/malha ou tenha bom desempenho. Diâmetro, perfil, passo, mão, entradas e fase global precisam coincidir num par acoplado.

Furos com acabamento começam no centro da entrada e seguem Z local negativo, ao contrário das primitivas centradas. Loft aceita 2–8 seções circulares/retangulares em Z crescente. Acabamentos selecionam direções, paralelismo ou arestas circulares. Fillet/chamfer aceitam `selectionBox` opcional: seleciona os centros das arestas dentro de `min`/`max` inclusivos, nas coordenadas da peça, após aplicar o seletor. Não seleciona a aresta inteira nem usa coordenadas globais da montagem. Shell remove as faces da direção escolhida e cria parede para dentro. Não existe seleção arbitrária por ID de uma aresta. Um acabamento impossível ou sem arestas na região é rejeitado, não omitido. Chanfros de entrada da rosca podem ser feitos por cortes de cone. Furos/roscas internas aceitam `termination=blind/through/unspecified`; profundidade é conservada e término explícito é verificado no sólido final. Cegos conservam `minBottomThickness` sob todo o diâmetro; passantes precisam de saída aberta.

Não há esboços com restrições, solver geral de mates, superfícies livres arbitrárias, classes ISO de ajuste, raízes arredondadas de rosca, roscas cônicas/de tubo, solver de engrenamento ou análise de esforços. Engrenagens retas externas evolventes e cremalheiras têm perfil e orçamento limitados, sem raiz trocoidal, filete ou deslocamento de perfil; detalhes em [audit-2026-10-08.md](audit-2026-10-08.md). O perfil mecânico verifica relações declaradas e evidências de geometria, sem simular forças ou comprovar a sequência de montagem/fabricação. Fixadores/adesivos declarados precisam ser instalados; sua resistência e dimensionamento completo não são verificados.

Propostas incluem dimensões e premissas e podem precisar de correção. Geometria válida e arquivo intercambiável não equivalem a projeto aprovado para fabricar.

STL usa limite independente de 64 MB e deflexão linear configurada absoluta de 0,1 mm. Começa em 0,1 rad e pode tentar 0,2/0,35/0,5 rad quando exceder o limite; cabeçalhos/relatório registram a malha aplicada. STEP não é alterado. ZIP de rascunho admite 128 MB e conserva STEP com diagnóstico se apenas o STL não couber. Presets M3–M10 de rebaixo cilíndrico incluem altura real da cabeça e folgas de projeto; não substituem especificação do fixador. [cad-generation-quality.md](cad-generation-quality.md) descreve essas escolhas.

## Exemplos e regressões

Os [exemplos CAD](../examples/cad/README.md) mantêm peças e verificadores FreeCAD de marcos anteriores. A suíte da API inclui prensa com corpos independentes, motor com carcaça/aletas/rotor e falhas de corte, união, repetição e interferência. O navegador verifica criação, exportação, movimento e recuperação com o motor real.

Verificações históricas independentes com FreeCAD estão no [relatório arquivado](archive/cad-readiness.md). Nesta reorganização foram executados testes CadQuery/STEP e navegador; a bateria histórica FreeCAD não foi repetida.
