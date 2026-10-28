import type { beardStyles, characterAges, characterBuilds, characterStyles, hairStyles } from './sceneCharacterArchetype.ts'
import type { ambiencePresets, emitterPresets, faunaDensities, grassDensities, npcReactions, RoutineActivity, attackStyles, avatarKinds, behaviorTypes, gradePresets, interactionActions, musicPresets, objectiveTypes, PowerKind, SoundPreset, weaponKinds, weatherKinds } from './sceneDocument.ts'

export const actionOptionLabels: Record<typeof interactionActions[number], string> = { toggleAnimation: 'Alternar animação (portas, mecanismos)', toggleVisibility: 'Mostrar/ocultar (luzes, passagens)',
  collect: 'Coletar item', message: 'Mostrar mensagem', heal: 'Curar o jogador', powerup: 'Conceder poder temporário', dialogue: 'Diálogo (linhas separadas por |)' }
export const behaviorLabels: Record<typeof behaviorTypes[number], string> = { enemy: 'Inimigo', hazard: 'Perigo (fere ao tocar)', checkpoint: 'Ponto de controle', goal: 'Chegada da fase',
  climbable: 'Escalável (escada)', npc: 'Personagem amigável (NPC)', launcher: 'Plataforma de salto' }
export const attackLabels: Record<typeof attackStyles[number], string> = { touch: 'Contato', melee: 'Corpo a corpo', ranged: 'À distância (projéteis)', charge: 'Investida' }
export const objectiveLabels: Record<typeof objectiveTypes[number], string> = { quests: 'Concluir missões', explore: 'Explorar', collectAll: 'Coletar todos os itens', reachGoal: 'Chegar ao destino', defeatEnemies: 'Derrotar os inimigos', survive: 'Sobreviver pelo tempo limite' }
export const soundLabels: Record<SoundPreset, string> = { fire: 'Fogo crepitando', water: 'Água corrente', waves: 'Ondas', wind: 'Vento', machine: 'Máquina', magic: 'Energia mágica', birds: 'Pássaros',
  insects: 'Insetos', drip: 'Gotejamento', engine: 'Motor', chimes: 'Sinos de vento', alarm: 'Alarme', portal: 'Portal', crowd: 'Multidão' }
export const ambienceLabels: Record<typeof ambiencePresets[number], string> = { auto: 'Automática pelo cenário', none: 'Sem ambiência', forest: 'Floresta', meadow: 'Campo', beach: 'Praia', desert: 'Deserto',
  snow: 'Neve', swamp: 'Pântano', cave: 'Caverna', city: 'Cidade', night: 'Noite', space: 'Espaço', underwater: 'Subaquático', volcanic: 'Vulcânico', scifi: 'Ficção científica', dungeon: 'Masmorra', rain: 'Chuva', wind: 'Vento' }
export const musicLabels: Record<typeof musicPresets[number], string> = { auto: 'Automática pelo jogo', none: 'Sem música', calm: 'Calma', adventure: 'Aventura', mystery: 'Mistério', tension: 'Tensão',
  combat: 'Combate', space: 'Espacial', festive: 'Festiva', spooky: 'Assombrada', heroic: 'Heroica' }
export const weatherLabels: Record<typeof weatherKinds[number], string> = { none: 'Sem clima', rain: 'Chuva', snow: 'Neve', embers: 'Brasas', fireflies: 'Vaga-lumes', dust: 'Poeira', bubbles: 'Bolhas', leaves: 'Folhas ao vento', ash: 'Cinzas' }
export const gradeLabels: Record<typeof gradePresets[number], string> = { none: 'Neutra', warm: 'Quente (golden hour)', cool: 'Fria (luar)', cinematic: 'Cinematográfica', vivid: 'Vívida', noir: 'Noir', dreamy: 'Onírica', retro: 'Filme retrô' }
export const weaponLabels: Record<typeof weaponKinds[number], string> = { none: 'Mãos (golpe com E)', sword: 'Espada', blaster: 'Blaster', bow: 'Arco', staff: 'Cajado mágico' }
export const avatarLabels: Record<typeof avatarKinds[number], string> = { explorer: 'Explorador', knight: 'Cavaleiro', wizard: 'Mago', astronaut: 'Astronauta', robot: 'Robô' }
export const powerLabels: Record<PowerKind, string> = { speed: 'Velocidade', jump: 'Super pulo', shield: 'Escudo', strength: 'Força' }
export const routineLabels: Record<RoutineActivity, string> = { wander: 'Passear', work: 'Trabalhar no local', sit: 'Sentar', chat: 'Conversar em grupo', patrol: 'Patrulhar até o local', guard: 'Montar guarda', sleep: 'Dormir', perform: 'Tocar/dançar' }
export const reactionLabels: Record<typeof npcReactions[number], string> = { greet: 'Cumprimenta o jogador', ignore: 'Ignora o jogador', flee: 'Foge do perigo', alert: 'Alerta os guardas' }
export const emitterLabels: Record<typeof emitterPresets[number], string> = { fire: 'Fogo', smoke: 'Fumaça', sparks: 'Faíscas', magic: 'Magia', steam: 'Vapor', fountain: 'Jato de água', leaves: 'Folhas caindo', dust: 'Poeira', embers: 'Brasas' }
export const grassLabels: Record<typeof grassDensities[number], string> = { auto: 'Automática pelo terreno', none: 'Sem grama', dense: 'Densa' }
export const faunaLabels: Record<typeof faunaDensities[number], string> = { auto: 'Automática pelo bioma', none: 'Sem fauna', rich: 'Abundante' }
export const ageLabels: Record<typeof characterAges[number], string> = { child: 'Criança', young: 'Jovem', adult: 'Adulto', elder: 'Idoso' }
export const buildLabels: Record<typeof characterBuilds[number], string> = { slim: 'Magro', average: 'Médio', athletic: 'Atlético', heavy: 'Robusto' }
export const styleLabels: Record<typeof characterStyles[number], string> = { stylized: 'Estilizado', realistic: 'Realista' }
export const hairLabels: Record<typeof hairStyles[number], string> = { auto: 'Pela semente', bald: 'Careca', short: 'Curto', long: 'Longo', bun: 'Coque', ponytail: 'Rabo de cavalo', braids: 'Tranças', mohawk: 'Moicano' }
export const beardLabels: Record<typeof beardStyles[number], string> = { auto: 'Pela semente', none: 'Sem barba', short: 'Curta', long: 'Longa' }
