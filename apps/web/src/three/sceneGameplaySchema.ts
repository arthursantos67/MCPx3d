const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength })
const integer = (minimum = 1) => ({ type: 'integer', minimum, maximum: 1000 })
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
export const itemStackSchema = object({ item: text(40), amount: integer() })
export const resourceSchema = object({ item: text(40), amount: integer(), health: integer() })
export const gameplaySchema = object({
  naturalResources: { type: 'boolean' },
  startingItems: { type: 'array', maxItems: 24, items: itemStackSchema },
  recipes: { type: 'array', maxItems: 24, items: object({ id: text(100), name: text(100), inputs: { type: 'array', minItems: 1, maxItems: 8, items: itemStackSchema }, output: itemStackSchema, healing: integer(0) }) },
  quests: { type: 'array', maxItems: 16, items: object({ id: text(100), title: text(160), giverId: { anyOf: [{ type: 'null' }, text(100)] },
    steps: { type: 'array', minItems: 1, maxItems: 8, items: object({ kind: { type: 'string', enum: ['gather', 'craft', 'talk', 'interact', 'visit', 'defeat'] }, target: text(100), count: integer(), label: text(160) }) },
    rewards: { type: 'array', maxItems: 8, items: itemStackSchema } }) },
})
export const GAMEPLAY_PROMPT = `JOGO FUNCIONAL: início seguro → tarefas → recompensa → conclusão conforme o gênero. Para missões: objective.type="quests", environment.gameplay={naturalResources,startingItems:[{item,amount}],recipes,quests}.
quests é uma sequência de {id,title,giverId:null ou ID com dialogue,steps:[{kind,target,count,label}],rewards:[{item,amount}]}. gather conta itens obtidos; craft conta fabricação (target=nome do item). talk/interact/visit exigem conversar/acionar/chegar ao nó target, count=1. defeat usa ID com count=1 ou * com count de inimigos. giverId exige aceitar por diálogo. Alvos, ingredientes e caminhos precisam existir e ser acessíveis; nunca tranque um item atrás da própria porta que exige esse item.
recipes=[{id,name,inputs:[{item,amount}],output:{item,amount},healing:0 ou vida ao consumir}]. B abre mochila/fabricação e gasta ingredientes. resource={item,amount,health} em nó/grupo permite quebrar com E a 3,5 m e remove colisão. naturalResources=true fornece Madeira/Pedra/Fibra/Cogumelo de árvores/rochas/arbustos/cogumelos existentes. Garanta quantidades suficientes; falas não implementam mecânicas.
Água permite nadar, mergulhar com C, subir com Espaço e tem fôlego; não é piso sólido. Comece em chão seco caminhável perto do primeiro objetivo. NPCs têm diálogos úteis/rotinas; animais e ameaças seguem o gênero.`
