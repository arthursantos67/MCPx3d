# Correções de movimento e combate da 0.6

22 de outubro de 2026. Aplicadas ao runtime comum: cenas geradas por IA, exemplos e projetos importados usam os mesmos comportamentos, sem depender do nome da fase.

- O corpo do avatar acompanha a velocidade horizontal com giro gradual; a câmera mantém seu controle independente. Em combate e escalada, o corpo acompanha a direção de ação.
- O animador aceita escalada, alternando braços e pernas e suspendendo a IK de chão. Ao subir, o controlador procura um patamar à frente e valida apoio, altura e passagem da cápsula antes de sair da escada. Funciona com BVH estática e caixas móveis, inclusive escadas giradas; teto baixo impede a passagem.
- Ataques leves percorrem três poses, com entrada antecipada armazenada até a recuperação e janela de continuação de 1,1 s. O golpe pesado conserva sua antecipação própria. Os cinco tipos de rig continuam suportados.
- `sceneEquipment.ts` monta espada, blaster, arco, cajado e punho no avatar. Disparos usam a origem visual do equipamento e são apresentados já no quadro em que nascem, antes do próximo avanço da simulação; traços luminosos deixam tiros rápidos visíveis. Inimigos com ataque à distância aproveitam gemas/bocas/bocais existentes; quando não há origem reconhecida, recebem um blaster procedural. Equipamento criado no jogo é descartado ao sair.
- O dano do jogador depende da trajetória animada da lâmina/punho durante a fase de contato. Cada alvo recebe um dano por golpe. Caixas do corpo são separadas de acessórios e armas; obstáculos interrompem o contato. Inimigos corpo a corpo também precisam tocar a cápsula do jogador com suas partes ofensivas. O alcance da mira é 0,85 m para punhos e 1,6 m para espada; não concede dano sozinho.
- A colisão continua aproximada: caixas orientadas para as partes, cápsula para o jogador e margem de 3,5 cm para a lâmina. Não é uma colisão por triângulo da pele deformada. A interpolação entre duas poses evita perder alvos finos; teletransportes não varrem dano pelo mapa.

## Desempenho

A IK atualiza os caminhos das juntas consultadas, sem percorrer todos os descendentes em cada iteração. As estatísticas do renderer são publicadas até duas vezes por segundo; o HUD React é limitado a dez atualizações por segundo, com a camada de rótulos permanecendo por quadro. Qualidade automática começa em média no hardware e baixa no renderer por software. A resolução interna respeita limites de DPR de 1/1,5/2 para baixa/média/alta (automática usa 1,5).

`node scripts/benchmark-three-ik.mjs` compara a implementação do checkout com `HEAD`. Em uma execução local, a mediana de caminhada + IK dos pés + olhar + atualização das matrizes de um cavaleiro passou de **0,0402 ms para 0,0304 ms**: redução de **24,4%** nesse trecho. São nove lotes de 600 quadros após aquecimento, em Node, sem GPU. Isso não mede FPS ou elimina a necessidade de medir cenas reais no hardware do usuário. Não foi introduzido Assembly/WASM novo.

## Verificação

Regressões unitárias cobrem giro, escadas estáticas/móveis/giradas, teto baixo, combos, contato físico, obstáculos, origens dos disparos e descarte. O teste `three-motion.spec.ts` exerce disparos do jogador e inimigo nas duas câmeras e compara o JSON antes/depois do jogo. As capturas usam Chrome com SwiftShader; não representam desempenho em GPU física.

## Revisão de 23/10: empunhadura, escadas, rosto e marcha

Feita a partir de capturas de perto em WebGL por software (harness local que monta personagens isolados com os módulos reais) e coberta pelos testes `sceneHands`, `sceneClimb` e pelas suítes existentes. Vale para qualquer cena gerada, exemplo ou projeto importado.

- **Empunhadura procedural.** O punho da pele é girado em torno da palma até que o furo dos dedos coincida com o eixo do cabo do item que o personagem segura (espada, cajado, lança, porrete, machado; a alça do cesto é horizontal). A pele expõe um encaixe por mão (`CharacterSkin.grips`, no quadro do antebraço) e o item é reposicionado na renderização para o cabo passar pelo centro dos dedos; o documento não muda. Escudos continuam presos ao antebraço.
- **Armas do jogador.** `sceneEquipment.ts` deixou de usar caixas: espada com lâmina extrudada chanfrada, sulco, guarda curva, cabo com cordão e pomo; blaster com corpo arredondado, cano torneado e anéis de energia; arco com membros curvos, corda e flecha emplumada; cajado nodoso com garras e gema. Cada arma é montada no encaixe do punho, na orientação natural de transporte (espada à frente, cajado e arco em pé, coronha do blaster no punho); o avatar fecha a mão em volta desse eixo. A espada pré-fabricada dos NPCs ganhou guarda curva, cabo e pomo torneados e lâmina afilada.
- **Cavaleiro.** Braçadeiras e grevas passam a ser pele contínua com material de aço até a manopla; antes, a peça rígida escondia o pulso e a mão parecia solta.
- **Escadas e torres.** A torre de vigia tinha 1,35 m livres sob o telhado — o jogador não cabia e travava no topo. O telhado subiu para deixar 2,25 m; projetos salvos recebem a correção ao abrir (`migrateTowerHeadroom`, só telhado, pilares e sino sem edição). O alçapão da torre circular do castelo era menor que a cápsula do jogador; foi ampliado e centrado na posição de quem sobe. A saída da escada procura o patamar para onde o jogador olha, através da escada e de costas para ela (alçapões), em três distâncias, e só perto do topo dos degraus.
- **Escalada com mãos e pés nos degraus.** `sceneClimb.ts` lê os degraus do colisor, alterna mão e pé opostos de degrau em degrau com um pequeno arco de soltura e resolve braços e pernas com IK de dois ossos (o solver de pernas ganhou o sentido de dobra para cotovelos). No jogo, o corpo vira de frente para a escada e encosta nela; a cápsula mantém sua posição de colisão.
- **Marcha.** Caminhada e corrida bípedes balançam mais o braço para a frente que para trás, com cotovelo dobrado (~90° na corrida), contra-rotação de tronco e cabeça, braços cruzando levemente à frente do corpo e flexão do joelho de apoio no impacto.
- **Rosto.** Personagens vindos do documento tinham olhos pretos: todo material validado traz `emissive`, e isso ativava o modo de olhos luminosos com cor preta. Agora só olhos com emissão real brilham. O olho ganhou material próprio (esclera, íris com anel escuro e pupila com bordas suaves, verniz) e íris proporcional à abertura. A barba segue a linha da costeleta ao canto da boca, deixando as maçãs do rosto livres.

Limites: a borda da barba e dos lábios ainda segue a malha (serrilhada de perto); a escalada procedural pressupõe degraus horizontais (escadas sem degraus usam a pose do animador); a orientação da arma durante a mira continua definida pela própria arma, sem girar o punho.
