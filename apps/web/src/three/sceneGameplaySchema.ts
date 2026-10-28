const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength })
const integer = (minimum = 1) => ({ type: 'integer', minimum, maximum: 1000 })
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
export const itemStackSchema = object({ item: text(40), amount: integer() })
export const resourceSchema = object({ item: text(40), amount: integer(), health: integer() })
export const gameplaySchema = object({
  playStyle: { type: 'string', enum: ['directed', 'sandbox'] },
  hud: { type: 'string', enum: ['full', 'minimal'] },
  items: { type: 'array', maxItems: 64, items: object({ name: text(40), description: text(300), equipment: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['none', 'sword', 'axe', 'blaster', 'bow', 'staff'] }] }, placeable: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['campfire', 'tent', 'chest', 'fence', 'torch'] }] }, healing: integer(0), harvest: integer() }) },
  naturalResources: { type: 'boolean' },
  startingItems: { type: 'array', maxItems: 24, items: itemStackSchema },
  recipes: { type: 'array', maxItems: 24, items: object({ id: text(100), name: text(100), inputs: { type: 'array', minItems: 1, maxItems: 8, items: itemStackSchema }, output: itemStackSchema, healing: integer(0) }) },
  quests: { type: 'array', maxItems: 16, items: object({ id: text(100), title: text(160), giverId: { anyOf: [{ type: 'null' }, text(100)] },
    steps: { type: 'array', minItems: 1, maxItems: 8, items: object({ kind: { type: 'string', enum: ['gather', 'craft', 'talk', 'interact', 'visit', 'defeat'] }, target: text(100), count: integer(), label: text(160) }) },
    rewards: { type: 'array', maxItems: 8, items: itemStackSchema } }) },
})
export const GAMEPLAY_PROMPT = `JOGO FUNCIONAL: use convenções do gênero com mecânicas reais; gameplay.hud="minimal" em puzzles, "full" com equipamentos/recursos. Não imponha inventário, chefe ou missões a todos os jogos.
Exploração livre: gameplay.playStyle="sandbox", objective explore, timeLimit=0, quests=[] e player.weapon="none". Descobertas, rumores e materiais distintos incentivam fabricar/construir sem final obrigatório. "directed" mantém conclusão quando pedida.
gameplay.recipes gasta inputs e produz output; B abre mochila. Toda saída tem uso em gameplay.items ou em outra receita. equipment/placeable são alternativas; arma muda modelo/ataque, axe harvest=3 extrai mais. Kits: E/clique coloca em solo seco, R gira, Delete recolhe; campfire cura perto, tent descansa/salva retorno, chest armazena, fence bloqueia, torch ilumina. Scroll ou 1–5 seleciona cinco atalhos; 1 sempre mãos vazias.
quests: giverId exige dialogue; gather/craft usam nome de item, talk/interact/visit ID e count=1; defeat ID count=1 ou * quantidade. Alvos/ingredientes precisam existir e ser acessíveis, nunca atrás da própria porta trancada. resource={item,amount,health}: E extrai a 3,5 m e remove colisão. naturalResources=true usa árvores/rochas/arbustos/cogumelos para Madeira/Pedra/Fibra/Cogumelo. Garanta quantidades. Água permite nadar, C mergulha, Espaço sobe, há fôlego. Spawn seco caminhável. Falas não substituem sistemas.`
