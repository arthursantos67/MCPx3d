import { hasSurface, type ThreeSceneDocument } from './sceneDocument.ts'
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
export function sceneIntent(request: string) {
  const text = normalize(request)
  const scienceFiction=/\b(sci.?fi|ficcao cientifica|espacial|espaciais|space|spaceship|orbital|futurist\w*|cyberpunk|nave|naves|laboratorio|laboratorios|laboratory|laboratories)\b/.test(text)
  const interior=/\b(interior|interiores|interno|interna|indoor|interior|corredores?|corridors?|salas?|rooms?|estacao espacial|space station|nave|spaceship|laboratorio|laboratory|masmorra|dungeon|subterrane\w*)\b/.test(text)
  const platforms=/\b(plataformas?|platforms?|platformer|parkour|saltos?|jumping|pulos?)\b/.test(text)
  const arena=/\b(arenas?|combat arenas?|campo de batalha|battlefield)\b/.test(text)
  const planetSurface=planetSurfacePattern.test(text)
  const outerSpace=outerSpacePattern.test(text) && !planetSurface
  const landscape=(planetSurface || /\b(floresta|florestas|bosque|mata|selva|jungle|rainforest|ilha|ilhas|vale|montanhas?|deserto|dunas?|oasis|paisagem|fazenda|campo|pradaria|savana|savanna|canyon|canion|desfiladeiro|praia|praias|beach|litoral|coast|neve|nevad\w*|inverno|winter|snow\w*|tundra|artic\w*|arctic|glacial|geleira|glacier|pantano|swamp|brejo|marsh|vulcao|volcan\w*|lava|lagos?|lakes?|rios?|rivers?|cachoeiras?|waterfalls?|recife|reef|oceano|ocean|fundo do mar|seabed|underwater|subaquatic\w*|submarin\w*|forest|woods|island|landscape|mountains?|desert|farm|meadow|countryside)\b/.test(text)) && !/\b(sem terreno|sem paisagem|no terrain|without landscape)\b/.test(text)
  const enemyProhibition=/\b(?:sem (?:nenhum )?inimigos?|no enemies|without enemies|nao (?:quero|inclua|adicione|crie) inimigos|nao (?:deve|pode) (?:ter|haver) inimigos)\b/g
  const forbidsEnemies=[...text.matchAll(enemyProhibition)].some(match=>!/^\s+(?:(?:ou|e|or|and)\s+(?:perigos|hazards)\s+)?(?:no|na|nos|nas|junto|perto|proxim|near|around|at the|in the)\b/.test(text.slice(match.index!+match[0].length)))
  const peaceful=forbidsEnemies || /\b(sem (?:combate|batalhas?|violencia)|without combat|peaceful|pacific[oa]|exploracao tranquila)\b/.test(text)
  const enemies=/\b(inimigos?|enemies|enemy|adversarios?|monstros?|monsters?|drones? hostis|hostile drones?)\b/.test(text.replace(enemyProhibition,'')) && !peaceful
  const combat=!peaceful && (enemies || /\b(combate|batalhas?|combat|battles?|survival|sobrevivencia|shooter|fps|tiroteio)\b/.test(text))
  const puzzle=/\b(puzzles?|quebra.cabecas?|enigmas?|interruptores?|switches?|alavancas?|levers?)\b/.test(text)
  const noHousing=/\b(sem (?:casas|moradias|habitacoes)|no houses|without houses|nao (?:quero|adicione|inclua|crie) (?:casas|moradias|habitacoes))\b/.test(text)
  const housing=!noHousing && (/\b(casas?|sobrados?|moradias?|residencias?|house|houses|townhouses?|chales?|cottages?)\b/.test(text) || (!scienceFiction && !interior && /\b(vila|vilarejo|village)\b/.test(text)))
  const enclosedTheme=/\b(estacao espacial|space station|nave|spaceship|masmorras?|dungeons?|laboratorios?|laboratory|subterrane\w*)\b/.test(text)
  const outdoor=landscape || (housing && !scienceFiction && /\b(vila|vilarejo|village)\b/.test(text))
  const spaceFlight=(outerSpace || (/\b(estacao espacial|space station|naves?|spaceships?)\b/.test(text) && /\b(no espaco|in space|orbita\w*|orbit\w*|planetas?|planets?|asteroides?|asteroids?|frota|fleet|batalha espacial|space battle)\b/.test(text))) && !interiorWords.test(text)
  const topology:SceneTopology=platforms?'platforms':arena?'arena':spaceFlight?'space':enclosedTheme && !planetSurface?'interior':outdoor?'landscape':interior?'interior':'open'
  return {
    world: topology==='space' || landscape || /\b(vila|vilarejo|cidade|metropole|metropolis|bairro|centro urbano|downtown|ruas|ruinas|templo|castelo|fazenda|acampamento|camping|caverna|cavernas|cave|caves|mina|mine|village|city|town|world|mundo|fase|mapa|cenario|arenas?|masmorras?|dungeons?|estacao espacial|space station|nave|spaceship|laboratorios?|laborator\w*|complexo industrial|industrial complex|plataformas|platformer|parkour|parque|park|porto|harbor|aeroporto|airport)\b/.test(text),
    landscape: outdoor && (!enclosedTheme || planetSurface),
    game: combat || puzzle || platforms || /\b(jogo|jogavel|fase|coletar|coletaveis|game|playable|level)\b/.test(text),
    flat: /\b(plano|plana|plano horizontal|sem relevo|flat|maquete)\b/.test(text),
    night: /\b(noite|noturn[ao]|night|neon)\b/.test(text),
    topology,outerSpace:topology==='space',planetSurface,
    scienceFiction:scienceFiction || outerSpace || planetSurface,interior,platforms,arena,combat,enemies,peaceful,puzzle,housing,
    catalogHousing:housing && !scienceFiction,
  }
}

/** Deterministic theme fixes the builder often forgets; every change is reported. */
export function applyThemeDefaults(scene: ThreeSceneDocument, request: string): { document: ThreeSceneDocument; notes: string[] } {
  const intent = sceneIntent(request), notes: string[] = []
  if (intent.topology !== 'space') return { document: scene, notes }
  const environment = { ...scene.environment }
  if (environment.sky !== 'space') { environment.sky = 'space'; environment.background = '#020308'; notes.push('O céu foi trocado pelo campo de estrelas do espaço sideral.') }
  const deck = scene.nodes.some((node) => node.visible && node.collidable !== false && ['box', 'roundedBox', 'plane', 'extrude', 'mesh', 'cylinder'].includes(node.kind) && node.dimensions[0] >= 4 && node.dimensions[2] >= 4)
  const player = { spawn: null, yaw: 0, speed: 4.5, jumpHeight: 1.1, mode: 'walk' as const, ...environment.player }
  if (!deck && (player.mode !== 'fly' || player.allowFly === false)) { environment.player = { ...player, mode: 'fly', allowFly: true }; notes.push('O jogador começa em voo livre, pois não há convés para caminhar no espaço.') }
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
    if(/\b(plataformas? moveis|moving platforms?)\b/.test(text) && !raised.some(item=>{
      for(let current:typeof item.node|undefined=item.node;current;current=current.parentId?byId.get(current.parentId):undefined) if(current.animation.kind!=='none') return true
      return false
    })) issues.push('O pedido inclui plataformas móveis, mas os apoios estão estáticos: implemente movimento observável por animação, com apoio e percurso utilizáveis.')
  }
  return issues
}

const themes: { pattern: RegExp; brief: string }[] = [
  { pattern: /\b(floresta|florestas|bosque|mata|forest|woods|woodland)\b/, brief: 'FLORESTA: terreno biome="forest" (rolling ou ridged); dossel denso com vários templates scatter de tree e pine com seeds diferentes (60–250 árvores no total), sub-bosque com bush, flowerBed, log, stump, mushroom e rock; trilhas com roads texture "sand" ou "rock"; clareiras como pontos de interesse; neblina 0,006–0,014 e sol 25–50° para feixes entre as copas. À noite, cogumelos lit=true e vaga-lumes emissivos (esferas pequenas com float, collidable=false).' },
  { pattern: /\b(selva|jungle|rainforest|tropical|amazonia|amazon)\b/, brief: 'SELVA/TROPICAL: biome="tropical", relevo rolling com rios (plane com texture water) e cachoeiras (box/plane emissivo azulado com transparência), vegetação muito densa (tree com primary verde-escuro, palm, bush), cipós (tube), ruínas cobertas (column, rock) e neblina 0,008–0,015.' },
  { pattern: /\b(praia|praias|beach|litoral|coast|ilha tropical|tropical island|caribe|caribbean)\b/, brief: 'PRAIA/ILHA: terreno biome="tropical" com closed=true e um plane grande com texture water ligeiramente acima da cota baixa; faixa de areia, palm em grupos, rock, boat, barracas/tent, sinalização e piers (box com wood). Sol alto (40–60°) ou pôr do sol.' },
  { pattern: /\b(deserto|desert|dunas?|dunes|oasis|saara|sahara)\b/, brief: 'DESERTO: biome="desert", terrainStyle="dunes", cactus e rock esparsos, oásis com plane water, palm e tent; ruínas com column; céu day/sunset, neblina leve quente (0,002–0,005).' },
  { pattern: /\b(neve|nevad\w*|inverno|winter|snow\w*|tundra|artic\w*|arctic|glacial|geleira|glacier|polo norte|north pole)\b/, brief: 'NEVE/INVERNO: biome="snow" (ou alpine para montanhas), pine em agrupamentos com primary claro, rock, lagos congelados (plane com color #dff3ff, roughness 0,1, clearcoat 1), tent e campfire lit=true como ponto quente; céu overcast ou sunset baixo, neblina 0,006–0,012.' },
  { pattern: /\b(pantano|swamp|brejo|marsh|mangue|mangrove)\b/, brief: 'PÂNTANO: biome="swamp" com relevo baixo, poças com plane water escuro (#4c5a3a), log, stump, mushroom, árvores tortas (tree primary oliva), neblina densa 0,012–0,02 e céu overcast.' },
  { pattern: /\b(vulcao|vulcoes|volcan\w*|lava|magma)\b/, brief: 'VULCÂNICO: biome="volcanic", terrainStyle="ridged", rios de lava como plane/extrude com emissive laranja (2–6) e behavior hazard, rocks escuros, crystalCluster lit, céu sunset ou night, bloom 0,6–1,2 e neblina avermelhada.' },
  { pattern: /\b(oceano|ocean|fundo do mar|seabed|underwater|subaquatic\w*|submarin\w*|recife|reef|atlantida|atlantis)\b/, brief: 'SUBAQUÁTICO: chão de terreno biome="tropical" ou desert (areia), coral, seaweed, rock e crystalCluster espalhados, cardumes como esferas/cápsulas pequenas com animation orbit/float (collidable=false), raios de luz com spot fraco; environment.sky="overcast" ou "night", background azul-esverdeado, fog 0,02–0,04 e player.mode="fly" (nadar).' },
  { pattern: /\b(caverna|cavernas|cave|caves|gruta|mina|mine|subterrane\w*)\b/, brief: 'CAVERNA: paredes e teto de polyhedron/extrude com texture rock e flatShading, chão irregular, crystalCluster lit=true como iluminação principal, torch, estalactites (cone invertido), passagens ≥1,5 m e céu night com neblina escura.' },
  { pattern: /\b(cidade|metropole|metropolis|urban\w*|city|downtown|bairro|avenidas?|ruas)\b/, brief: 'CIDADE: chão plane com texture asphalt e calçadas (box concrete), quarteirões em grade com skyscraper (alturas e cores variadas), roads largas, car estacionados, lampPost lit, bench, árvores de rua, placas (sign). À noite use lit=true nas janelas, bloom 0,6–1,0 e luzes de poste.' },
  { pattern: /\b(ruinas|ruins|templo|temple|antig[oa]s?|ancient|grecia|roma|maia|maya|asteca|aztec)\b/, brief: 'RUÍNAS/TEMPLO: column (seeds múltiplas de 3 geram colunas quebradas), escadarias (box em linear), plataformas de pedra com texture rock/marble, rock e vegetação invasora, crystalCluster ou gem como relíquias.' },
  { pattern: /\b(acampamento|camping|camp|trilha|trail)\b/, brief: 'ACAMPAMENTO: tent em semicírculo, campfire lit=true no centro, log como bancos, lanternas (torch), árvores ao redor e trilhas.' },
  { pattern: /\b(lua|lunar|moon|marte|mars|marciano|martian|planeta alienigena|alien planet|exoplaneta|exoplanet|crateras?|craters?)\b/, brief: 'SUPERFÍCIE PLANETÁRIA: terreno biome="lunar" (Lua), "desert" com color avermelhado (Marte) ou "alien" (exoplaneta), terrainStyle ridged/dunes, crateras como lathe/torus baixos, rocket, módulos/cúpulas (sphere metade enterrada, transmissão), antenas (satellite pousado), crystalCluster; céu "space" com planet grande ao fundo (scale alto, longe) ou sunset alienígena; gravidade normal de caminhada.' },
]
/** Concrete, catalogue-aware hints for every theme recognised in the request. */
export function themeBrief(request: string): string {
  const text = normalize(request)
  return themes.filter((theme) => theme.pattern.test(text)).slice(0, 4).map((theme) => theme.brief).join('\n')
}

export function directionBrief(request: string): string {
  const intent = sceneIntent(request)
  const architecture = intent.catalogHousing
  if (!intent.world && !intent.game && !architecture) return themeBrief(request) ? `\nDIREÇÃO TEMÁTICA:\n${themeBrief(request)}` : ''
  const topology={
    landscape:'Organize a paisagem pelos pontos de interesse solicitados; vegetação só quando fizer parte do ambiente. Preserve espaços vazios intencionais e circulação.',
    interior:'INTERIORES: componha salas, corredores e acessos com pisos sólidos, paredes com espessura, aberturas reais, teto e iluminação prática. Diferencie cada setor por função, silhueta, sinalização e equipamento apropriado. Conectividade significa portas, passagens e escadas; não pinte estradas por cima do piso e não acrescente gramado externo.',
    platforms:'PLATAFORMAS/PARKOUR: construa início seguro, apoios sólidos de tamanhos e alturas legíveis, progressão de saltos, recuperação/checkpoints e chegada. Respeite jumpHeight e velocidade do jogador: saltos exigem distâncias alcançáveis. Caminho conceitual inclui saltos e plataformas móveis; não una todos os apoios com estradas contínuas nem preencha vãos destinados ao desafio.',
    arena:'ARENA: disponha chegada protegida, área de confronto, coberturas com rotas laterais e destino legível. Dimensione obstáculos para a câmera e circulação. Materiais, equipamentos e silhuetas seguem o tema; uma arena não implica vila, bosque ou relevo natural.',
    space:'ESPAÇO SIDERAL: não há chão natural nem gravidade aparente. Use environment.sky="space", background escuro, player.mode="fly" com allowFly=true e spawn livre de objetos. Distribua planetas (prefab planet, size 3–5 e escala do grupo até 20 para gigantes), luas, cinturões de asteroides (asteroid com repeat scatter e offset Y diferente de zero para volume 3D), naves (spaceship), satélites, estação (spaceStation) e uma estrela emissiva intensa com luz pontual de alcance amplo. Mantenha distâncias grandes entre corpos celestes e órbitas com animation orbit. Nada de terreno, estradas, árvores ou casas.',
    open:'Organize os espaços e acessos conforme o lugar solicitado, incluindo marcos, estruturas e detalhes próprios desse tema. Não adicione casas, árvores ou cenário rural por padrão.',
  }[intent.topology]
  return `\nDIREÇÃO DE PRODUÇÃO: preserve o gênero e o lugar solicitados. Escolha um marco visual, paleta coerente e materiais apropriados; construa as massas principais e depois detalhes que expressem a função de cada espaço. Prefabs opcionais são componentes, não um tema obrigatório; crie geometrias próprias quando o catálogo não representa o pedido.
${topology}
${intent.topology==='landscape' && !intent.flat ? 'Use relevo real com geometry.terrainStyle (rolling/ridged/terraced/dunes) e geometry.biome coerente; diferencie chão, rocha e encostas. Reserve apoios caminháveis para construções e conecte acessos externos com roads quando necessário.' : ''}
${themeBrief(request)}
${intent.scienceFiction?'FICÇÃO CIENTÍFICA: use módulos, painéis, estruturas técnicas, dutos, consoles e luzes práticas coerentes com a função e a época. Emissivos complementam a iluminação; não substitua instalações futuristas por casas rurais recoloridas.':''}
${intent.combat?'COMBATE: implemente inimigos funcionais com behavior.type=enemy e parâmetros de patrulha/perseguição/contato adequados, protegendo o spawn. Use o tipo de objetivo pedido, mesmo quando derrotar inimigos é apenas parte do percurso. Não apresente armas decorativas como um sistema de disparo funcional.':''}
${intent.puzzle?'QUEBRA-CABEÇA: implemente uma relação ação → efeito observável. Interruptores/alavancas precisam atingir objetos reais por interaction.targetId com toggleAnimation/toggleVisibility, sem bloquear definitivamente a única saída. Mensagens e decoração sozinhas não são um puzzle funcional.':''}
${intent.game ? 'Entregue a atividade e a condição de conclusão solicitadas, com controles e percurso legíveis, usando mecânicas realmente implementadas pelo runtime.' : 'A exploração pode ser livre, sem impor coleta ou combate.'}
${intent.peaceful?'O pedido exclui inimigos ou combate: mantenha a exploração tranquila.':''}
${architecture ? 'ARQUITETURA: planeje plantas e volumetrias antes de distribuir casas. Escolha building.style/floors/width/depth explicitamente e mantenha escala humana. Em vilas use ao menos três silhuetas coerentes com a época; distribua portas voltadas para ruas e ligue os acessos ao caminho. Reserve um envelope de largura+3 e profundidade+4 metros por casa. Não entregue fileiras do mesmo prefab com cores diferentes. Pedidos de sobrado exigem floors=2. Preserve interiores mobiliados e circulação.' : ''}
Revise antes de responder: identidade do gênero, escala humana, silhuetas, materiais, acessos, iluminação e correspondência entre objetivo e mecânicas. Crie terreno e habitações somente quando pertencem ao pedido.`
}
