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
