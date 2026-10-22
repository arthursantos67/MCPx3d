import { DEFAULT_MOTION, hasSurface, subtreeIds, type SceneMotion, type ThreeSceneDocument, type weaponKinds, type weatherKinds, type gradePresets, type musicPresets } from './sceneDocument.ts'
import { buildingPlan } from './sceneArchitecture.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { Box3, Vector3 } from 'three'

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export type SceneTopology = 'landscape' | 'interior' | 'platforms' | 'arena' | 'space' | 'open'
/** Topologies built from floors, decks or free flight: no natural ground, biome, residential catalogue or road network by default. */
export const structuredTopologies: readonly SceneTopology[] = ['interior', 'platforms', 'arena', 'space']
export const isStructuredTopology = (topology: SceneTopology) => structuredTopologies.includes(topology)
const outerSpacePattern = /\b(no espaco|pelo espaco|espaco sideral|espaco profundo|sideral|cosmos|cosmic\w*|galaxias?|galaxy|galaxies|planetas?|planets?|asteroides?|asteroids?|cinturao de asteroides|asteroid belt|sistema solar|solar system|nebulosas?|nebulae?|nebula|orbita|orbitando|orbiting|orbit|outer space|deep space|in space|satelites?|satellites?|buraco negro|black hole|via lactea|milky way|estrelas cadentes|frota estelar|starfleet|starship)\b/
const planetSurfacePattern = /\b(superficie|solo|na lua|da lua|lunar|em marte|de marte|marciano|martian|on the moon|moon surface|on mars|mars surface|planeta alienigena|alien planet|exoplaneta|exoplanet|crateras?|craters?|colonia|colony|base lunar|moon base)\b/
const interiorWords = /\b(interior|interiores|dentro|corredores?|salas?|rooms?|corridors?|inside|cabine|cockpit|deck|hangar|compartimentos?)\b/
export function inferSceneAction(request: string, hasCreated: boolean): 'create' | 'edit' | 'repair' {
  const text = normalize(request.trim())
  if (/^(corrija|conserte|repare|resolva|corrigir|fix|repair)\b/.test(text) && /\b(colis|sobrepos|erros?|problemas?|cena|overlap)/.test(text)) return 'repair'
  if (/\b(nova cena|novo mundo|outra cena|outra ilha|do zero|new scene|new world|start over)\b/.test(text)) return 'create'
  if (/^(adicione|acrescente|coloque|inclua|mude|modifique|melhore|remova|retire|tire|exclua|deixe|troque|ajuste|aumente|diminua|add|remove|change|update|make it)\b/.test(text)) return 'edit'
  if (/\b(na cena atual|nesta cena|nessa cena|neste mundo)\b/.test(text)) return 'edit'
  if (sceneIntent(request).world && /^(crie|gere|construa|faca|quero|uma?|create|generate|build|a|an)\b/.test(text)) return 'create'
  return hasCreated ? 'edit' : 'create'
}
type Weapon = typeof weaponKinds[number]
const fantasyPattern=/\b(medieva\w*|castelos?|castle|reinos?|kingdom|fantasia|fantasy|elf\w*|elfos?|floresta|bosque|forest|woods|cavaleir\w*|knights?|goblins?|orcs?|dragao|dragons?|piratas?|pirates?)\b/
/** Weapon named by the request, or a genre fallback when it only asks to shoot. */
function requestedWeapon(text: string, shooter: boolean, scienceFiction: boolean): Exclude<Weapon, 'none'> | null {
  if (/\b(arco e flechas?|flechas?|arqueir\w*|bows?|arrows?|archer\w*)\b/.test(text)) return 'bow'
  if (/\b(cajados?|staffs?|varinhas?|wands?|feiticos?|spells?|bolas? de fogo|fireballs?|lancar magias|lanca magias)\b/.test(text)) return 'staff'
  if (/\b(blasters?|pistolas?|rifles?|armas? de fogo|armas? laser|pistola laser|laser guns?|guns?|fps|revolver\w*)\b/.test(text)) return 'blaster'
  if (/\b(espadas?|swords?|sabres?|katanas?|esgrima)\b/.test(text)) return 'sword'
  return shooter ? (!scienceFiction && fantasyPattern.test(text) ? 'bow' : 'blaster') : null
}
export function sceneIntent(request: string) {
  const text = normalize(request)
  const scienceFiction=/\b(sci.?fi|ficcao cientifica|espacial|espaciais|space|spaceship|orbital|futurist\w*|cyberpunk|nave|naves|laboratorio|laboratorios|laboratory|laboratories)\b/.test(text)
  const interior=/\b(interior|interiores|interno|interna|indoor|interior|corredores?|corridors?|salas?|rooms?|estacao espacial|space station|nave|spaceship|laboratorio|laboratory|masmorra|dungeon|subterrane\w*|criptas?|crypts?|catacumbas?|catacombs?|calabouco|bunker)\b/.test(text)
  const platforms=/\b(plataformas?|platforms?|platformer|parkour|saltos?|jumping|pulos?)\b/.test(text)
  const arena=/\b(arenas?|combat arenas?|campo de batalha|battlefield|coliseu|colosseum|coliseum|gladiador\w*|gladiators?)\b/.test(text)
  const planetSurface=planetSurfacePattern.test(text)
  const outerSpace=outerSpacePattern.test(text) && !planetSurface
  const landscape=(planetSurface || /\b(floresta|florestas|bosque|mata|selva|jungle|rainforest|ilha|ilhas|vale|montanhas?|deserto|dunas?|oasis|paisagem|fazenda|campo|pradaria|savana|savanna|canyon|canion|desfiladeiro|praia|praias|beach|litoral|coast|neve|nevad\w*|inverno|winter|snow\w*|tundra|artic\w*|arctic|glacial|geleira|glacier|pantano|swamp|brejo|marsh|vulcao|volcan\w*|lava|lagos?|lakes?|rios?|rivers?|cachoeiras?|waterfalls?|recife|reef|oceano|ocean|fundo do mar|seabed|underwater|subaquatic\w*|submarin\w*|forest|woods|island|landscape|mountains?|desert|farm|meadow|countryside|cemiterios?|graveyards?|cemetery|faroeste|velho oeste|wild west|terra devastada|wasteland|pre.?histori\w*|prehistoric|dinossauros?|dinosaurs?|jardim japones|japanese garden|enseada|cove)\b/.test(text)) && !/\b(sem terreno|sem paisagem|no terrain|without landscape)\b/.test(text)
  const enemyProhibition=/\b(?:sem (?:nenhum )?inimigos?|no enemies|without enemies|nao (?:quero|inclua|adicione|crie) inimigos|nao (?:deve|pode) (?:ter|haver) inimigos)\b/g
  const forbidsEnemies=[...text.matchAll(enemyProhibition)].some(match=>!/^\s+(?:(?:ou|e|or|and)\s+(?:perigos|hazards)\s+)?(?:no|na|nos|nas|junto|perto|proxim|near|around|at the|in the)\b/.test(text.slice(match.index!+match[0].length)))
  const peaceful=forbidsEnemies || /\b(sem (?:combate|batalhas?|violencia)|without combat|peaceful|pacific[oa]|exploracao tranquila)\b/.test(text)
  const enemies=/\b(inimigos?|enemies|enemy|adversarios?|monstros?|monsters?|drones? hostis|hostile drones?)\b/.test(text.replace(enemyProhibition,'')) && !peaceful
  const shooter=!peaceful && /\b(tiros?|atirar|atire|atirando|disparos?|disparar|dispare|shooter|fps|tiroteio|blasters?|pistolas?|rifles?|armas? de fogo|armas? laser|guns?|shoot\w*|arco e flechas?|flechas?|arqueir\w*|bows?|arrows?|archer\w*)\b/.test(text)
  const survival=!peaceful && /\b(sobreviva|sobreviver|sobrevivencia|survival|survive|hordas?|hordes?|ondas de (?:inimigos|zumbis|monstros|robos)|enemy waves|waves of enemies|modo horda)\b/.test(text)
  const boss=!peaceful && /\b(chefao|chefoes|chefe final|chefe da (?:fase|masmorra)|(?:batalha|luta|combate) (?:contra|com) (?:o |um )?chefe|boss\w*|dragao|dragoes|dragons?|batalha final|final battle)\b/.test(text)
  const combat=!peaceful && (enemies || shooter || survival || boss || /\b(combate|batalhas?|combat|battles?|shooter|fps|tiroteio|duelos?|lutar|enfrentar|enfrente|fight\w*)\b/.test(text))
  const stealth=/\b(furtiv\w*|stealth|infiltra\w*|sorrateir\w*|heist|assalto|roubo|roubar|cofre|vault|espionagem|spy)\b/.test(text)
  const race=/\b(contra o relogio|contrarrelogio|time.?trial|cronometr\w*|speedrun|corridas? (?:contra|cronometrad\w*|de obstaculos|de checkpoints|ate)|racing game|race against|time attack)\b/.test(text)
  const settlement=/\b(vila|vilarejo|aldeia|cidadezinha|povoado|mercado|feira|bazar|porto|village|town|market|harbou?r)\b/.test(text)
  const npcs=/\b(npcs?|aldeoes|aldeao|moradores|habitantes|comerciantes?|mercadores?|vendedores?|ferreiros?|taverneir\w*|estalajadeir\w*|camponeses|cidadaos|villagers?|merchants?|townsfolk|inhabitants|personagens|dialogos?|conversar|converse|falar com|missao|missoes|quests?|rpg)\b/.test(text)
    || (settlement && /\b(mercado|feira|bazar|festival|festa|movimentad\w*|habitad\w*|animad[ao]|market|bustling|lively|crowded)\b/.test(text))
  const keys=/\b(chaves?|keys?|trancad\w*|locked|fechaduras?|cadeados?)\b/.test(text)
  const launchers=/\b(jump ?pads?|trampolins?|trampolines?|plataformas? de salto|lancadores?|launch ?pads?|molas?|springs?)\b/.test(text)
  const puzzle=/\b(puzzles?|quebra.cabecas?|enigmas?|interruptores?|switches?|alavancas?|levers?)\b/.test(text)
  const noHousing=/\b(sem (?:casas|moradias|habitacoes)|no houses|without houses|nao (?:quero|adicione|inclua|crie) (?:casas|moradias|habitacoes))\b/.test(text)
  const housing=!noHousing && (/\b(casas?|sobrados?|moradias?|residencias?|house|houses|townhouses?|chales?|cottages?)\b/.test(text) || (!scienceFiction && !interior && /\b(vila|vilarejo|village)\b/.test(text)))
  const enclosedTheme=/\b(estacao espacial|space station|nave|spaceship|masmorras?|dungeons?|laboratorios?|laboratory|subterrane\w*|criptas?|crypts?|catacumbas?|catacombs?|calabouco|bunker)\b/.test(text)
  const outdoor=landscape || (housing && !scienceFiction && /\b(vila|vilarejo|village)\b/.test(text))
  const spaceFlight=(outerSpace || (/\b(estacao espacial|space station|naves?|spaceships?)\b/.test(text) && /\b(no espaco|in space|orbita\w*|orbit\w*|planetas?|planets?|asteroides?|asteroids?|frota|fleet|batalha espacial|space battle)\b/.test(text))) && !interiorWords.test(text)
  const topology:SceneTopology=platforms?'platforms':arena?'arena':spaceFlight?'space':enclosedTheme && !planetSurface?'interior':outdoor?'landscape':interior?'interior':'open'
  return {
    world: topology==='space' || landscape || /\b(vila|vilarejo|cidade|metropole|metropolis|bairro|centro urbano|downtown|ruas|ruinas|templo|castelo|fazenda|acampamento|camping|caverna|cavernas|cave|caves|mina|mine|village|city|town|world|mundo|fase|mapa|cenario|arenas?|masmorras?|dungeons?|estacao espacial|space station|nave|spaceship|laboratorios?|laborator\w*|complexo industrial|industrial complex|plataformas|platformer|parkour|parque|park|porto|harbor|aeroporto|airport|reinos?|kingdom|aldeia|mercado|feira|cemiterios?|graveyards?|cemetery|criptas?|crypts?|catacumbas?|enseada|cove|faroeste|velho oeste|wild west|coliseu|colosseum|coliseum|terra devastada|wasteland|pos.?apocalipt\w*|post.?apocalyptic|bunker|base (?:lunar|militar|secreta|cientifica))\b/.test(text),
    landscape: outdoor && (!enclosedTheme || planetSurface),
    game: combat || puzzle || platforms || stealth || race || /\b(rpg|missao|missoes|quests?|npcs?|jogo|jogavel|fase|coletar|coletaveis|game|playable|level)\b/.test(text),
    flat: /\b(plano|plana|plano horizontal|sem relevo|flat|maquete)\b/.test(text),
    night: /\b(noite|noturn[ao]|night|neon)\b/.test(text),
    topology,outerSpace:topology==='space',planetSurface,
    scienceFiction:scienceFiction || outerSpace || planetSurface,interior,platforms,arena,combat,enemies,peaceful,puzzle,housing,
    shooter,survival,boss,stealth,race,settlement,npcs,keys,launchers,quest:/\b(rpg|missao|missoes|quests?|npcs?|dialogos?)\b/.test(text),
    weapon:requestedWeapon(text,shooter,scienceFiction || outerSpace || planetSurface),
    catalogHousing:housing && !scienceFiction,
    ...worldMotionIntent(text),
  }
}
/** Explicit requests about time passing, wind and wildlife; only these words change dayCycle or motion deterministically. */
function worldMotionIntent(text: string) {
  return {
    dayCycle: /\b(dia e noite|noite e dia|dia\/noite|ciclos? (?:de |do )?(?:dia|noite)|passagem do tempo|o tempo passa|tempo passando|(?:ate|do|ao|quando) (?:o )?(?:amanhecer|anoitecer)|(?:amanhece|anoitece)(?:r)? durante|o sol (?:nasce|se poe)|day.?night|night.?day|day and night|passage of time|time passes|(?:until|from) (?:dawn|dusk)|sunrise to sunset)\b/.test(text),
    dawn: /\b(amanhecer|amanhece|nascer do sol|alvorada|dawn|sunrise)\b/.test(text),
    strongWind: /\b(ventania|vendavais?|ventos? fortes?|ventos? intensos?|tempestades?|temporal|furacao|furacoes|tornados?|nevasca|blizzard|windstorm|gales?|strong winds?|storms?|stormy|hurricanes?)\b/.test(text),
    still: /\b(sem vento|calmaria|ar parado|vento parado|no wind|windless)\b/.test(text),
    noFauna: /\b(sem (?:animais|fauna|passaros|aves|bichos)|no (?:animals|wildlife|birds)|without (?:animals|wildlife))\b/.test(text),
    richFauna: /\b(fauna rica|muitos (?:animais|passaros)|cheio de (?:animais|passaros)|cheia de (?:animais|passaros)|bandos de (?:passaros|aves)|revoadas?|cardumes?|vida selvagem abundante|lots of (?:animals|birds)|teeming with wildlife)\b/.test(text),
    noGrass: /\b(sem grama|no grass|without grass)\b/.test(text),
    denseGrass: /\b(grama alta|gramado denso|capim alto|campos? de (?:grama|capim|trigo)|tall grass|dense grass|grassland)\b/.test(text),
  }
}

type Weather = typeof weatherKinds[number]
type Grade = typeof gradePresets[number]
type Music = typeof musicPresets[number]
const weatherWords: [RegExp, Exclude<Weather, 'none'>, string][] = [
  [/\b(tempestade de neve|nevasca|nevando|neve caindo|flocos de neve|snowfall|snowing|snowflakes|blizzard|neve|snow)\b/, 'snow', 'neve caindo'],
  [/\b(tempestade de areia|sandstorm|poeira|poeirent\w*|dusty|dust)\b/, 'dust', 'poeira no ar'],
  [/\b(chuva|chuvos[ao]|chovendo|tempestade|temporal|garoa|rain|rainy|raining|rainstorm|storm|stormy|thunderstorm)\b/, 'rain', 'chuva'],
  [/\b(chuva de cinzas|cinzas vulcanicas|cinzas caindo|falling ash|ashfall|ashes)\b/, 'ash', 'cinzas no ar'],
  [/\b(brasas|fagulhas|faiscas|embers|sparks)\b/, 'embers', 'brasas flutuando'],
  [/\b(vaga.?lumes?|pirilampos?|fireflies|firefly)\b/, 'fireflies', 'vaga-lumes'],
  [/\b(bolhas|bubbles)\b/, 'bubbles', 'bolhas'],
  [/\b(folhas caindo|folhas ao vento|outono|outonal|autumn|falling leaves)\b/, 'leaves', 'folhas ao vento'],
]
const gradeWords: [RegExp, Exclude<Grade, 'none'>][] = [
  [/\b(noir|preto e branco|black and white)\b/, 'noir'], [/\b(retro|synthwave|vaporwave|anos 80|80s|8.?bits?|vintage)\b/, 'retro'],
  [/\b(oniric\w*|dreamy|dreamlike|etere[ao]s?|ethereal|de sonho)\b/, 'dreamy'], [/\b(cartoon|desenho animado|colorid\w*|vibrantes?|vivid\w*|candy|terra dos doces|kawaii)\b/, 'vivid'],
  [/\b(cinematic\w*|cinematograf\w*)\b/, 'cinematic'], [/\b(aconchegante|cozy|hora dourada|golden hour)\b/, 'warm'], [/\b(tons frios|cool tones|gelid\w*)\b/, 'cool'],
]
const musicWords: [RegExp, Exclude<Music, 'auto'>][] = [
  [/\b(sem musica|without music|no music)\b/, 'none'],
  [/\b(musica|trilha)(?: sonora)? (?:calma|tranquila|relaxante)\b/, 'calm'], [/\b(musica|trilha)(?: sonora)? (?:epica|heroica)\b/, 'heroic'],
  [/\b(musica|trilha)(?: sonora)? (?:misteriosa|de misterio)\b/, 'mystery'], [/\b(musica|trilha)(?: sonora)? (?:tensa|de suspense)\b/, 'tension'],
  [/\b(musica|trilha)(?: sonora)? de (?:combate|batalha|acao)\b/, 'combat'], [/\b(musica|trilha)(?: sonora)? de aventura\b/, 'adventure'],
  [/\b(assombrad\w*|haunted|terror|horror|assustador\w*|spooky|halloween|macabr\w*)\b/, 'spooky'],
  [/\b(natal\w*|christmas|festival|festa|carnaval|festiv\w*)\b/, 'festive'],
]
/** Deterministic theme fixes the builder often forgets; every change is reported and only explicit request words change atmosphere or weapons. */
export function applyThemeDefaults(scene: ThreeSceneDocument, request: string): { document: ThreeSceneDocument; notes: string[] } {
  const intent = sceneIntent(request), text = normalize(request), notes: string[] = []
  const environment = { ...scene.environment }
  if (intent.topology === 'space') {
    if (environment.sky !== 'space') { environment.sky = 'space'; environment.background = '#020308'; notes.push('O céu foi trocado pelo campo de estrelas do espaço sideral.') }
    const deck = scene.nodes.some((node) => node.visible && node.collidable !== false && ['box', 'roundedBox', 'plane', 'extrude', 'mesh', 'cylinder'].includes(node.kind) && node.dimensions[0] >= 4 && node.dimensions[2] >= 4)
    const player = { spawn: null, yaw: 0, speed: 4.5, jumpHeight: 1.1, mode: 'walk' as const, ...environment.player }
    if (!deck && (player.mode !== 'fly' || player.allowFly === false)) { environment.player = { ...player, mode: 'fly', allowFly: true }; notes.push('O jogador começa em voo livre, pois não há convés para caminhar no espaço.') }
  }
  const weather = weatherWords.find(([pattern]) => pattern.test(text))
  if (weather && (environment.weather ?? 'none') === 'none' && intent.topology !== 'space') { environment.weather = weather[1]; notes.push(`O clima pedido foi ativado: ${weather[2]}.`) }
  const audio = { ambience: 'auto' as const, music: 'auto' as const, volume: 0.7, ...environment.audio }
  if (/\b(sem som|sem audio|sem sons|mudo|no sound|muted?)\b/.test(text)) {
    if (audio.ambience !== 'none' || audio.music !== 'none') { environment.audio = { ...audio, ambience: 'none', music: 'none' }; notes.push('O áudio foi silenciado, como pedido.') }
  } else {
    const music = musicWords.find(([pattern]) => pattern.test(text))?.[1]
    const ambience = environment.weather === 'rain' && audio.ambience === 'auto' ? 'rain' as const : audio.ambience
    if ((music && audio.music === 'auto') || ambience !== audio.ambience) {
      environment.audio = { ...audio, ambience, music: music && audio.music === 'auto' ? music : audio.music }
      notes.push(`A trilha sonora acompanha o pedido${ambience !== audio.ambience ? ' (ambiência de chuva)' : ''}${music && audio.music === 'auto' ? ` (música ${music})` : ''}.`)
    }
  }
  const grade = gradeWords.find(([pattern]) => pattern.test(text))?.[1]
  if (grade && (environment.grade ?? 'none') === 'none') { environment.grade = grade; notes.push(`A gradação de cor “${grade}” foi aplicada conforme o estilo pedido.`) }
  const player = environment.player
  if (intent.weapon && (intent.game || intent.combat) && !intent.peaceful && player && (player.weapon ?? 'none') === 'none') {
    environment.player = { ...player, weapon: intent.weapon }
    notes.push(`O jogador recebeu a arma pedida (${intent.weapon}).`)
  }
  const motion: SceneMotion = { ...DEFAULT_MOTION, ...environment.motion }, motionNotes: string[] = []
  if (intent.strongWind && !intent.still && motion.wind < 1.5 && intent.topology !== 'space') { motion.wind = 1.7; motionNotes.push('vento forte') }
  if (intent.still && motion.wind > 0.1) { motion.wind = 0; motionNotes.push('sem vento') }
  if (intent.noFauna && motion.fauna !== 'none') { motion.fauna = 'none'; motionNotes.push('sem animais') }
  else if (intent.richFauna && motion.fauna === 'auto') { motion.fauna = 'rich'; motionNotes.push('fauna abundante') }
  if (intent.noGrass && motion.grass !== 'none') { motion.grass = 'none'; motionNotes.push('sem grama') }
  else if (intent.denseGrass && motion.grass === 'auto') { motion.grass = 'dense'; motionNotes.push('grama densa') }
  if (motionNotes.length) { environment.motion = motion; notes.push(`O movimento do mundo segue o pedido: ${motionNotes.join(', ')}.`) }
  if (intent.dayCycle && !environment.dayCycle?.enabled && intent.topology !== 'space') {
    const start = environment.dayCycle?.start ?? (intent.night ? 20 : intent.dawn ? 5 : 9)
    environment.dayCycle = { enabled: true, duration: environment.dayCycle?.duration ?? 600, start }
    notes.push(`O ciclo dia/noite pedido foi ativado (um dia a cada ${environment.dayCycle.duration / 60} min, começando às ${start} h).`)
  }
  if (environment.objective?.type === 'survive' && !environment.objective.timeLimit) {
    environment.objective = { ...environment.objective, timeLimit: 120 }
    notes.push('O objetivo de sobrevivência recebeu 120 s de duração, pois não tinha tempo limite.')
  }
  return { document: notes.length ? { ...scene, environment } : scene, notes }
}

/** Practical, inspectable heuristics. They guide one refinement; they are not an artistic quality score. */
export function reviewSceneDirection(scene: ThreeSceneDocument, request: string): string[] {
  const intent = sceneIntent(request)
  const text = normalize(request), architecture = intent.catalogHousing && !/^(remova|retire|exclua|apague|delete|remove)\b/.test(text)
  if (!intent.world && !intent.game && !architecture) return []
  const byId=new Map(scene.nodes.map(node=>[node.id,node])),visible=(node:ThreeSceneDocument['nodes'][number]):boolean=>node.visible && (!node.parentId || visible(byId.get(node.parentId)!))
  const nodes = scene.nodes.filter(visible), surfaces = nodes.filter((node) => hasSurface(node.kind))
  const issues: string[] = []
  const houses = nodes.filter(node => node.asset?.type === 'house'), plans = houses.map(node => buildingPlan(node.asset!))
  if (architecture) {
    if (!houses.length && /\b(casas?|sobrados?|house|houses|townhouse|vila|vilarejo|village)\b/.test(text)) issues.push('Faltam habitações construídas: use house com building explícito para garantir vãos reais, interiores e circulação. Não substitua casas por caixas fechadas com janelas sobrepostas.')
    if (/\b(dois andares|dois pavimentos|2 andares|2 pavimentos|primeiro andar|sobrados?|two stor|two floor|second floor)\b/.test(text) && !plans.some(plan => plan.floors === 2)) issues.push('O pedido exige pavimento superior acessível: use house.building.floors=2, com escada e abertura de laje; não basta empilhar blocos.')
    const diversity = new Set(plans.map(p => JSON.stringify([p.style,p.floors,p.width,p.depth])))
    if (houses.length >= 3 && diversity.size < Math.min(3,houses.length)) issues.push('As casas repetem a mesma arquitetura. Crie ao menos três plantas/silhuetas com building.style, floors, width e depth diferentes, preservando o tema; mudar apenas cor ou seed em cópias não resolve.')
    if (houses.some(house => house.asset!.size * Math.min(...house.scale) < 0.9)) issues.push('Há habitações abaixo da escala humana. Mantenha size e escala próximos de 1 para portas e escadas utilizáveis.')
    if (/\b(mobilia|mobiliad|interior|interiores|furnished)\b/.test(text) && plans.some(p=>!p.furnished)) issues.push('O pedido inclui interiores mobiliados: habilite building.furnished e preserve as rotas de passagem.')
  }
  if (intent.world) {
    if (!surfaces.length) issues.push('O lugar solicitado não possui superfícies construídas: materialize os espaços e os elementos necessários à exploração.')
    else if(surfaces.length<4 && ['open','landscape','space'].includes(intent.topology)) issues.push('O mundo solicitado foi reduzido a poucas formas isoladas. Construa seus espaços principais, um marco reconhecível e elementos secundários coerentes com o tema.')
    const shapes = new Set(surfaces.map((node) => JSON.stringify([node.kind,node.dimensions,node.geometry.profile,node.geometry.vertices.length])))
    const materials = new Set(surfaces.map((node) => JSON.stringify([node.material.color, node.material.texture, node.material.metalness, node.material.roughness])))
    if (surfaces.length >= 16 && shapes.size < 3 && materials.size < 3) issues.push('A composição repete quase exclusivamente a mesma forma e material: diferencie proporções, função e acabamento dos elementos necessários ao tema.')
    if (intent.topology==='landscape' && !intent.flat && !nodes.some((node) => node.kind === 'terrain' || node.kind === 'mesh')) issues.push('A paisagem não tem relevo: crie terreno com áreas caminháveis, encostas, bioma e apoios com onto; preserve as rotas de circulação.')
    if (intent.topology==='space') {
      if (scene.environment.sky !== 'space') issues.push('A cena se passa no espaço, mas o céu não é environment.sky="space": use o campo de estrelas e um fundo escuro.')
      if (nodes.some((node) => node.kind === 'terrain' && node.geometry.biome && node.geometry.biome !== 'none')) issues.push('O espaço sideral não tem relevo natural nem bioma: remova o terreno e componha planetas, asteroides, naves e estruturas flutuantes.')
      if (scene.environment.player?.allowFly === false || (scene.environment.player?.mode !== 'fly' && !nodes.some((node) => node.collidable !== false && ['box', 'roundedBox', 'plane', 'extrude', 'mesh', 'cylinder'].includes(node.kind) && node.dimensions[0] >= 4 && node.dimensions[2] >= 4))) issues.push('No espaço o jogador precisa flutuar: use environment.player.mode="fly" e allowFly=true, ou ofereça um convés/plataforma ampla para caminhar.')
    }
    if (intent.world && ['space'].includes(intent.topology) && !nodes.some((node) => (node.kind === 'light' && (node.light?.intensity ?? 0) > 0) || (node.material.emissiveIntensity ?? 0) >= 1.5)) issues.push('O espaço está sem fontes de luz legíveis: acrescente uma estrela/sol emissivo com luz pontual intensa, faróis e luzes de navegação.')
    if (intent.night && !nodes.some((node) => node.kind === 'light' && (node.light?.intensity ?? 0) > 0)) issues.push('A cena noturna não tem luzes práticas: emissivos sozinhos não iluminam os objetos. Acrescente iluminação pontual/spot onde faz sentido.')
  }
  const objective = scene.environment.objective?.type
  if (intent.game && !nodes.some((node) => node.interaction || node.behavior)) issues.push('O jogo pedido não tem atividade: inclua interações e um objetivo alcançável, com início seguro e caminho livre.')
  if (objective === 'collectAll' && !nodes.some((node) => node.interaction?.action === 'collect')) issues.push('O objetivo de coleta não possui coletáveis. Acrescente itens alcançáveis ou corrija o objetivo para corresponder ao pedido.')
  if (objective === 'defeatEnemies' && !nodes.some((node) => node.behavior?.type === 'enemy')) issues.push('O objetivo de combate não possui inimigos. Inclua inimigos afastados do início ou corrija o objetivo.')
  if (objective === 'reachGoal' && !nodes.some((node) => node.behavior?.type === 'goal')) issues.push('O objetivo exige uma chegada, mas não há goal/portal. Crie um destino alcançável.')
  if(intent.combat && !nodes.some(node=>node.behavior?.type==='enemy')) issues.push('O combate solicitado não possui inimigos funcionais. Construa adversários com behavior.type=enemy, patrulha/perseguição e escala coerente com o tema; decoração hostil não implementa combate.')
  if(intent.peaceful && nodes.some(node=>node.behavior?.type==='enemy')) issues.push('O pedido exclui combate, mas existem inimigos funcionais. Preserve a exploração tranquila solicitada.')
  if(intent.puzzle && !nodes.some(node=>{
    const interaction=node.interaction,target=interaction?byId.get(interaction.targetId ?? node.id):undefined
    if(!interaction || !target) return false
    if(interaction.action==='toggleVisibility') return true
    if(interaction.action!=='toggleAnimation') return false
    return scene.nodes.some(candidate=>{
      if(candidate.animation.kind==='none') return false
      for(let current:typeof candidate|undefined=candidate;current;current=current.parentId?byId.get(current.parentId):undefined) if(current.id===target.id) return true
      return false
    })
  })) issues.push('O quebra-cabeça pedido não apresenta uma ação com efeito no cenário: ligue interruptores/alavancas a alvos reais por toggleAnimation ou toggleVisibility e deixe o resultado legível.')
  if(intent.platforms) {
    const matrices=sceneMatrices(scene),bounds=new Box3(new Vector3(-0.5,-0.5,-0.5),new Vector3(0.5,0.5,0.5))
    const tops=surfaces.filter(node=>node.collidable!==false && !node.material.transparent && ['box','roundedBox','plane','mesh','extrude','terrain'].includes(node.kind)).map(node=>({node,box:bounds.clone().applyMatrix4(matrices.get(node.id)!.clone().scale(new Vector3(...node.dimensions)))}))
    const base=Math.min(...tops.map(item=>item.box.max.y)),raised=tops.filter(item=>item.node.kind!=='terrain' && item.box.max.y>base+0.35 && item.box.max.x-item.box.min.x>=0.9 && item.box.max.z-item.box.min.z>=0.9 && item.box.max.y-item.box.min.y<=2)
    if(raised.length<2) issues.push('O percurso de plataformas não tem apoios elevados suficientes: construa ao menos duas superfícies sólidas para saltos, com alturas e distâncias compatíveis com o jogador, além do início e da chegada.')
    if(/\b(plataformas? moveis|moving platforms?)\b/.test(text) && !nodes.some(node=>node.asset?.type==='movingPlatform') && !raised.some(item=>{
      for(let current:typeof item.node|undefined=item.node;current;current=current.parentId?byId.get(current.parentId):undefined) if(current.animation.kind!=='none') return true
      return false
    })) issues.push('O pedido inclui plataformas móveis, mas os apoios estão estáticos: use o prefab movingPlatform (carrega o jogador) ou implemente movimento observável por animação, com apoio e percurso utilizáveis.')
  }
  return [...issues, ...reviewGameplay(scene, nodes, request)]
}

const npcTypes: readonly string[] = ['villager', 'knight', 'wizard', 'astronaut']
const enemyThemes: [RegExp, string][] = [
  [/\b(masmorras?|dungeons?|criptas?|crypts?|catacumbas?|cemiterios?|graveyards?|cemetery|assombrad\w*|haunted|tumbas?|tombs?|esqueletos?|skeletons?|mortos.vivos|undead)\b/, 'skeleton'],
  [/\b(cavernas?|caves?|grutas?|deserto|desert|dunas?|aranhas?|spiders?)\b/, 'spider'],
  [/\b(floresta|florestas|bosque|mata|forest|woods|neve|inverno|snow|winter|tundra|lobos?|wolf|wolves)\b/, 'wolf'],
  [/\b(floresta|florestas|bosque|forest|woods|pantano|swamp|goblins?|medieva\w*|castelos?|castle|reinos?|kingdom)\b/, 'goblin'],
  [/\b(medieva\w*|castelos?|castle|reinos?|kingdom|fortaleza|fortress|orcs?|orques?|terra devastada|wasteland)\b/, 'orc'],
  [/\b(sci.?fi|ficcao cientifica|espacia\w*|space|futurist\w*|cyberpunk|neon|laboratorios?|laboratory|bunker|naves?|lunar|lua|marte|mars|robos?|robots?|drones?)\b/, 'drone'],
  [/\b(sci.?fi|ficcao cientifica|espacia\w*|space|futurist\w*|cyberpunk|laboratorios?|laboratory|bunker|base (?:lunar|militar|secreta)|torretas?|turrets?)\b/, 'turret'],
  [/\b(vulcao|vulcoes|volcan\w*|lava|magma|golem\w*)\b/, 'golem'],
  [/\b(dragao|dragoes|dragons?)\b/, 'dragon'],
]
/** Enemy archetypes of the catalogue that suit the themes named in the request. */
export function themeEnemies(request: string): string[] {
  const text = normalize(request)
  return [...new Set(enemyThemes.filter(([pattern]) => pattern.test(text)).map(([, type]) => type))].slice(0, 4)
}

/** Catalogue-aware gameplay checks: NPC dialogue, themed enemies, keys, weapons, waves, bosses, launchers, races and density. */
function reviewGameplay(scene: ThreeSceneDocument, nodes: ThreeSceneDocument['nodes'], request: string): string[] {
  const intent = sceneIntent(request), issues: string[] = [], environment = scene.environment
  const enemies = nodes.filter(node => node.behavior?.type === 'enemy'), objective = environment.objective
  const npcs = nodes.filter(node => node.behavior?.type === 'npc' || npcTypes.includes(node.asset?.type ?? ''))
  if (intent.npcs && !npcs.length && !nodes.some(node => node.interaction?.action === 'dialogue'))
    issues.push('O lugar pedido deve parecer habitado, mas não há personagens: posicione NPCs (villager, knight, wizard ou astronaut) em praças, barracas e portas, com prefab.text ou interaction dialogue contendo falas separadas por "|".')
  const byId = new Map(scene.nodes.map(node => [node.id, node]))
  const silent = npcs.filter(npc => !npc.asset?.text.trim() && ![...subtreeIds(scene.nodes, npc.id)].some(id => ['dialogue', 'message'].includes(byId.get(id)?.interaction?.action ?? '')))
  if (silent.length) issues.push(`${silent.length} NPC(s) não têm o que dizer (${silent.slice(0, 3).map(node => node.name).join(', ')}): dê a cada um falas curtas em prefab.text ou interaction dialogue (linhas separadas por "|") com pistas, missões ou humor local.`)
  const archetypes = themeEnemies(request)
  if (intent.combat && enemies.length && archetypes.length && enemies.every(node => node.asset?.type === 'enemy'))
    issues.push(`Os inimigos são apenas slimes genéricos, mas o tema pede adversários próprios: use ${archetypes.join(', ')} com health e attack coerentes.`)
  const name = (value: string) => normalize(value.trim())
  const provided = new Set(scene.nodes.flatMap(node => [node.interaction?.item, node.asset?.type === 'key' ? node.asset.text || 'Chave dourada' : undefined]).filter((item): item is string => !!item?.trim()).map(name))
  const required = nodes.flatMap(node => [node.interaction?.requires, node.asset?.type === 'gate' ? node.asset.text : undefined]).filter((item): item is string => !!item?.trim())
  const missing = [...new Set(required.filter(item => !provided.has(name(item))))]
  if (missing.length) issues.push(`Progresso bloqueado: ${missing.slice(0, 3).map(item => `“${item}”`).join(', ')} é exigido por requires/gate, mas nenhum coletável fornece esse item. Crie key (prefab.text = nome exato) ou collect com interaction.item idêntico, alcançável antes da passagem.`)
  if (intent.keys && intent.game && !required.length) issues.push('O pedido inclui chaves ou passagens trancadas, mas nada exige um item: use gate (prefab.text = item) ou interaction.requires em portas/baús e uma key com o mesmo nome em outro ponto de interesse.')
  if (intent.shooter && (environment.player?.weapon ?? 'none') === 'none') issues.push(`O pedido envolve disparos, mas o jogador está desarmado: defina environment.player.weapon="${intent.weapon ?? 'blaster'}" e inimigos com health para resistir a alguns tiros.`)
  if (objective?.type === 'survive') {
    if (!enemies.some(node => (node.behavior?.delay ?? 0) > 0)) issues.push('O objetivo de sobrevivência não tem ondas: distribua inimigos com behavior.delay crescente (ex.: 0, 20, 40, 60 s) surgindo de lados diferentes, com curas entre as ondas.')
    if (!objective.timeLimit) issues.push('O objetivo survive precisa de timeLimit (60–300 s) para que a resistência termine em vitória.')
  } else if (intent.survival) issues.push('O pedido é de sobrevivência: use environment.objective.type="survive" com timeLimit e ondas de inimigos por behavior.delay.')
  if (intent.boss && !nodes.some(node => ['dragon', 'golem'].includes(node.asset?.type ?? '') || (node.behavior?.type === 'enemy' && (node.behavior.health ?? 0) >= 15)))
    issues.push('O chefe pedido não existe: crie um dragon ou golem (ou inimigo próprio) com behavior.health 25–60, dano alto e arena ampla com coberturas.')
  if (intent.launchers && intent.game && !nodes.some(node => node.behavior?.type === 'launcher' || node.asset?.type === 'jumpPad'))
    issues.push('O pedido inclui plataformas de salto, mas nenhuma lança o jogador: use jumpPad ou behavior.type="launcher" com range igual à altura do salto.')
  if (intent.race && (!(objective?.timeLimit ?? 0) || !nodes.some(node => node.behavior?.type === 'goal')))
    issues.push('A corrida contra o relógio precisa de chegada (goal/portal), checkpoints em sequência e objective.timeLimit maior que zero.')
  if (intent.world && ['landscape', 'open'].includes(intent.topology)) {
    const matrices = sceneMatrices(scene), unit = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)), area = new Box3()
    const details = nodes.filter(node => hasSurface(node.kind) && node.kind !== 'terrain' && node.kind !== 'plane')
    for (const node of nodes) if (hasSurface(node.kind) && node.kind !== 'plane') {
      const box = unit.clone().applyMatrix4(matrices.get(node.id)!.clone().scale(new Vector3(...node.dimensions)))
      if (box.max.x - box.min.x <= 300 && box.max.z - box.min.z <= 300) area.union(box)
    }
    const extent = area.isEmpty() ? 0 : (area.max.x - area.min.x) * (area.max.z - area.min.z)
    if (extent >= 2500 && details.length >= 4 && details.length < Math.max(12, extent / 400))
      issues.push(`O mundo está vazio para o seu tamanho: ${details.length} peças em cerca de ${Math.round(extent)} m². Monte 3–5 pontos de interesse com 6–12 adereços cada (cercas, barris, caixotes, bancos, luzes, vegetação, sinais) e preencha o caminho entre eles.`)
  }
  return [...issues, ...reviewLife(scene, nodes, request)]
}

/** Work and sitting need a stall, bench or workbench; other activities may happen at the NPC's base (target null). */
const placeActivities: readonly string[] = ['work', 'sit']
/** Contract 1.4 checks: routines with real places, distinct people, requested day/night and wind. */
function reviewLife(scene: ThreeSceneDocument, nodes: ThreeSceneDocument['nodes'], request: string): string[] {
  const intent = sceneIntent(request), issues: string[] = [], environment = scene.environment
  const byId = new Map(scene.nodes.map(node => [node.id, node])), shown = new Set(nodes.map(node => node.id))
  const people = nodes.filter(node => npcTypes.includes(node.asset?.type ?? ''))
  const residents = nodes.filter(node => node.behavior?.type === 'npc' && node.asset?.type !== 'deer')
  if ((intent.settlement || intent.npcs) && residents.length >= 2 && !residents.some(node => node.behavior?.routine?.length))
    issues.push(`Os ${residents.length} NPCs do lugar habitado só passeiam: dê behavior.routine com lugares concretos por ID e horários (comerciante work na marketStall, sit no bench, chat no fountain/well, guarda patrol na castleWall ou guard no gate, sleep em casa à noite) e reaction (greet, flee ou alert).`)
  const lost = residents.flatMap(node => (node.behavior?.routine ?? []).filter(step => step.target !== null && (!byId.has(step.target) || !shown.has(step.target))).map(step => `${node.name} → ${step.target}`))
  if (lost.length) issues.push(`Rotina com local inexistente ou oculto (${lost.slice(0, 3).join(', ')}): aponte target para o ID de um objeto visível da cena (barraca, banco, poço, fogueira, muralha) ou use null.`)
  const loose = residents.filter(node => node.behavior?.routine?.some(step => step.target === null && placeActivities.includes(step.activity)))
  if (loose.length) issues.push(`${loose.length} NPC(s) trabalham ou sentam sem lugar (${loose.slice(0, 3).map(node => node.name).join(', ')}): defina target com o ID da barraca, bancada ou banco correspondente.`)
  if (people.length >= 3 && new Set(people.map(node => JSON.stringify([node.asset!.type, node.asset!.seed, node.asset!.character ?? null, node.asset!.primary, node.asset!.secondary]))).size === 1)
    issues.push(`Os ${people.length} personagens são cópias idênticas (mesmo tipo, seed e arquétipo): varie prefab.seed, primary/secondary e prefab.character (idade, porte, altura, pele, cabelo, barba) para que cada um seja uma pessoa distinta.`)
  if (intent.dayCycle && intent.topology !== 'space' && !environment.dayCycle?.enabled)
    issues.push('O pedido envolve a passagem do dia, mas não há ciclo: use environment.dayCycle={enabled:true,duration 300–900,start} e luzes práticas para a noite.')
  if (intent.strongWind && !intent.still && intent.topology !== 'space' && (environment.motion?.wind ?? DEFAULT_MOTION.wind) < 1.2)
    issues.push('O pedido fala em ventania ou tempestade, mas o vento está fraco: use environment.motion.wind 1,5–2.')
  return issues
}

const themes: { pattern: RegExp; brief: string }[] = [
  { pattern: /\b(castelos?|castle|reinos?|kingdom|medieva\w*|fortaleza|fortress|cidadela|citadel|cavaleiros?|knights?)\b/, brief: 'CASTELO/REINO MEDIEVAL: marco = castleTower(s) unidas por castleWall (6 m; repeat linear offset 6) sobre uma colina, gate como entrada (prefab.text = item exigido quando trancado), banner nas ameias, torch lit nas muralhas; pátio com well, statue, cart, haystack, barrel/crate e marketStall; knight de guarda e villager como NPCs com falas; em combate orc/goblin/skeleton e um chefe na sala do trono; player.avatar="knight" com weapon="sword". Grade warm ou cinematic, música heroic. Vida: knight com routine patrol na castleWall e guard no gate (reaction alert/greet), ferreiro villager heavy com work na bigorna e emitter sparks, emitter smoke nas chaminés, banner ao vento (motion.wind 0,8–1,2).' },
  { pattern: /\b(mercado|feira|market|bazar|bazaar|aldeia|vilarejo|taverna|tavern|praca central|vila de fantasia|fantasy village)\b/, brief: 'VILA/MERCADO: praça central com fountain ou well como marco, 4–8 marketStall com cores alternadas formando ruas tortas, cart, crate, barrel, haystack, bench, banner e lampPost/torch; casas em volta com portas para a praça; villager comerciantes e um wizard ou knight que dá a missão (interaction dialogue com "|"); sound crowd na praça e water no chafariz; chest ou gate guardando a recompensa da missão. Vida: comerciantes com routine work na própria marketStall (7–18) e chat no fountain/well (18–21), sleep em casa à noite, reaction greet; guarda patrol pelas ruas; ferreiro com emitter sparks; emitter smoke nas chaminés; arquétipos variados (idades, portes, cabelos).' },
  { pattern: /\b(piratas?|pirate\w*|enseada|cove|porto|harbou?r|cais|navios?|galeao|corsari\w*|bucaneir\w*)\b/, brief: 'ENSEADA PIRATA/PORTO: ilha biome="tropical" com closed=true e mar (plane water); dock longo com boat atracados, lighthouse lit no promontório, crates, barrel e cart no cais, palm e rock; chest de tesouro escondido numa gruta (requires uma key guardada por inimigos), banner pirata, campfire na praia; sound waves e birds; weapon bow ou sword, grade warm ao pôr do sol. Vida: motion fauna rich (gaivotas e peixes), wind 0,8–1,2; pescadores work no dock, chat na campfire.' },
  { pattern: /\b(cemiterios?|graveyards?|cemetery|assombrad\w*|haunted|fantasmas?|ghosts?|halloween|terror|horror|spooky|mausoleus?|zumbis?|zombies?)\b/, brief: 'ASSOMBRADO/CEMITÉRIO: sky night, fog 0,02–0,04, weather rain ou leaves, grade noir ou cool; fileiras irregulares de tombstone (scatter com jitter, nunca grade perfeita), ruinArch e mausoléu de pedra como marco, árvores secas (tree primary escuro), cercas quebradas, lanterns/torch lit poucas e pontuais, velas emissivas; skeleton que surgem com behavior.delay, um wizard NPC como guia; audio music spooky e sound chimes/wind. Vida: motion={wind 0,4–0,8, grass none, fauna none}; emitter dust ou magic nos túmulos; coveiro sleep de dia.' },
  { pattern: /\b(masmorras?|dungeons?|criptas?|crypts?|catacumbas?|catacombs?|calabouco|labirintos?|labyrinths?|tumbas?|tombs?)\b/, brief: 'MASMORRA/CRIPTA: salas ligadas por corredores de pedra (box/extrude com texture rock/brick), teto, torch lit a cada 6–8 m, ossadas, barrel/crate quebrados, celas com grades (cylinder), spikes e lever que abre passagem; skeleton e spider como guardas, chest com recompensa, key numa sala lateral e gate trancado (mesmo nome) antes da câmara do chefe; sound drip e fire, ambience dungeon, music tension. Vida: motion grass none e fauna none; emitter fire nos braseiros e dust nas salas.' },
  { pattern: /\b(cyberpunk|neon|megacidade|megacity|distopi\w*|dystopi\w*|hacker\w*|cidade futurista|futuristic city)\b/, brief: 'CYBERPUNK/NEON: noite com weather rain e grade noir ou retro, bloom 0,8–1,4; skyscraper lit densos com letreiros (text emissivo magenta/ciano), passarelas e telhados ligados por movingPlatform/jumpPad, container, console, dutos (tube), poças refletivas (plane clearcoat 1); drone voadores e turret como inimigos, player.weapon="blaster" e avatar robot ou explorer; sound engine/alarm/crowd. Vida: emitter steam em bueiros e dutos; motion grass none, fauna none.' },
  { pattern: /\b(laboratorios?|laborator\w*|bunker|base (?:lunar|militar|cientifica|secreta|espacial|sci.?fi)|instalacao|facility|estacao de pesquisa|research station|reatore?s?|reactors?)\b/, brief: 'BASE SCI-FI/LABORATÓRIO: setores com função clara (hangar, laboratório, sala do reactor como marco pulsante, comando com console), container empilhados, radarDish no exterior, portas com keyframes acionadas por console/lever, painéis emissivos e cabos (tube); astronaut NPC dando instruções; em combate drone e turret com health; sound machine/alarm, ambience scifi, grade cool.' },
  { pattern: /\b(pos.?apocalipt\w*|post.?apocalyptic|apocalipse|apocalypse|wasteland|terra devastada|cidade abandonada|radioativ\w*|sucata|scrapyard)\b/, brief: 'PÓS-APOCALÍPTICO: terreno biome="desert" ou "volcanic" esmaecido, weather dust ou ash, grade cinematic; ruínas de concreto (box quebradas, rust), car e container enferrujados, barricadas de crate/barrel, torres de vigia, acampamento de sobreviventes com campfire, tent e villager NPCs; inimigos orc (saqueadores), spider ou drone; survive com ondas é uma boa escolha; sound wind/fire.' },
  { pattern: /\b(japones\w*|japan\w*|japao|samurai|ninjas?|zen|pagod\w*|sakura|cerejeiras?|torii|dojo|shogun)\b/, brief: 'JAPÃO/TEMPLO: jardim com lago (plane water) e ponte arqueada (bridge ou tube), pagode em camadas (cone/box empilhados com telhados curvos) como marco, portais torii (cylinder + box vermelhos), cerejeiras (tree primary rosa #f4b6c8, weather leaves), lanternas de pedra (torch lit), rock zen com areia rastelada (plane sand), bambu (cylinder finos); NPC villager/wizard como monge; weapon sword; grade dreamy ou warm, sound water e chimes, music calm.' },
  { pattern: /\b(velho oeste|faroeste|wild west|western|cowboys?|caubois?|saloon|xerife|sheriff)\b/, brief: 'VELHO OESTE: rua principal de terra (roads sand) com fachadas de madeira (house lodge/cottage ou box com placas sign "SALOON", "XERIFE"), cart, haystack, barrel, fence, poço, cactus e rock no deserto em volta, windmill de fazenda; villager NPCs; inimigos bandidos (orc recolorido ou goblin) e duelo ao pôr do sol: weapon blaster (revólver), weather dust, grade warm, sound wind.' },
  { pattern: /\b(steampunk|vitorian\w*|victorian|engrenagens|dirigive\w*|airships?|maquinas? a vapor|steam engines?)\b/, brief: 'STEAMPUNK: latão e cobre (metalness 0,8, color #b08d57), engrenagens gigantes animadas (cylinder/torus com spin), chaminés com vapor (sphere transparentes com float), dirigível flutuante (capsule + gôndola) como marco, tubulações (tube), relógio de torre, reactor recolorido como caldeira, console de alavancas; villager e wizard (inventor) NPCs; drone e golem mecânicos; sound machine; grade warm ou retro. Vida: emitter steam e smoke nas chaminés e caldeiras, sparks nas oficinas.' },
  { pattern: /\b(doces|candy|candyland|guloseimas|chocolate|pirulitos?|confeitaria|cartoon|desenho animado|kawaii|terra dos doces)\b/, brief: 'TERRA DOS DOCES/CARTOON: cores saturadas pastel, grade vivid, roughness baixa e clearcoat; pirulitos gigantes (cylinder + sphere/torus listrado), cogumelos-sobremesa (mushroom size≥2 colorido), rios de chocolate (plane #5a3420), colinas rolling biome "meadow", jumpPad de gelatina, movingPlatform de biscoito, coin/gem em arcos, powerOrb; NPCs villager sorridentes; inimigos goblin ou slime fofos; music festive, sound chimes.' },
  { pattern: /\b(dinossauros?|dinosaurs?|pre.?histori\w*|prehistoric|jurass\w*|mamutes?|mammoths?|homem das cavernas|tribal)\b/, brief: 'PRÉ-HISTÓRICO: selva biome="tropical" com samambaias (bush grandes), palm, tree gigantes, vulcão ao fundo (cone com lava emissiva, weather ash leve), ossadas enormes (tube/capsule brancas) como marco, aldeia tribal com tent, campfire, totem (column esculpida); dinossauros compostos de capsule/cone em grupos com animation; deer como fauna, wolf/golem como predadores; sound birds/insects, music adventure. Vida: emitter smoke no vulcão, embers na fogueira, motion fauna rich.' },
  { pattern: /\b(natal\w*|christmas|xmas|papai noel|santa claus|festival de inverno|winter festival|vila de inverno|winter village|mercado de inverno)\b/, brief: 'VILA DE INVERNO/FESTIVAL: biome="snow", weather snow, sky night ou sunset, grade warm; praça com árvore enorme (pine com luzes emissivas coloridas e estrela lit) como marco, marketStall de comidas, banner e guirlandas, lampPost lit, bonecos de neve (sphere), trenó/cart, presentes (box com faixas), patinação num lago congelado; villager NPCs festivos, coleta de presentes; music festive, sound chimes e crowd. Vida: emitter smoke nas chaminés, motion grass none; aldeões com routine chat na praça e work nas barracas.' },
  { pattern: /\b(floresta|florestas|bosque|mata|forest|woods|woodland)\b/, brief: 'FLORESTA: terreno biome="forest" (rolling ou ridged); dossel denso com vários templates scatter de tree e pine com seeds diferentes (60–250 árvores no total), sub-bosque com bush, flowerBed, log, stump, mushroom e rock; trilhas com roads texture "sand" ou "rock"; clareiras como pontos de interesse com fauna deer; em combate wolf e goblin; neblina 0,006–0,014 e sol 25–50° para feixes entre as copas. À noite, cogumelos lit=true e weather fireflies; sound birds/insects. Vida: motion fauna rich e grass dense nas clareiras; emitter leaves em copas de outono.' },
  { pattern: /\b(selva|jungle|rainforest|tropical|amazonia|amazon)\b/, brief: 'SELVA/TROPICAL: biome="tropical", relevo rolling com rios (plane com texture water) e cachoeiras (box/plane emissivo azulado com transparência, sound water), vegetação muito densa (tree com primary verde-escuro, palm, bush), cipós (tube), ruínas cobertas (column, ruinArch, rock), spider/wolf como ameaças e neblina 0,008–0,015.' },
  { pattern: /\b(praia|praias|beach|litoral|coast|ilha tropical|tropical island|caribe|caribbean)\b/, brief: 'PRAIA/ILHA: terreno biome="tropical" com closed=true e um plane grande com texture water ligeiramente acima da cota baixa; faixa de areia, palm em grupos, rock, boat, dock, lighthouse, barracas/tent, sinalização; sound waves e birds. Sol alto (40–60°) ou pôr do sol. Vida: motion fauna rich (aves e peixes), wind 0,8–1,2.' },
  { pattern: /\b(deserto|desert|dunas?|dunes|oasis|saara|sahara)\b/, brief: 'DESERTO: biome="desert", terrainStyle="dunes", cactus e rock esparsos, oásis com plane water, palm e tent; caravana com cart, marketStall e barrel; ruínas com column, ruinArch e statue; spider como ameaça; weather dust, céu day/sunset, neblina leve quente (0,002–0,005). Vida: motion grass none, wind 1–1,4, emitter dust.' },
  { pattern: /\b(neve|nevad\w*|inverno|winter|snow\w*|tundra|artic\w*|arctic|glacial|geleira|glacier|polo norte|north pole)\b/, brief: 'NEVE/INVERNO: biome="snow" (ou alpine para montanhas), pine em agrupamentos com primary claro, rock, lagos congelados (plane com color #dff3ff, roughness 0,1, clearcoat 1), tent e campfire lit=true como ponto quente; deer e wolf; weather snow, céu overcast ou sunset baixo, neblina 0,006–0,012, grade cool. Vida: motion grass none; emitter smoke nas cabanas.' },
  { pattern: /\b(pantano|swamp|brejo|marsh|mangue|mangrove)\b/, brief: 'PÂNTANO: biome="swamp" com relevo baixo, poças com plane water escuro (#4c5a3a), log, stump, mushroom, árvores tortas (tree primary oliva), cabana sobre palafitas, goblin ou spider; weather fireflies à noite, neblina densa 0,012–0,02, céu overcast, sound insects.' },
  { pattern: /\b(vulcao|vulcoes|volcan\w*|lava|magma)\b/, brief: 'VULCÂNICO: biome="volcanic", terrainStyle="ridged", rios de lava como plane/extrude com emissive laranja (2–6) e behavior hazard, rocks escuros, crystalCluster lit, golem como guardião, céu sunset ou night, weather embers ou ash, bloom 0,6–1,2, neblina avermelhada, sound fire. Vida: emitter embers e smoke nas crateras, motion fauna none e grass none.' },
  { pattern: /\b(oceano|ocean|fundo do mar|seabed|underwater|subaquatic\w*|submarin\w*|recife|reef|atlantida|atlantis)\b/, brief: 'SUBAQUÁTICO: chão de terreno biome="tropical" ou desert (areia), coral, seaweed, rock e crystalCluster espalhados, cardumes como esferas/cápsulas pequenas com animation orbit/float (collidable=false), raios de luz com spot fraco, chest naufragado e ruinArch; weather bubbles; environment.sky="overcast" ou "night", background azul-esverdeado, fog 0,02–0,04 e player.mode="fly" (nadar). Vida: motion fauna rich (peixes), grass none.' },
  { pattern: /\b(caverna|cavernas|cave|caves|gruta|mina|mine|subterrane\w*)\b/, brief: 'CAVERNA: paredes e teto de polyhedron/extrude com texture rock e flatShading, chão irregular, crystalCluster lit=true como iluminação principal, torch, estalactites (cone invertido), trilhos e cart de mina, passagens ≥1,5 m, spider/skeleton, sound drip, céu night com neblina escura. Vida: motion grass none e fauna none; emitter dust nas minas.' },
  { pattern: /\b(cidade|metropole|metropolis|urban\w*|city|downtown|bairro|avenidas?|ruas)\b/, brief: 'CIDADE: chão plane com texture asphalt e calçadas (box concrete), quarteirões com skyscraper (alturas e cores variadas, nunca grade perfeita), roads largas, car estacionados, lampPost lit, bench, árvores de rua, placas (sign), fountain ou statue numa praça, villager NPCs; sound city/crowd/engine. À noite use lit=true nas janelas, bloom 0,6–1,0 e luzes de poste.' },
  { pattern: /\b(ruinas|ruins|templo|temple|antig[oa]s?|ancient|grecia|roma|maia|maya|asteca|aztec)\b/, brief: 'RUÍNAS/TEMPLO: column (seeds múltiplas de 3 geram colunas quebradas), ruinArch, statue tombada, escadarias (box em linear), plataformas de pedra com texture rock/marble, rock e vegetação invasora, crystalCluster ou gem como relíquias, lever/console antigo abrindo a câmara interna.' },
  { pattern: /\b(acampamento|camping|camp|trilha|trail)\b/, brief: 'ACAMPAMENTO: tent em semicírculo, campfire lit=true (sound fire) no centro, log como bancos, lanternas (torch), cart com suprimentos, árvores ao redor e trilhas. Vida: emitter embers sobre a campfire; campistas com routine chat na fogueira e sleep na tent.' },
  { pattern: /\b(lua|lunar|moon|marte|mars|marciano|martian|planeta alienigena|alien planet|exoplaneta|exoplanet|crateras?|craters?)\b/, brief: 'SUPERFÍCIE PLANETÁRIA: terreno biome="lunar" (Lua), "desert" com color avermelhado (Marte) ou "alien" (exoplaneta), terrainStyle ridged/dunes, crateras como lathe/torus baixos, rocket, módulos/cúpulas (sphere metade enterrada, transmissão), radarDish, container, reactor e console; astronaut NPC; em combate turret e drone; céu "space" com planet grande ao fundo (scale alto, longe) ou sunset alienígena; player.avatar="astronaut"; gravidade normal de caminhada.' },
  { pattern: /\b(coliseu|colosseum|coliseum|gladiador\w*|gladiators?|torneio|tournament)\b/, brief: 'ARENA/COLISEU: anel de arquibancadas (lathe/extrude em degraus) com banner, statue nos portões e camarote; areia (plane sand) com colunas e muretas como cobertura; portões gate de onde saem ondas (behavior.delay); heart e powerOrb nos cantos; sound crowd, music combat.' },
  { pattern: /\b(corridas?|race|racing|contra o relogio|contrarrelogio|time.?trial|speedrun|circuito|cronometr\w*)\b/, brief: 'CORRIDA/CONTRARRELÓGIO: percurso sinuoso com 4–8 checkpoint em sequência (arcos/banner sinalizando), atalhos arriscados com jumpPad e movingPlatform, powerOrb speed no caminho, spikes ou lava como penalidade, portal de chegada; objective reachGoal com timeLimit 60–180 s.' },
  { pattern: /\b(sobreviva|sobreviver|sobrevivencia|survival|survive|hordas?|hordes?|ondas de inimigos|modo horda)\b/, brief: 'SOBREVIVÊNCIA/HORDA: base defensável no centro (barricadas de crate/barrel, castleWall baixa, torres), 3–4 entradas de onde surgem inimigos com behavior.delay escalonado (0, 20, 40, 60, 90 s), heart e powerOrb (shield/strength) espalhados, objective survive com timeLimit 120–240 s; weapon adequada ao tema.' },
  { pattern: /\b(furtiv\w*|stealth|infiltra\w*|sorrateir\w*|heist|assalto|roubo|roubar|cofre|vault|espionagem|spy)\b/, brief: 'FURTIVIDADE/ASSALTO: alvo trancado (chest ou gate com requires) no fundo, guardas inimigos com range curto (4–6) e patrulhas lentas, sombras e coberturas (container, crate, paredes baixas), rotas alternativas por dutos/telhados, key ou cartão (key com text) em uma sala lateral, luzes spot como zonas de vigilância, saída portal; music tension.' },
  { pattern: /\b(chefao|chefe final|boss\w*|dragao|dragoes|dragons?|batalha final|final battle)\b/, brief: 'CHEFE: arena ampla (≥30 m) e iluminada com colunas/rochas como cobertura, um único dragon (ou golem) com behavior.health 30–60 e damage alto, lacaios menores antes da arena, heart nas laterais, checkpoint na entrada e portal/chest que surge após a vitória; music heroic ou combat.' },
]
/** Concrete, catalogue-aware hints for every theme recognised in the request. */
export function themeBrief(request: string): string {
  const text = normalize(request)
  return themes.filter((theme) => theme.pattern.test(text)).slice(0, 5).map((theme) => theme.brief).join('\n')
}

/** World motion and time asked for explicitly, or implied by enclosed/space topologies. */
function lifeBrief(intent: ReturnType<typeof sceneIntent>): string {
  const motion = [
    intent.strongWind && !intent.still ? 'environment.motion.wind 1,5–2 (ventania pedida)' : intent.still ? 'environment.motion.wind 0 (sem vento)' : '',
    intent.noFauna ? 'motion.fauna "none" (sem animais)' : intent.richFauna ? 'motion.fauna "rich"' : intent.topology === 'space' || intent.topology === 'interior' ? 'motion.grass "none" e fauna "none" (sem natureza aberta)' : '',
    intent.noGrass ? 'motion.grass "none"' : intent.denseGrass ? 'motion.grass "dense"' : '',
  ].filter(Boolean)
  return [motion.length ? `MOVIMENTO: ${motion.join('; ')}.` : '',
    intent.dayCycle && intent.topology !== 'space' ? 'CICLO DIA/NOITE: environment.dayCycle={enabled:true,duration 300–900,start} com luzes práticas (postes, tochas, janelas) para a noite; as rotinas dos NPCs seguem as horas (trabalho de dia, conversa ao entardecer, sono à noite).' : ''].filter(Boolean).join('\n')
}

export function directionBrief(request: string): string {
  const intent = sceneIntent(request)
  const architecture = intent.catalogHousing
  if (!intent.world && !intent.game && !architecture) return themeBrief(request) ? `\nDIREÇÃO TEMÁTICA:\n${themeBrief(request)}` : ''
  const topology={
    landscape:'Organize a paisagem pelos pontos de interesse solicitados; vegetação só quando fizer parte do ambiente. Preserve espaços vazios intencionais e circulação.',
    interior:'INTERIORES: componha salas, corredores e acessos com pisos sólidos, paredes com espessura, aberturas reais, teto e iluminação prática. Diferencie cada setor por função, silhueta, sinalização e equipamento apropriado. Conectividade significa portas, passagens e escadas; não pinte estradas por cima do piso e não acrescente gramado externo.',
    platforms:'PLATAFORMAS/PARKOUR: construa início seguro, apoios sólidos de tamanhos e alturas legíveis, progressão de saltos, recuperação/checkpoints e chegada. Respeite jumpHeight e velocidade do jogador: saltos exigem distâncias alcançáveis. Use movingPlatform (desliza e carrega o jogador) e jumpPad (lança para cima) para variar o ritmo, além de coin/gem em arcos que indicam o salto. Caminho conceitual inclui saltos e plataformas móveis; não una todos os apoios com estradas contínuas nem preencha vãos destinados ao desafio.',
    arena:'ARENA: disponha chegada protegida, área de confronto, coberturas com rotas laterais e destino legível. Dimensione obstáculos para a câmera e circulação. Materiais, equipamentos e silhuetas seguem o tema; uma arena não implica vila, bosque ou relevo natural.',
    space:'ESPAÇO SIDERAL: não há chão natural nem gravidade aparente. Use environment.sky="space", background escuro, player.mode="fly" com allowFly=true e spawn livre de objetos. Distribua planetas (prefab planet, size 3–5 e escala do grupo até 20 para gigantes), luas, cinturões de asteroides (asteroid com repeat scatter e offset Y diferente de zero para volume 3D), naves (spaceship), satélites, estação (spaceStation) e uma estrela emissiva intensa com luz pontual de alcance amplo. Mantenha distâncias grandes entre corpos celestes e órbitas com animation orbit. Nada de terreno, estradas, árvores ou casas.',
    open:'Organize os espaços e acessos conforme o lugar solicitado, incluindo marcos, estruturas e detalhes próprios desse tema. Não adicione casas, árvores ou cenário rural por padrão.',
  }[intent.topology]
  const enemies=themeEnemies(request)
  const genre=[
    intent.combat?`COMBATE: implemente inimigos funcionais com behavior.type=enemy (health, attack, speed e range coerentes), protegendo o spawn e alternando corpo a corpo e à distância.${enemies.length?` Arquétipos do tema: ${enemies.join(', ')}; evite slimes genéricos.`:''} Use o tipo de objetivo pedido, mesmo quando derrotar inimigos é apenas parte do percurso; recompense encontros com heart ou powerOrb.`:'',
    intent.shooter?`TIRO: environment.player.weapon="${intent.weapon ?? 'blaster'}"; inimigos com health 2–5, parte com attack="ranged" ou flying (drone, turret), coberturas na altura do peito e linhas de visão longas.`:'',
    intent.weapon && !intent.shooter && !intent.peaceful?`ARMA: o jogador usa environment.player.weapon="${intent.weapon}".`:'',
    intent.npcs||intent.quest?'RPG/NPCS: povoe o lugar com NPCs (villager, knight, wizard, astronaut) parados onde fazem sentido, cada um com falas em prefab.text ou interaction dialogue (linhas separadas por "|"); um deles dá a missão; o item da missão (key ou collect com interaction.item) fica em outro ponto de interesse e abre gate/chest com requires do mesmo nome.':'',
    intent.keys && !(intent.npcs||intent.quest)?'CHAVES: key com prefab.text = nome do item (padrão "Chave dourada") e gate/chest ou porta com interaction.requires idêntico; a chave fica antes da passagem, nunca atrás dela.':'',
    intent.survival?'SOBREVIVÊNCIA: environment.objective={type:"survive",timeLimit:120–240}; ondas de inimigos com behavior.delay crescente (0, 20, 40, 60…) vindas de entradas diferentes, heart e powerOrb entre as ondas e uma posição defensável.':'',
    intent.boss?'CHEFE: um único dragon ou golem com behavior.health 25–60 e dano alto numa arena ampla com coberturas, lacaios antes da arena, checkpoint na entrada e recompensa após a vitória.':'',
    intent.race?'CORRIDA: checkpoints em sequência, objective reachGoal com timeLimit 60–180 s, atalhos com jumpPad/movingPlatform e powerOrb speed.':'',
    intent.stealth?'FURTIVIDADE: guardas com range curto (4–6) e patrulhas lentas, sombras, coberturas e rotas alternativas até o alvo trancado; luzes spot marcam zonas de vigilância.':'',
    intent.launchers && !intent.platforms?'SALTOS: jumpPad ou behavior.type="launcher" (range = altura em metros) levam a mirantes, telhados ou plataformas elevadas.':'',
    intent.settlement||intent.npcs?'VIDA DOS NPCS: cada personagem com prefab.character distinto (idade, porte, altura, pele, cabelo, barba), seed e cores próprias; behavior.routine com target = ID de lugares desta receita e horários: comerciantes work na marketStall e chat no fountain/well no fim do dia, guardas patrol na muralha ou guard no portão, ferreiro work na forja (emitter sparks), bardo perform na praça, sleep em casa à noite; reaction greet nos moradores, flee nos tímidos e alert em quem chama os guardas.':'',
    lifeBrief(intent),
  ].filter(Boolean).join('\n')
  return `\nDIREÇÃO DE PRODUÇÃO: preserve o gênero e o lugar solicitados. Antes de construir, decida título, premissa com gancho, um marco assinatura, 3–5 pontos de interesse com micro-história e 6–12 adereços cada, paleta, luz/grade/clima/som e o ciclo início → desafio → recompensa → conclusão. Construa as massas principais e depois detalhes que expressem a função de cada espaço. Prefabs opcionais são componentes, não um tema obrigatório; crie geometrias próprias quando o catálogo não representa o pedido.
${topology}
${intent.topology==='landscape' && !intent.flat ? 'Use relevo real com geometry.terrainStyle (rolling/ridged/terraced/dunes) e geometry.biome coerente; diferencie chão, rocha e encostas. Reserve apoios caminháveis para construções e conecte acessos externos com roads quando necessário.' : ''}
${themeBrief(request)}
${intent.scienceFiction?'FICÇÃO CIENTÍFICA: use módulos, painéis, estruturas técnicas, dutos, console, reactor, container e luzes práticas coerentes com a função e a época. Emissivos complementam a iluminação; não substitua instalações futuristas por casas rurais recoloridas.':''}
${genre}
${intent.puzzle?'QUEBRA-CABEÇA: implemente uma relação ação → efeito observável. Interruptores/alavancas (lever, console) precisam atingir objetos reais por interaction.targetId com toggleAnimation/toggleVisibility, sem bloquear definitivamente a única saída. Mensagens e decoração sozinhas não são um puzzle funcional.':''}
${intent.game ? 'Entregue a atividade e a condição de conclusão solicitadas, com controles e percurso legíveis, usando mecânicas realmente implementadas pelo runtime.' : 'A exploração pode ser livre, sem impor coleta ou combate.'}
${intent.peaceful?'O pedido exclui inimigos ou combate: mantenha a exploração tranquila; fauna (deer) e NPCs podem dar vida ao lugar.':''}
${architecture ? 'ARQUITETURA: planeje plantas e volumetrias antes de distribuir casas. Escolha building.style/floors/width/depth explicitamente e mantenha escala humana. Em vilas use ao menos três silhuetas coerentes com a época; distribua portas voltadas para ruas e ligue os acessos ao caminho. Reserve um envelope de largura+3 e profundidade+4 metros por casa. Não entregue fileiras do mesmo prefab com cores diferentes. Pedidos de sobrado exigem floors=2. Preserve interiores mobiliados e circulação.' : ''}
Revise antes de responder: identidade do gênero, escala humana, silhuetas, densidade de detalhes, materiais, acessos, iluminação, som e correspondência entre objetivo e mecânicas. Crie terreno e habitações somente quando pertencem ao pedido.`
}

/** Rich example prompts that exercise the catalogue and mechanics; the UI may offer them as starting ideas. */
export const creativeIdeas: readonly (readonly [string, string])[] = [
  ['Cripta do Rei Esquecido', 'Crie uma masmorra-cripta com salas de pedra iluminadas por tochas, ossadas, celas e armadilhas de espinhos. Esqueletos guerreiros e aranhas patrulham os corredores; uma chave de ferro numa sala lateral abre o portão da câmara final, onde um golem de pedra com muita vida guarda um baú de tesouro. Corações escondidos, som de gotas e fogo, música tensa.'],
  ['Feira de Valdora', 'Crie uma vila medieval em dia de feira: praça com chafariz, barracas coloridas, carroças, feno, estandartes e casas ao redor. Aldeões comerciantes conversam com o jogador; um mago pede o Amuleto Perdido, escondido num baú trancado nas ruínas da colina, cuja chave está com um goblin no bosque. Som de multidão, música festiva, luz quente de fim de tarde.'],
  ['Enseada do Corvo', 'Crie uma enseada pirata ao pôr do sol: ilha tropical com píer, barcos atracados, farol aceso no promontório, caixotes e barris no cais e uma gruta onde fica o tesouro trancado. Piratas (orcs) guardam a chave do baú; o jogador usa arco. Som de ondas e gaivotas, gradação quente.'],
  ['Noite no Cemitério de Grimhollow', 'Crie um cemitério assombrado à noite, com chuva, neblina densa, lápides tortas, mausoléu de pedra, arcos em ruínas, árvores secas e poucas lanternas. Um mago guia o jogador; esqueletos surgem em ondas e é preciso sobreviver 2 minutos até o amanhecer. Música assustadora e sinos ao vento.'],
  ['Telhados de Neo-Kyoto', 'Crie uma perseguição nos telhados de uma cidade cyberpunk à noite com chuva e neon: arranha-céus iluminados, letreiros, passarelas, plataformas móveis e plataformas de salto entre prédios. O jogador tem um blaster e enfrenta drones voadores e torretas até alcançar o portal no topo da torre central.'],
  ['Última Barricada', 'Crie um modo de sobrevivência em uma terra devastada pós-apocalíptica: acampamento de sobreviventes cercado de barricadas, carros e contêineres enferrujados, torres de vigia e poeira no ar. Ondas de saqueadores e aranhas chegam de três entradas; corações e orbes de poder entre as ondas. Sobreviva por 3 minutos com o blaster.'],
  ['Ilhas do Céu', 'Crie uma fase de plataformas em ilhas flutuantes no céu ao entardecer, com plataformas móveis que carregam o jogador, plataformas de salto, moedas em arcos, checkpoints, espinhos e um portal final no castelo mais alto. Cores vivas e música de aventura.'],
  ['Bosque dos Lobos Uivantes', 'Crie uma floresta encantada ao anoitecer com vaga-lumes, cogumelos luminosos, riacho, ruínas cobertas de musgo e um círculo de pedras. Um mago na clareira pede três cristais; lobos e goblins rondam as trilhas. O jogador usa cajado mágico. Sons de pássaros e insetos.'],
  ['Base Lunar Selene', 'Crie uma base lunar na superfície da lua com módulos, cúpulas, antena radar, contêineres, reator pulsante e consoles. Um astronauta dá instruções; o jogador, também astronauta com blaster, precisa religar o reator enquanto torretas e drones defendem o setor. Planeta gigante no céu.'],
  ['Festival de Inverno de Pinheval', 'Crie uma vila de inverno em noite de festival, com neve caindo, uma árvore gigante iluminada na praça, barracas de comida, bonecos de neve, lago congelado e luzes quentes. Aldeões conversam e pedem ajuda para recolher presentes espalhados pela vila. Sem inimigos; música festiva.'],
]
