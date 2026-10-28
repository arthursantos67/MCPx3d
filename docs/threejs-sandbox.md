# Exploração, fabricação e padrões por gênero — 2026-10-28

Aurora é agora um sandbox: o jogador escolhe explorar, fabricar ferramentas, cuidar de um acampamento ou investigar as ruínas. Não há cadeia obrigatória de quatro missões, chefe final, contagem regressiva ou vitória automática por recolher o fragmento. As aventuras dirigidas continuam disponíveis no contrato e nos testes.

## Jogar

Abra **Projeto → Terras de Aurora 4 km → Jogar**. O nascimento continua em terreno seco no Posto do Lírio. Mara oferece rumores opcionais. O posto dos resinadores, a pedreira e o jardim acrescentam três lugares aos três anteriores; resina e cobre têm fontes próprias, e o fragmento antigo serve para fabricar uma luz. O mapa só revela os lugares descobertos; a bússola não denuncia todos os inimigos/NPCs distantes em sandbox.

| Controle | Ação |
|---|---|
| WASD / mouse | Andar / olhar; arrastar funciona sem captura do mouse |
| B / Esc | Abrir mochila / fechar mochila |
| Scroll / 1–5 | Selecionar entre cinco slots fixos; **1 sempre mãos vazias** |
| E / clique | Interagir, extrair, atacar ou usar o item selecionado |
| R | Girar a prévia de construção em 45° |
| Delete | Recolher uma construção apontada; baús precisam estar vazios |
| Espaço / C na água | Subir / mergulhar; ficar submerso consome fôlego |

A mochila mostra materiais, descrições, categorias de receitas e os quatro atalhos configuráveis. “Combinar” filtra receitas pelos materiais selecionados; não inventa receitas nem bloqueia outras por missão. Fabricar exige e consome ingredientes atomicamente. Equipamentos, consumíveis e kits fabricados entram num slot disponível. É possível reatribuir slots na mochila. Uma arma guardada some da mão; espada e machado ficam abaixados em repouso.

Aurora tem onze receitas: machado de pedra, arco, espada de cobre, bandagem, caldo, fogueira, abrigo, baú, cerca, tocha e luz dos antigos. O machado extrai com força 3, contra 1 das mãos. Arco e espada usam os ataques do runtime; ainda não existe consumo de munição.

Kits selecionados mostram uma prévia verde/vermelha. O apoio precisa existir, estar seco, ter desnível de até 45 cm na área amostrada e não sobrepor cenário/plantas/outras construções. Colocar consome uma unidade somente após validar o local. Há limite de 64 construções por partida. Fogueiras recuperam vida por proximidade; abrigos permitem descansar, recuperar vida/estamina e definir retorno, com intervalo de 30 s e sem ameaças próximas; baús permitem guardar/retirar unidades; cercas participam da colisão de jogador, inimigos e projéteis; tochas e fogueiras usam duas luzes sem sombra que acompanham os focos construídos mais próximos.

O progresso dos mundos salva barra, slot selecionado, inventário, construções, conteúdo dos baús, extração, mecanismos, posição, mapa e ponto de retorno no IndexedDB. Reiniciar começa uma partida limpa. Cenas 1.x mantêm essas mecânicas durante a sessão; o salvamento durável de progresso continua pertencendo aos mundos. O preset antigo de Aurora é reconhecido por nome, seed e quatro IDs de missão: atualiza regras e falas e adiciona os novos locais, conservando nós e transformações editados. Mundos personalizados não são convertidos por palavra-chave.

## Contrato e agente

`environment.gameplay` ganha campos opcionais compatíveis com documentos anteriores:

- `playStyle: "directed" | "sandbox"`: sandbox usa exploração sem conclusão automática; aventuras dirigidas mantêm missões, ondas e chegada quando solicitadas.
- `hud: "full" | "minimal"`: minimal oculta painel, bússola e barra, suprime inventário vazio e mostra vida somente quando necessária. Tempo continua aparecendo se houver limite; pausa, feedback e controles contextuais permanecem disponíveis.
- `items`: catálogo de `{name, description, equipment?, placeable?, healing?, harvest?}`. `equipment` aceita as armas do runtime, incluindo `axe`; `placeable` aceita `campfire`, `tent`, `chest`, `fence` e `torch`. Um item não pode ser equipamento e construção simultaneamente.

`sceneLoadout.ts` resolve propriedade/seleção/equipamento; `sceneConstruction.ts` define geometria e apoio; o viewport executa uso, colisão, descarte e restauração. `sceneProgress.ts` valida dados restaurados e limita construções/conteúdo. `sceneGameplayAudit.ts` rejeita ingredientes sem fonte e saídas de sandbox sem uso, inclusive em receitas sem missão.

As instruções compartilhadas do planejador, construtor, editor e geração de mundos exigem escolher convenções adequadas ao gênero e executar as mecânicas descritas. `sceneDirection.ts` distingue sobrevivência livre de hordas/arenas cronometradas e revisa a intenção. Plataformas pedem saltos possíveis e recuperação; puzzles pedem ação/efeito e interface discreta; combate pede alcance, defesa e feedback; sandbox pede usos reais para recursos e descobertas opcionais. Inventário, combate e condição de vitória não são requisitos universais. O limite de tamanho do prompt permanece em 17 mil caracteres.

A referência de intenção é explorar/construir/sobreviver, como descrito na [apresentação oficial de The Forest](https://endnightgames.com/games/the-forest?page=1). Isso não implica reproduzir todo o seu conteúdo. A separação de ações conforme contexto segue também a [orientação oficial de conjuntos de ações do Steam Input](https://partner.steamgames.com/doc/features/steam_controller/action_set_layers?l=english).

## Água e renderização

O passe macro preserva níveis dos lagos quando escava rios sobrepostos. Água de rio é reconciliada com o relevo final e limitada a 2,5 m acima do leito nos pontos do grid. A malha recorta margens secas e omite transições artificiais abruptas; a consulta da natação usa a mesma máscara de triângulos e profundidades interpoladas. Isso corrige o teto de água visto perto do posto; a resolução hidrológica continua em 8 m, sem cachoeiras ou margens de alta resolução.

Luzes apagadas pelo ciclo diário alocam uma vez a textura de sombra reservada: sem isso, `sampler2DShadow` recebia uma textura comum e a GPU rejeitava o chão/personagens. O atlas da vegetação agora aplica viewport/scissor reais por vista e enquadra a planta inteira; alterar apenas o objeto `WebGLRenderTarget` deixava cartões com recortes errados. A cor da grama deixa de sofrer uma segunda conversão sRGB.

## Verificação e limites

O teste de navegador de sandbox extrai pedra, fabrica/equipa machado, alterna mãos vazias por teclas e scroll, gira/coloca baú, transfere materiais e recolhe a construção. A regressão de Aurora verifica recuperação de edição local, terreno, mapa e montaria; outra conserva coleta, portas e atalhos das cenas 1.x. Testes de lógica cobrem propriedade dos slots, receitas, persistência validada, apoio, água e direção do agente.

Cinco casos distintos de navegador passaram em execuções focadas: sandbox completo, HUD discreto, coleta/portas/atalhos legados, combate/reinício e Aurora com restauração/mapa/montaria. A suíte inteira de navegador não foi repetida nesta alteração. Python não foi alterado. No CI anterior (`55dc314`), TypeScript e domínio Python passaram; o runner da API recebeu sinal de desligamento durante pytest, e o navegador terminou com 70 casos aprovados e 13 falhas por prazo. Isso não é aprovação do CI completo.

A verificação final passou typecheck, lint, build e **906 testes**: 449 web, 363 agente, 82 domínio TS e 12 golden. O caso adicional verifica que atlas, detalhamento local e composição conservam sandbox/HUD e não inventam missões para um puzzle ou mundo de exploração livre.

Inspeção visual em produção com **GT 710, ANGLE/D3D11, 1500×850**, olhando norte/sul e caminhando: terreno visível, mãos vazias, grama verde e água sem o teto anterior; nenhum erro WebGL capturado. Leitura pontual do renderer: **1.269.812 triângulos, 193 draw calls, 12 FPS**. Essa inspeção coincidiu com outras verificações locais: não é benchmark isolado nem aprovação do gate. Os limites da 0.7 permanecem inalterados.

Não medidos nesta entrega: provedor real, outras GPUs, balanceamento de longo prazo, travessia completa e gate comparativo completo. Permanecem fora do escopo implementado: escavação do terreno, construção estrutural modular, fome/sede, durabilidade, munição, novos tipos de inimigos e polimento artístico equivalente a um jogo comercial. Construções são kits predefinidos, com colisão por caixa; não há física de derrubada/queda de árvores.
