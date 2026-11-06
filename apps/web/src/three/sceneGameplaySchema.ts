const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength })
const integer = (minimum = 1) => ({ type: 'integer', minimum, maximum: 1000 })
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
export const itemStackSchema = object({ item: text(40), amount: integer() })
const nullable=(value:unknown)=>({anyOf:[{type:'null'},value]})
export const resourceSchema = object({ item: text(40), amount: integer(), health: integer(),kind:nullable({type:'string',enum:['wood','stone','ore','plant','food','custom']}),method:nullable({type:'string',enum:['strike','gather']}) })
export const gameplaySchema = object({
  playStyle: { type: 'string', enum: ['directed', 'sandbox'] },
  hud: { type: 'string', enum: ['full', 'minimal'] },
  items: { type: 'array', maxItems: 64, items: object({ name: text(40), description: text(300), equipment: nullable({ type: 'string', enum: ['none', 'sword', 'axe','pickaxe', 'blaster', 'bow', 'staff'] }), placeable: nullable({ type: 'string', enum: ['campfire', 'tent', 'chest', 'fence', 'torch','workbench'] }), healing: integer(0), harvest: integer(),damage:nullable(integer()),station:nullable(text(60)) }) },
  stations:{type:'array',maxItems:32,items:object({id:text(60),nodeId:text(100)})},
  naturalResources: { type: 'boolean' },
  startingItems: { type: 'array', maxItems: 24, items: itemStackSchema },
  recipes: { type: 'array', maxItems: 24, items: object({ id: text(100), name: text(100), inputs: { type: 'array', minItems: 1, maxItems: 8, items: itemStackSchema }, output: itemStackSchema, healing: integer(0),station:nullable(text(60)) }) },
  quests: { type: 'array', maxItems: 16, items: object({ id: text(100), title: text(160), giverId: { anyOf: [{ type: 'null' }, text(100)] },
    steps: { type: 'array', minItems: 1, maxItems: 8, items: object({ kind: { type: 'string', enum: ['gather', 'craft', 'talk', 'interact', 'visit', 'defeat'] }, target: text(100), count: integer(), label: text(160) }) },
    rewards: { type: 'array', maxItems: 8, items: itemStackSchema } }) },
})
export const GAMEPLAY_PROMPT = `JOGO FUNCIONAL: mecânicas reais do gênero. hud="minimal" por padrão: tela limpa, sem instruções repetidas, resistência de recursos ou nomes/barras sobre objetos. hud="full" somente se o usuário pedir; controles ficam na ajuda. Não imponha inventário/chefe/missões. Exploração: playStyle="sandbox", objective explore, timeLimit=0, quests=[], player.weapon="none"; "directed" conclui quando pedido.
recipes gasta inputs e produz output útil em items/outra receita. B abre mochila; equipment/placeable são alternativas. axe corta wood; pickaxe minera stone/ore; espada serve ao combate. harvest é força de extração por material; damage é dano de combate independente. Adapte valores ao tema: sabre de luz supera pistola básica por golpe, compensando alcance/cadência.
Receita manual: station=null. Avançada: station="workbench"/"forge" etc. Forneça receita manual da construção placeable="workbench", item.station com esse id, ou stations=[{id,nodeId}] de estação acessível real. Nunca exija bancada para criar a própria bancada. E abre estação; fabricar exige proximidade de 3 m. Modelo/nome/material acompanham o tema. Kits: E/clique coloca em solo seco; R gira; Delete recolhe. campfire cura/cozinha, tent descansa/salva retorno, chest armazena, fence bloqueia, torch ilumina. Scroll/1–5 seleciona atalhos; 1 mãos vazias.
quests: giverId exige dialogue. gather/craft: item; talk/interact/visit: ID,count=1; defeat: ID,count=1 ou * quantidade. Fontes acessíveis, nunca atrás da própria fechadura. resource={item,amount,health,kind,method}; kind wood/stone/ore/plant/food/custom. strike: golpear por clique; gather: recolher plantas com E. naturalResources=true oferece Madeira/Pedra/Fibra/Cogumelo. Garanta quantidades e fontes iniciais.
LÍQUIDOS: node.liquid={kind,viscosity,damage}; water 1/0, lava 6/30, acid 1.5/12. Lava é densa/lenta/emissiva e dá dano por contato; água permite nadar, C mergulha, Espaço sobe, submersão gasta fôlego. Use leitos/bacias reais: roads texture="water" escava rios locais; relevo grande usa gerador de mundo. Nada de planos suspensos ou água metálica. Spawn seco caminhável. Falas não substituem sistemas.`
