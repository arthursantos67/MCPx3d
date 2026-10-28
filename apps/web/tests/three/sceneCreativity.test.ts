import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyThemeDefaults, creativeIdeas, directionBrief, reviewSceneDirection, sceneIntent, themeBrief, themeEnemies } from '../../src/three/sceneDirection.ts'
import { createEmptyScene, createNode, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import type { PrefabSpec } from '../../src/three/scenePrefabs.ts'
import { generateThreeScene } from '../../src/three/sceneGeneration.ts'
import { createCombatArenaScene, createEnchantedForestScene, createLabPuzzleScene, createPlatformCourseScene, createSolarSystemScene, creationIdeas } from '../../src/three/sceneExperiences.ts'
import { createArchitectureScene, createValleyScene } from '../../src/three/sceneShowcase.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

const box=(id:string,position:[number,number,number],patch:Partial<SceneNode>={}):SceneNode=>({...createNode('box'),id,name:id,position,...patch})
const floor=(size=30):SceneNode=>({...createNode('box'),id:'floor',name:'Piso',position:[0,-0.25,0],dimensions:[size,0.5,size]})
const asset=(type:string,text=''):PrefabSpec=>({type,size:1,seed:1,primary:null,secondary:null,text,lit:false,interactive:false} as PrefabSpec)
const group=(id:string,position:[number,number,number],patch:Partial<SceneNode>={}):SceneNode=>({...createNode('group'),id,name:id,position,...patch})
const enemy=(id:string,patch:Partial<SceneNode>={}):SceneNode=>group(id,[0,0,-10],{behavior:{type:'enemy',speed:2,range:8,damage:10},...patch})
const scene=(nodes:SceneNode[],environment:Partial<ThreeSceneDocument['environment']>={}):ThreeSceneDocument=>({...createEmptyScene(),nodes:[floor(),...nodes,...Array.from({length:6},(_,i)=>box(`prop-${i}`,[i*2-5,0.5,4]))],environment:{...createEmptyScene().environment,...environment}})
const newMarkers=['não há personagens','não têm o que dizer','slimes genéricos','Progresso bloqueado','chaves ou passagens','desarmado','sobrevivência','survive','chefe pedido','lança o jogador','corrida contra o relógio','vazio para o seu tamanho']

test('new genre intents are recognised without changing the classic examples', () => {
  const shooter=sceneIntent('Crie um shooter cyberpunk com blaster contra drones hostis')
  assert.equal(shooter.shooter,true); assert.equal(shooter.weapon,'blaster'); assert.equal(shooter.combat,true); assert.equal(shooter.game,true)
  assert.equal(sceneIntent('Uma floresta onde o jogador caça com arco e flechas').weapon,'bow')
  assert.equal(sceneIntent('Um castelo medieval: atire nos orcs das muralhas').weapon,'bow','fantasy shooting falls back to a bow')
  assert.equal(sceneIntent('Um mago com cajado enfrenta goblins').weapon,'staff')
  const horde=sceneIntent('Modo horda: sobreviva a ondas de zumbis no cemitério')
  assert.equal(horde.survival,true); assert.equal(horde.combat,true); assert.equal(horde.topology,'landscape')
  const boss=sceneIntent('Uma masmorra com um dragão como chefe final')
  assert.equal(boss.boss,true); assert.equal(boss.topology,'interior')
  const village=sceneIntent('Uma vila medieval com aldeões, mercado e missões')
  assert.equal(village.npcs,true); assert.equal(village.quest,true); assert.equal(village.game,true)
  assert.equal(sceneIntent('Uma feira movimentada no vilarejo').npcs,true)
  assert.equal(sceneIntent('Corrida contra o relógio pelas montanhas').race,true)
  assert.equal(sceneIntent('Um assalto furtivo ao cofre do banco').stealth,true)
  assert.equal(sceneIntent('Um coliseu de gladiadores').topology,'arena')
  assert.equal(sceneIntent('Uma cripta antiga com catacumbas').topology,'interior')
  assert.equal(sceneIntent('Um platformer com jump pads').launchers,true)
  assert.equal(sceneIntent('Um baú trancado e a chave escondida').keys,true)
  const calm=sceneIntent('Uma floresta tranquila sem inimigos onde se pratica arco e flecha')
  assert.equal(calm.peaceful,true); assert.equal(calm.shooter,false); assert.equal(calm.combat,false)
  for (const [title, request] of creationIdeas) {
    const intent=sceneIntent(request)
    assert.deepEqual([intent.shooter,intent.survival,intent.boss,intent.race,intent.stealth,intent.npcs],[false,false,false,false,false,false],title)
  }
  assert.equal(sceneIntent('Vila em um vale para explorar e coletar cristais').npcs,false,'a plain village does not demand inhabitants')
})

test('theme briefs cover the new settings and game modes with catalogue names', () => {
  const cases:[string,string][]=[
    ['Um castelo medieval numa colina','CASTELO/REINO MEDIEVAL'],['Uma feira no vilarejo','VILA/MERCADO'],['Uma enseada pirata','ENSEADA PIRATA'],
    ['Um cemitério assombrado','ASSOMBRADO'],['Uma cripta subterrânea','MASMORRA/CRIPTA'],['Uma cidade cyberpunk neon','CYBERPUNK'],
    ['Um laboratório secreto','BASE SCI-FI'],['Uma terra devastada pós-apocalíptica','PÓS-APOCALÍPTICO'],['Um jardim japonês com templo','JAPÃO'],
    ['Uma cidade do velho oeste','VELHO OESTE'],['Uma cidade steampunk','STEAMPUNK'],['Uma terra dos doces','TERRA DOS DOCES'],
    ['Uma selva com dinossauros','PRÉ-HISTÓRICO'],['Uma vila de natal','VILA DE INVERNO'],['Um coliseu','ARENA/COLISEU'],
    ['Uma corrida contra o relógio','CORRIDA'],['Modo horda de sobrevivência','SOBREVIVÊNCIA'],['Um assalto furtivo ao cofre','FURTIVIDADE'],['Batalha contra um dragão','CHEFE'],
  ]
  for (const [request,header] of cases) assert.ok(themeBrief(request).includes(header),request)
  assert.match(themeBrief('Um castelo medieval'),/castleWall.*gate/)
  assert.match(themeBrief('Um cemitério assombrado'),/tombstone/)
  assert.ok(themeBrief('Um castelo medieval com mercado, piratas, cemitério assombrado, cripta e dragão').split('\n').length<=5)
  assert.equal(themeBrief('Um cubo vermelho'),'')
  assert.deepEqual(themeEnemies('Uma masmorra escura'),['skeleton'])
  assert.ok(themeEnemies('Uma base lunar').includes('turret'))
  assert.ok(themeEnemies('Uma floresta sombria').includes('wolf'))
})

test('direction briefs add genre guidance for weapons, quests, survival, bosses, races and platforms', () => {
  assert.match(directionBrief('Crie um shooter sci-fi com inimigos'),/weapon="blaster"/)
  assert.match(directionBrief('Crie uma vila com aldeões que dão missões'),/RPG\/NPCS/)
  assert.match(directionBrief('Crie um modo horda para sobreviver'),/type:"survive"/)
  assert.match(directionBrief('Crie uma arena com chefe final'),/CHEFE: um único dragon/)
  assert.match(directionBrief('Crie uma corrida contra o relógio'),/CORRIDA: checkpoints/)
  assert.match(directionBrief('Crie um platformer com saltos'),/movingPlatform/)
  assert.match(directionBrief('Crie uma masmorra com inimigos'),/Arquétipos do tema: skeleton/)
  assert.match(directionBrief('Crie uma masmorra com uma porta trancada e chave'),/CHAVES/)
  assert.match(directionBrief('Crie uma floresta'),/pontos de interesse com micro-história/)
  assert.ok(!directionBrief('Crie uma floresta sem inimigos').includes('COMBATE'))
})

test('review finds missing inhabitants, silent NPCs, generic slimes and blocked keys', () => {
  const market='Crie uma vila medieval com mercado movimentado e aldeões'
  assert.ok(reviewSceneDirection(scene([]),market).some(issue=>issue.includes('não há personagens')))
  const silent=scene([group('seller',[3,0,0],{behavior:{type:'npc',speed:0.5,range:4,damage:0}})])
  assert.ok(reviewSceneDirection(silent,market).some(issue=>issue.includes('não têm o que dizer')))
  const talking=scene([group('seller',[3,0,0],{behavior:{type:'npc',speed:0.5,range:4,damage:0}}),
    {...createNode('capsule','seller'),id:'seller-body',interaction:{trigger:'click',key:'',radius:3,action:'dialogue',targetId:null,message:'Bom dia!|Procura algo?'}}])
  assert.ok(!reviewSceneDirection(talking,market).some(issue=>issue.includes('personagens') || issue.includes('o que dizer')))
  const asNpcAsset=scene([group('mage',[3,0,0],{asset:asset('wizard','Saudações, viajante|O amuleto sumiu')})])
  assert.ok(!reviewSceneDirection(asNpcAsset,market).some(issue=>issue.includes('personagens') || issue.includes('o que dizer')))

  const dungeon='Crie uma masmorra com inimigos e uma saída'
  const slimes=scene([enemy('a',{asset:asset('enemy')}),enemy('b',{asset:asset('enemy')})])
  assert.ok(reviewSceneDirection(slimes,dungeon).some(issue=>issue.includes('slimes genéricos') && issue.includes('skeleton')))
  assert.ok(!reviewSceneDirection({...slimes,nodes:slimes.nodes.map(node=>node.id==='b'?{...node,asset:asset('skeleton')}:node)},dungeon).some(issue=>issue.includes('slimes')))
  assert.ok(!reviewSceneDirection(slimes,'Crie uma arena com inimigos').some(issue=>issue.includes('slimes')),'no archetype is imposed without a theme')

  const lock=(requires:string)=>box('door',[0,1,-6],{interaction:{trigger:'click',key:'',radius:3,action:'toggleVisibility',targetId:null,message:'Aberta',requires}})
  const blocked=scene([lock('Chave de ferro')])
  assert.ok(reviewSceneDirection(blocked,'Crie uma masmorra jogável').some(issue=>issue.includes('Progresso bloqueado') && issue.includes('Chave de ferro')))
  const keyed=scene([lock('Chave de ferro'),box('key',[2,0.5,2],{interaction:{trigger:'proximity',key:'',radius:2,action:'collect',targetId:null,message:'Chave!',item:'chave de ferro'}})])
  assert.ok(!reviewSceneDirection(keyed,'Crie uma masmorra jogável').some(issue=>issue.includes('Progresso bloqueado')))
  const gate=scene([group('gate',[0,0,-8],{asset:asset('gate','Chave dourada')}),group('key',[3,0,3],{asset:asset('key')})])
  assert.ok(!reviewSceneDirection(gate,'Crie uma masmorra jogável').some(issue=>issue.includes('Progresso bloqueado')),'the key prefab provides the default golden key')
  assert.ok(reviewSceneDirection(scene([group('gate',[0,0,-8],{asset:asset('gate','Selo rúnico')})]),'Crie uma masmorra jogável').some(issue=>issue.includes('Selo rúnico')))
  const spare=scene([box('relic',[2,0.5,2],{interaction:{trigger:'proximity',key:'',radius:2,action:'collect',targetId:null,message:'Relíquia',item:'Relíquia'}})])
  assert.ok(!reviewSceneDirection(spare,'Crie uma masmorra jogável').some(issue=>issue.includes('Progresso bloqueado')),'a collected item that nothing requires is fine')
  assert.ok(reviewSceneDirection(spare,'Crie uma masmorra jogável com porta trancada e chave').some(issue=>issue.includes('chaves ou passagens')))
})

test('review checks weapons, survival waves, bosses, launchers, races and empty large worlds', () => {
  const shooter='Crie um shooter sci-fi numa arena com inimigos'
  const armed=(weapon:'none'|'blaster')=>scene([enemy('drone')],{player:{...createEmptyScene().environment.player!,weapon}})
  assert.ok(reviewSceneDirection(armed('none'),shooter).some(issue=>issue.includes('desarmado')))
  assert.ok(!reviewSceneDirection(armed('blaster'),shooter).some(issue=>issue.includes('desarmado')))

  const survive=(delay:number,timeLimit:number)=>scene([enemy('wave',{behavior:{type:'enemy',speed:2,range:8,damage:10,delay}})],{objective:{type:'survive',title:'Resista',timeLimit}})
  const waves=reviewSceneDirection(survive(0,0),'Crie uma arena de sobrevivência')
  assert.ok(waves.some(issue=>issue.includes('não tem ondas')) && waves.some(issue=>issue.includes('timeLimit')))
  assert.ok(!reviewSceneDirection(survive(20,120),'Crie uma arena de sobrevivência').some(issue=>issue.includes('ondas') || issue.includes('timeLimit')))
  assert.ok(reviewSceneDirection(scene([enemy('a')],{objective:{type:'defeatEnemies',title:'Derrote',timeLimit:0}}),'Crie uma arena de sobrevivência').some(issue=>issue.includes('objective.type="survive"')))

  assert.ok(reviewSceneDirection(scene([enemy('a')]),'Crie uma arena com chefe final').some(issue=>issue.includes('chefe pedido')))
  assert.ok(!reviewSceneDirection(scene([enemy('a',{asset:asset('dragon')})]),'Crie uma arena com chefe final').some(issue=>issue.includes('chefe pedido')))
  assert.ok(!reviewSceneDirection(scene([enemy('a',{behavior:{type:'enemy',speed:2,range:8,damage:30,health:40}})]),'Crie uma arena com chefe final').some(issue=>issue.includes('chefe pedido')))

  assert.ok(reviewSceneDirection(scene([]),'Crie uma fase com jump pads até a torre').some(issue=>issue.includes('lança o jogador')))
  assert.ok(!reviewSceneDirection(scene([group('pad',[2,0,2],{asset:asset('jumpPad')})]),'Crie uma fase com jump pads até a torre').some(issue=>issue.includes('lança o jogador')))
  const goal=box('goal',[0,0.5,-12],{behavior:{type:'goal',speed:0,range:1,damage:0}})
  assert.ok(reviewSceneDirection(scene([goal],{objective:{type:'reachGoal',title:'Corra',timeLimit:0}}),'Crie uma corrida contra o relógio').some(issue=>issue.includes('corrida contra o relógio')))
  assert.ok(!reviewSceneDirection(scene([goal],{objective:{type:'reachGoal',title:'Corra',timeLimit:90}}),'Crie uma corrida contra o relógio').some(issue=>issue.includes('corrida contra o relógio')))

  const terrain:SceneNode={...createNode('terrain'),id:'ground',dimensions:[120,4,120]}
  const sparse={...createEmptyScene(),nodes:[terrain,...Array.from({length:6},(_,i)=>box(`rock-${i}`,[i*8-20,1,0]))]}
  assert.ok(reviewSceneDirection(sparse,'Crie uma paisagem de montanhas').some(issue=>issue.includes('vazio para o seu tamanho')))
  const dense={...sparse,nodes:[terrain,...Array.from({length:60},(_,i)=>box(`rock-${i}`,[(i%10)*10-45,1,Math.floor(i/10)*10-25]))]}
  assert.ok(!reviewSceneDirection(dense,'Crie uma paisagem de montanhas').some(issue=>issue.includes('vazio')))
  const small={...createEmptyScene(),nodes:[{...terrain,dimensions:[30,2,30] as [number,number,number]},...Array.from({length:5},(_,i)=>box(`rock-${i}`,[i*3-6,1,0]))]}
  assert.ok(!reviewSceneDirection(small,'Crie uma paisagem de montanhas').some(issue=>issue.includes('vazio')),'small scenes are not judged by density')
})

test('the new heuristics stay silent on the curated example scenes', () => {
  const examples:[ThreeSceneDocument,string][]=[
    [createCombatArenaScene(),creationIdeas[0][1]],[createPlatformCourseScene(),creationIdeas[1][1]],[createLabPuzzleScene(),creationIdeas[2][1]],
    [createSolarSystemScene(),creationIdeas[3][1]],[createEnchantedForestScene(),creationIdeas[4][1]],
    [createValleyScene(),'Vila em um vale para explorar e coletar cristais'],[createArchitectureScene(),'Uma casa de artesão com dois andares mobiliada'],
  ]
  for (const [example,request] of examples) {
    const issues=reviewSceneDirection(example,request)
    assert.deepEqual(issues.filter(issue=>newMarkers.some(marker=>issue.includes(marker))),[],example.name)
  }
})

test('theme defaults apply explicit weather, mood, audio, weapons and survival time with notes', () => {
  const base=scene([enemy('a')])
  const rainy=applyThemeDefaults(base,'Uma cidade cyberpunk à noite com chuva')
  assert.equal(rainy.document.environment.weather,'rain')
  assert.equal(rainy.document.environment.audio?.ambience,'rain')
  assert.ok(rainy.notes.some(note=>note.includes('chuva')))
  assert.equal(applyThemeDefaults(base,'Uma vila na neve').document.environment.weather,'snow')
  assert.equal(applyThemeDefaults(base,'Uma floresta tropical (rainforest)').document.environment.weather,'none','rainforest is not rain')
  const kept=applyThemeDefaults({...base,environment:{...base.environment,weather:'fireflies'}},'Uma floresta com chuva')
  assert.equal(kept.document.environment.weather,'fireflies','an explicit weather from the builder is preserved')
  assert.equal(applyThemeDefaults(base,'Um cemitério assombrado em preto e branco').document.environment.grade,'noir')
  assert.equal(applyThemeDefaults(base,'Um cemitério assombrado').document.environment.audio?.music,'spooky')
  assert.deepEqual(applyThemeDefaults(base,'Uma praça sem som').document.environment.audio,{ambience:'none',music:'none',volume:0.7})
  const armed=applyThemeDefaults(base,'Crie um jogo de tiro com blaster contra robôs')
  assert.equal(armed.document.environment.player?.weapon,'blaster')
  assert.ok(armed.notes.some(note=>note.includes('arma')))
  assert.equal(applyThemeDefaults(base,'Uma estátua de cavaleiro com espada numa praça').document.environment.player?.weapon,'none','decorative weapons do not arm the player')
  assert.equal(applyThemeDefaults(base,'Crie uma arena de duelo de espadas contra orcs').document.environment.player?.weapon,'sword')
  const timed=applyThemeDefaults({...base,environment:{...base.environment,objective:{type:'survive',title:'Resista',timeLimit:0}}},'Crie uma arena')
  assert.equal(timed.document.environment.objective?.timeLimit,120)
  const plain=applyThemeDefaults(base,'Uma caixa de madeira')
  assert.equal(plain.document,base)
  assert.deepEqual(plain.notes,[])
  const space=applyThemeDefaults(base,'Uma cena no espaço sideral com chuva de meteoros')
  assert.equal(space.document.environment.sky,'space')
  assert.equal(space.document.environment.weather,'none','space keeps its starfield without weather')
})

test('the builder system prompt documents the new catalogue, mechanics, audio and creative direction', async () => {
  let system=''
  const provider={generateStructured:async(messages:{role:string;content:string}[])=>{system||=messages[0].content;throw new Error('parar')}} as unknown as LLMProvider
  await generateThreeScene(provider,'Uma caixa de madeira',new AbortController().signal).catch(()=>{})
  for (const expected of ['DIREÇÃO CRIATIVA','pontos de interesse','weapon none|sword|axe|blaster|bow|staff','avatar explorer|knight|wizard|astronaut|robot','villager, knight, wizard, astronaut',
    'dragon','movingPlatform','jumpPad','powerOrb','requires','dialogue','survive','delay','flying','node.sound','weather none|rain','grade none|warm','music calm','castleWall','turret'])
    assert.ok(system.includes(expected),expected)
  assert.ok(!system.includes('disparos/projéteis'),'weapons are no longer described as missing')
  for (const expected of ['prefab.character={age child|young|adult|elder','hairStyle auto|bald','beard auto|none|short|long','nunca repita o mesmo modelo','behavior.routine (só npc',
    'activity wander|work|sit|chat|patrol|guard|sleep|perform','marketStall, bench, well','reaction greet','node.emitter={preset fire|smoke|sparks','smoke em chaminés','sparks na bigorna',
    'motion={wind 0–2','fauna auto|none|rich','dayCycle={enabled,duration 60–7200','environment.premise ≤240'])
    assert.ok(system.includes(expected),expected)
  assert.ok(system.length<17000,`the builder prompt stays compact (${system.length} chars)`)
})

test('the edit prompt lists the 1.4 fields it can change', async () => {
  let system=''
  const provider={generateStructured:async(messages:{role:string;content:string}[])=>{system||=messages[0].content;throw new Error('parar')}} as unknown as LLMProvider
  const { editThreeScene }=await import('../../src/three/sceneGeneration.ts')
  await editThreeScene(provider,scene([]),'Adicione fumaça na chaminé',new AbortController().signal,{mode:'edit'}).catch(()=>{})
  for (const expected of ['updates aceitam emitter','routine/reaction','prefab.character','motion, dayCycle e premise']) assert.ok(system.includes(expected),expected)
})

test('the 1.4 life heuristics stay silent on the curated example scenes, including the inhabited market', async () => {
  const { createCryptScene, createMarketTownScene }=await import('../../src/three/sceneExperiences.ts')
  const markers=['só passeiam','local inexistente ou oculto','sem lugar','cópias idênticas','passagem do dia','vento está fraco']
  const examples:[ThreeSceneDocument,string][]=[
    [createMarketTownScene(),'Crie uma vila medieval em dia de feira com aldeões comerciantes e missões'],[createCryptScene(),'Crie uma cripta com esqueletos e um portão trancado'],
    [createCombatArenaScene(),creationIdeas[0][1]],[createEnchantedForestScene(),creationIdeas[4][1]],[createValleyScene(),'Vila em um vale para explorar e coletar cristais'],
  ]
  for (const [example,request] of examples) assert.deepEqual(reviewSceneDirection(example,request).filter(issue=>markers.some(marker=>issue.includes(marker))),[],example.name)
})

test('creative ideas are varied, rich prompts that exercise the new mechanics', () => {
  assert.equal(creativeIdeas.length,10)
  assert.equal(new Set(creativeIdeas.map(([title])=>title)).size,10)
  const intents=creativeIdeas.map(([,request])=>sceneIntent(request))
  for (const [index,[title,request]] of creativeIdeas.entries()) {
    assert.ok(request.length>=180 && request.length<=600,title)
    assert.ok(intents[index].world || intents[index].game,title)
  }
  for (const flag of ['shooter','survival','npcs','keys','platforms','launchers','combat','peaceful'] as const) assert.ok(intents.some(intent=>intent[flag]),flag)
  assert.ok(intents.some(intent=>intent.topology==='interior') && intents.some(intent=>intent.topology==='landscape') && intents.some(intent=>intent.topology==='platforms'))
})
