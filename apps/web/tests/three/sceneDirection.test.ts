import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyThemeDefaults, sceneIntent, directionBrief, inferSceneAction, reviewSceneDirection } from '../../src/three/sceneDirection.ts'
import { createEmptyScene, createNode, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'

const floor=():SceneNode=>({...createNode('plane'),id:'floor',dimensions:[35,0.01,35],material:{...createNode('plane').material,texture:'metal'}})
const goal=():SceneNode=>({...createNode('box'),id:'goal',position:[8,0.5,0],behavior:{type:'goal',speed:0,range:1,damage:0}})
const arena=():ThreeSceneDocument=>({...createEmptyScene(),nodes:[floor(),goal()],environment:{...createEmptyScene().environment,objective:{type:'reachGoal',title:'Alcance a saída',timeLimit:0}}})
const enemy=():SceneNode=>({...createNode('capsule'),id:'enemy',position:[0,1,7],behavior:{type:'enemy',speed:2,range:7,damage:10}})

test('genre detection and production direction preserve non-residential worlds without prescribing village assets',()=>{
  const cases=[
    ['Crie uma estação espacial com corredores, laboratórios e interruptores.', 'interior'],
    ['Crie uma arena sci-fi com inimigos patrulhando e coberturas.', 'arena'],
    ['Crie um platformer com plataformas móveis, saltos e checkpoints.', 'platforms'],
    ['Crie uma masmorra de ruínas com salas, armadilhas e uma saída.', 'interior'],
    ['Crie uma cidade cyberpunk com prédios, vias elevadas e consoles.', 'open'],
  ] as const
  for(const [request,topology] of cases) {
    const intent=sceneIntent(request),brief=directionBrief(request)
    assert.equal(intent.topology,topology,request)
    assert.equal(intent.world,true,request)
    assert.equal(intent.catalogHousing,false,request)
    assert.equal(inferSceneAction(request,true),'create',request)
    assert.ok(!brief.includes('building.style/floors/width/depth'),request)
    assert.ok(!brief.includes('Use agrupamentos de vegetação'),request)
    assert.ok(!brief.includes('Use relevo real'),request)
  }
  assert.equal(sceneIntent('Uma vila num vale com casas mobiliadas e interiores acessíveis').topology,'landscape','house interiors do not turn an outdoor valley into an enclosed room')
  assert.equal(sceneIntent('Uma vila num vale com casas mobiliadas').catalogHousing,true)
})

test('combat requires functional enemies even when the objective is reachGoal; negation and spawn safety stay scoped',()=>{
  const request='Crie uma arena sci-fi com inimigos patrulhando, coberturas e uma saída. Sem inimigos no spawn.'
  assert.equal(sceneIntent(request).combat,true)
  const missing=reviewSceneDirection(arena(),request)
  assert.ok(missing.some(issue=>issue.includes('inimigos funcionais')))
  const ready={...arena(),nodes:[...arena().nodes,enemy()]}
  assert.deepEqual(reviewSceneDirection(ready,request),[])
  const hidden={...ready,nodes:[{...createNode('group'),id:'hidden',visible:false},...ready.nodes.map(node=>node.id==='enemy'?{...node,parentId:'hidden'}:node)]}
  assert.ok(reviewSceneDirection(hidden,request).some(issue=>issue.includes('inimigos funcionais')))
  for(const request of ['Crie uma arena para exploração sem inimigos.','Crie uma arena sem combate.','Crie uma arena; não deve ter inimigos.']) {
    assert.equal(sceneIntent(request).combat,false,request)
    assert.ok(!reviewSceneDirection(arena(),request).some(issue=>issue.includes('combate solicitado')),request)
    assert.ok(reviewSceneDirection(ready,request).some(issue=>issue.includes('exclui combate')),request)
  }
})

test('platform direction verifies solid elevated supports and requested movement without demanding terrain or paving',()=>{
  const request='Crie um jogo de plataformas móveis com saltos e um portal de chegada.'
  const bare=arena()
  assert.ok(reviewSceneDirection(bare,request).some(issue=>issue.includes('apoios elevados')))
  const platform=(id:string,x:number,y:number):SceneNode=>({...createNode('box'),id,position:[x,y,0],dimensions:[2,0.3,2]})
  const stationary={...bare,nodes:[...bare.nodes,platform('first',0,0.8),platform('second',3,1.4)]}
  assert.ok(!reviewSceneDirection(stationary,request).some(issue=>issue.includes('apoios elevados')))
  assert.ok(reviewSceneDirection(stationary,request).some(issue=>issue.includes('apoios estão estáticos')))
  const animatedParent={...createNode('group'),id:'motion',animation:{...createNode('group').animation,kind:'float' as const,amplitude:0.3}}
  const moving={...stationary,nodes:[animatedParent,...stationary.nodes.map(node=>node.id==='second'?{...node,parentId:'motion'}:node)]}
  assert.deepEqual(reviewSceneDirection(moving,request),[])
  const decorative={...moving,nodes:moving.nodes.map(node=>['first','second'].includes(node.id)?{...node,collidable:false}:node)}
  assert.ok(reviewSceneDirection(decorative,request).some(issue=>issue.includes('apoios elevados')))
})

test('puzzles require a real action and effect, rather than a message or toggling a nonexistent animation',()=>{
  const request='Crie um laboratório orbital de puzzles com interruptores e uma porta de saída.'
  const scene=arena(),door={...createNode('box'),id:'door',dimensions:[2,3,0.2] as [number,number,number]}
  const button:SceneNode={...createNode('box'),id:'switch',interaction:{trigger:'key',key:'g',radius:2,action:'message',targetId:null,message:'Porta aberta!'}}
  const messageOnly={...scene,nodes:[...scene.nodes,door,button]}
  assert.ok(reviewSceneDirection(messageOnly,request).some(issue=>issue.includes('ação com efeito')))
  const noAnimation={...messageOnly,nodes:messageOnly.nodes.map(node=>node.id==='switch'?{...node,interaction:{...node.interaction!,action:'toggleAnimation' as const,targetId:'door'}}:node)}
  assert.ok(reviewSceneDirection(noAnimation,request).some(issue=>issue.includes('ação com efeito')))
  const functional={...noAnimation,nodes:noAnimation.nodes.map(node=>node.id==='switch'?{...node,interaction:{...node.interaction!,action:'toggleVisibility' as const}}:node)}
  assert.deepEqual(reviewSceneDirection(functional,request),[])
})

test('new settings keep the expected topology and moving platform prefabs satisfy the moving-platform review',()=>{
  for(const [request,topology] of [['Crie um coliseu com gladiadores','arena'],['Crie uma cripta com catacumbas','interior'],['Crie um cemitério assombrado à noite','landscape'],['Crie um castelo medieval com muralhas','open']] as const) {
    assert.equal(sceneIntent(request).topology,topology,request)
    assert.equal(sceneIntent(request).world,true,request)
  }
  const request='Crie um jogo de plataformas móveis com saltos e um portal de chegada.'
  const platform=(id:string,x:number,y:number):SceneNode=>({...createNode('box'),id,position:[x,y,0],dimensions:[2,0.3,2]})
  const stationary={...arena(),nodes:[...arena().nodes,platform('first',0,0.8),platform('second',3,1.4)]}
  const prefab={...createNode('group'),id:'mover',position:[6,1,0] as [number,number,number],asset:{type:'movingPlatform' as const,size:1,seed:1,primary:null,secondary:null,text:'',lit:false,interactive:false}}
  assert.ok(!reviewSceneDirection({...stationary,nodes:[...stationary.nodes,prefab]},request).some(issue=>issue.includes('apoios estão estáticos')))
})

const person=(id:string,seed:number,patch:Partial<SceneNode>={}):SceneNode=>({...createNode('group'),id,name:id,position:[seed,0,3],
  asset:{type:'villager',size:1,seed,primary:null,secondary:null,text:'Olá!',lit:false,interactive:true},behavior:{type:'npc',speed:1,range:6,damage:0},...patch})
const stall=():SceneNode=>({...createNode('box'),id:'stall',name:'Barraca',position:[0,0.5,-4],dimensions:[3,1,2]})
const town=(nodes:SceneNode[]):ThreeSceneDocument=>({...createEmptyScene(),
  nodes:[{...floor(),dimensions:[30,0.01,30]},stall(),...Array.from({length:4},(_,i)=>({...createNode('box'),id:`crate-${i}`,position:[i*2-10,0.5,8] as [number,number,number]})),...nodes]})
const routine=(target:string|null,activity:'work'|'chat'='work')=>({type:'npc' as const,speed:1,range:6,damage:0,routine:[{activity,target,from:7,to:18}]})

test('1.4 direction: inhabited places need routines with real places and distinct people',()=>{
  const market='Crie uma feira medieval movimentada com comerciantes'
  const idle=town([person('a',1),person('b',2)])
  assert.ok(reviewSceneDirection(idle,market).some(issue=>issue.includes('só passeiam')))
  const working=town([person('a',1,{behavior:routine('stall')}),person('b',2)])
  assert.ok(!reviewSceneDirection(working,market).some(issue=>issue.includes('só passeiam') || issue.includes('sem lugar')))
  const loose=town([person('a',1,{behavior:routine(null)}),person('b',2)])
  assert.ok(reviewSceneDirection(loose,market).some(issue=>issue.includes('sem lugar')))
  assert.ok(!reviewSceneDirection(town([person('a',1,{behavior:routine(null,'chat')}),person('b',2)]),market).some(issue=>issue.includes('sem lugar')),'chatting may happen anywhere')
  const hidden=town([person('a',1,{behavior:routine('stall')}),person('b',2)])
  hidden.nodes=hidden.nodes.map(node=>node.id==='stall'?{...node,visible:false}:node)
  assert.ok(reviewSceneDirection(hidden,market).some(issue=>issue.includes('local inexistente ou oculto') && issue.includes('stall')))
  const ghost=town([person('a',1,{behavior:routine('castle')}),person('b',2)])
  assert.ok(reviewSceneDirection(ghost,market).some(issue=>issue.includes('local inexistente')),'documents built outside the validator are reviewed too')
  const clones=town([1,2,3].map(i=>person(`c${i}`,7,{position:[i*2,0,3],behavior:routine('stall')})))
  assert.ok(reviewSceneDirection(clones,market).some(issue=>issue.includes('cópias idênticas')))
  const ages=['child','adult','elder'] as const
  const varied=town([1,2,3].map(i=>person(`c${i}`,7,{position:[i*2,0,3],behavior:routine('stall'),
    asset:{...person('x',7).asset!,character:{age:ages[i-1],build:'average',height:1,style:'stylized',skin:null,hair:null,hairStyle:'auto',beard:'auto'}}})))
  assert.ok(!reviewSceneDirection(varied,market).some(issue=>issue.includes('cópias idênticas')),'archetypes alone make people distinct')
  assert.ok(!reviewSceneDirection(idle,'Crie uma floresta para explorar').some(issue=>issue.includes('só passeiam')),'wanderers outside settlements are fine')
})

test('1.4 direction: explicit day/night, wind and wildlife requests drive deterministic defaults and reviews',()=>{
  const scene=town([person('a',1)])
  for(const request of ['Uma vila com ciclo de dia e noite','Uma fazenda onde o tempo passa do amanhecer ao anoitecer','Sobreviva no cemitério até o amanhecer','A day/night cycle village'])
    assert.equal(sceneIntent(request).dayCycle,true,request)
  for(const request of ['Uma floresta ao anoitecer','Uma praia ao pôr do sol','Uma vila à noite']) assert.equal(sceneIntent(request).dayCycle,false,request)
  assert.ok(reviewSceneDirection(scene,'Uma vila com ciclo de dia e noite').some(issue=>issue.includes('passagem do dia')))
  const cycled=applyThemeDefaults(scene,'Uma vila com ciclo de dia e noite')
  assert.deepEqual(cycled.document.environment.dayCycle,{enabled:true,duration:600,start:9})
  assert.ok(cycled.notes.some(note=>note.includes('ciclo dia/noite')))
  assert.ok(!reviewSceneDirection(cycled.document,'Uma vila com ciclo de dia e noite').some(issue=>issue.includes('passagem do dia')))
  assert.equal(applyThemeDefaults(scene,'Um cemitério à noite até o amanhecer').document.environment.dayCycle?.start,20)
  const kept=applyThemeDefaults({...scene,environment:{...scene.environment,dayCycle:{enabled:true,duration:300,start:6}}},'Uma vila com dia e noite')
  assert.deepEqual(kept.document.environment.dayCycle,{enabled:true,duration:300,start:6},'an enabled cycle from the builder is preserved')
  assert.equal(applyThemeDefaults(scene,'Uma vila numa tarde comum').document,scene)

  assert.ok(reviewSceneDirection(scene,'Uma vila costeira durante uma tempestade').some(issue=>issue.includes('vento está fraco')))
  const stormy=applyThemeDefaults(scene,'Uma vila costeira durante uma tempestade')
  assert.equal(stormy.document.environment.motion?.wind,1.7)
  assert.ok(!reviewSceneDirection(stormy.document,'Uma vila costeira durante uma tempestade').some(issue=>issue.includes('vento')))
  assert.equal(applyThemeDefaults({...scene,environment:{...scene.environment,motion:{wind:1.9,grass:'auto',fauna:'auto'}}},'Ventania na vila').document.environment.motion?.wind,1.9)
  assert.deepEqual(applyThemeDefaults(scene,'Um vale sem animais e sem grama, sem vento').document.environment.motion,{wind:0,grass:'none',fauna:'none'})
  assert.equal(applyThemeDefaults(scene,'Uma lagoa com revoadas de pássaros').document.environment.motion?.fauna,'rich')
  assert.equal(applyThemeDefaults(scene,'Uma cena no espaço sideral durante uma tempestade solar').document.environment.motion,undefined,'space has no wind')
})

test('1.4 briefs suggest routines, emitters and world motion for each theme',()=>{
  assert.match(directionBrief('Crie uma feira medieval com comerciantes'),/VIDA DOS NPCS: .*prefab\.character/)
  assert.match(directionBrief('Crie uma feira medieval com comerciantes'),/work na própria marketStall/)
  assert.match(directionBrief('Crie um castelo medieval com muralhas'),/patrol na castleWall.*sparks/)
  assert.match(directionBrief('Crie um cemitério assombrado'),/grass none, fauna none/)
  assert.match(directionBrief('Crie uma cripta com catacumbas'),/fauna none/)
  assert.match(directionBrief('Crie uma praia tropical'),/fauna rich \(aves e peixes\)/)
  assert.match(directionBrief('Crie uma vila durante uma tempestade'),/MOVIMENTO: environment\.motion\.wind 1,5–2/)
  assert.match(directionBrief('Crie uma vila com ciclo de dia e noite'),/CICLO DIA\/NOITE: environment\.dayCycle/)
  assert.ok(!directionBrief('Crie uma vila tranquila').includes('CICLO DIA/NOITE'))
  assert.match(directionBrief('Crie uma estação espacial com corredores'),/fauna "none"/)
})
