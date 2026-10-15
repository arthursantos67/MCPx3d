import { createEmptyScene, createNode, validateScene, type NodeKind, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { expandSceneRecipe } from './sceneGeneration.ts'

const single={mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}
const node=(id:string,kind:NodeKind,position:Vector3Tuple,dimensions:Vector3Tuple,patch:Record<string,unknown>={})=>({...createNode(kind),id,name:id,position,dimensions,color:'#9aaebc',metalness:0.45,roughness:0.65,repeat:single,...patch})
const asset=(id:string,type:string,position:Vector3Tuple,patch:Record<string,unknown>={})=>node(id,'group',position,[1,1,1],{prefab:{type,size:1,seed:5,primary:null,secondary:null,text:'',lit:true,interactive:true},...patch})
const environment=(title:string,type:'explore'|'defeatEnemies'|'reachGoal',spawn:Vector3Tuple)=>({sky:'studio',shadows:true,ambientOcclusion:true,bloom:0.12,toneMapping:'agx',objective:{type,title,timeLimit:0},player:{spawn,yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk',allowFly:false,health:100,camera:'first'}})
const scene=(name:string,nodes:unknown[],env:Record<string,unknown>)=>expandSceneRecipe({name,nodes,environment:env,background:'#18212e',exposure:1.1,lightIntensity:1.2,duration:12})

/** A neutral starting workspace: no story, biome, houses, combat or mandatory game objective. */
export function createCreationStage():ThreeSceneDocument {
  const group={...createNode('group'),id:'creation-object',name:'Forma em construção'}
  const core={...createNode('polyhedron',group.id),id:'core',name:'Núcleo',position:[0,1.5,0] as Vector3Tuple,dimensions:[1.8,1.8,1.8] as Vector3Tuple,material:{color:'#397e91',metalness:0.7,roughness:0.28},geometry:{...createNode('polyhedron').geometry,detail:2}}
  const ring={...createNode('torus',group.id),id:'ring',name:'Órbita',position:[0,1.5,0] as Vector3Tuple,rotation:[65,20,0] as Vector3Tuple,dimensions:[3.8,3.8,0.15] as Vector3Tuple,material:{color:'#dcb679',metalness:0.7,roughness:0.35}}
  return validateScene({...createEmptyScene(),name:'Seu próximo jogo',nodes:[group,core,ring],environment:{...createEmptyScene().environment,grid:false,background:'#dbe6ec',objective:{type:'explore',title:'Escolha uma ideia ou descreva seu jogo',timeLimit:0}}})
}

/** Combat is an actual objective with pursuing enemies, cover and a return checkpoint. */
export function createCombatArenaScene():ThreeSceneDocument {
  const nodes:unknown[]=[node('arena-floor','box',[0,-0.25,0],[30,0.5,38],{color:'#34434f',surface:{texture:'tiles',textureScale:10}})]
  for(const side of [-1,1]) {
    nodes.push(node(`side-wall${side}`,'box',[side*15,2,0],[0.5,4,37.5],{surface:{texture:'metal'}}))
    nodes.push(node(`end-wall${side}`,'box',[0,2,side*19],[30,4,0.5],{surface:{texture:'metal'}}))
    for(let i=0;i<5;i++) nodes.push(node(`rib${side}-${i}`,'box',[side*14.55,2.2,i*7-14],[0.35,4.4,0.5],{color:'#7796ab'}))
    nodes.push(node(`light${side}`,'light',[side*8,3.6,0],[0.2,0.2,0.2],{light:{type:'point',color:side<0?'#72c9ff':'#ffa174',intensity:65,distance:24,angle:35,penumbra:0.5,castShadow:true}}))
  }
  for(const [i,[x,z]] of [[-6,0],[5,-5],[-5,-11],[8,7]].entries()) nodes.push(node(`cover-${i}`,'roundedBox',[x,0.85,z],[2.8,1.7,2.2],{color:'#647785',surface:{texture:'metal',normalStrength:0.3}}))
  nodes.push(asset('sentinel-a','sentinel',[-8,0,-10]),asset('sentinel-b','sentinel',[8,0,-12]),asset('crawler-a','crawler',[0,0,-9]),asset('checkpoint','checkpoint',[3,0,12]))
  nodes.push(node('arena-sign','text',[0,3,-18.65],[8,1,0.02],{geometry:{text:'CONTENÇÃO // SETOR 07'},color:'#9fdded',collidable:false}))
  return scene('Arena de contenção',nodes,environment('Derrote os três invasores · E para atacar', 'defeatEnemies',[0,0.02,13]))
}

/** A jump course over a lethal pit: no terrain, roads, houses or enemy requirement. */
export function createPlatformCourseScene():ThreeSceneDocument {
  const nodes:unknown[]=[node('pit','box',[0,-3.2,-1],[28,0.4,40],{color:'#271e38',behavior:{type:'hazard',speed:0,range:1,damage:100},surface:{emissive:'#88355a',emissiveIntensity:0.35}})]
  const pads:[number,number,number,number][]=[[0,12,0,6],[-1,7.4,0.4,3],[1.3,3.4,0.8,3],[-1, -0.6,1.2,3],[1.4,-4.6,1.6,3],[0,-9,2,6]]
  for(const [i,[x,z,y,size]] of pads.entries()) {
    nodes.push(node(`platform-${i}`,'roundedBox',[x,y-0.2,z],[size,0.4,size],{color:i%2?'#458e9a':'#6e78ad',surface:{texture:'metal',normalStrength:0.25}}))
    nodes.push(node(`edge-${i}`,'box',[x,y-0.1,z+size/2-0.04],[size,0.06,0.06],{color:'#b6f6ff',surface:{emissive:'#40d9ff',emissiveIntensity:1.2},collidable:false}))
    if(i>0&&i<5) nodes.push(asset(`checkpoint-${i}`,'checkpoint',[x,y,z],{prefab:{type:'checkpoint',size:0.6,seed:i,primary:'#77deec',secondary:null,text:'',lit:false,interactive:false}}))
  }
  nodes.push(asset('finish','portal',[0,2,-9]))
  return scene('Travessia orbital',nodes,{...environment('Atravesse as plataformas e alcance o portal','reachGoal',[0,0.02,13]),sky:'space',lightIntensity:1.4})
}

/** A lever lowers a physical bridge across a gap; interaction changes collision as well as appearance. */
export function createLabPuzzleScene():ThreeSceneDocument {
  const bridge={kind:'keyframes',axis:'x',duration:1.5,amplitude:0,phase:0,start:'trigger',easing:'smooth',keys:[
    {at:0,move:[0,0,0],turn:[90,0,0],scale:[1,1,1]},{at:1,move:[0,0,0],turn:[0,0,0],scale:[1,1,1]}]}
  const nodes:unknown[]=[node('entry-floor','box',[0,-0.25,9],[16,0.5,12],{surface:{texture:'tiles',textureScale:5}}),node('exit-floor','box',[0,-0.25,-9],[16,0.5,12],{surface:{texture:'tiles',textureScale:5}}),
    node('pit','box',[0,-4,0],[16,0.2,6],{color:'#382c49',behavior:{type:'hazard',speed:0,range:1,damage:100}}),
    node('bridge-hinge','group',[0,0,3],[1,1,1],{animation:bridge}),node('bridge-deck','box',[0,-0.11,-3],[4,0.22,6],{parentId:'bridge-hinge',color:'#487d91',surface:{texture:'metal'},overlapWith:['entry-floor','exit-floor']}),
    node('control','roundedBox',[0,0.95,8],[0.8,1.9,0.65],{color:'#3f606c',interaction:{trigger:'click',key:'',radius:5,action:'toggleAnimation',targetId:'bridge-hinge',message:'Ponte acionada'},surface:{texture:'metal'}}),
    node('control-display','box',[0,1.42,8.34],[0.56,0.3,0.02],{color:'#a3e1cd',surface:{emissive:'#3ceab5',emissiveIntensity:0.7},collidable:false,interaction:{trigger:'click',key:'',radius:5,action:'toggleAnimation',targetId:'bridge-hinge',message:'Ponte acionada'}}),asset('exit','portal',[0,0,-10])]
  for(const side of [-1,1]) {
    nodes.push(node(`lab-wall${side}`,'box',[side*8,2,0],[0.35,4,30],{color:'#667c85',surface:{texture:'metal'}}))
    nodes.push(node(`lab-light${side}`,'light',[side*4,3.2,side*8],[0.2,0.2,0.2],{light:{type:'point',color:'#9dd8f0',intensity:65,distance:24,angle:35,penumbra:0.5,castShadow:true}}))
  }
  return scene('Laboratório da ponte',nodes,environment('Acione o console, atravesse a ponte e alcance a saída','reachGoal',[0,0.02,12]))
}

/** Outer space: no ground, free flight, a lit star, planets, a station, ships and a tumbling asteroid belt. */
export function createSolarSystemScene():ThreeSceneDocument {
  const scatter={mode:'scatter',count:60,offset:[140,24,26],radius:0,axis:'y',columns:1,jitter:0.8,seed:11,onto:null}
  const prefab=(type:string,size:number,seed:number,extra:Record<string,unknown>={})=>({type,size,seed,primary:null,secondary:null,text:'',lit:true,interactive:false,...extra})
  const nodes:unknown[]=[
    node('star','sphere',[0,0,0],[24,24,24],{color:'#ffe9b0',surface:{emissive:'#ffb347',emissiveIntensity:6},collidable:false,geometry:{segments:64}}),
    node('star-light','light',[0,0,0],[0.5,0.5,0.5],{light:{type:'point',color:'#fff1d0',intensity:2000,distance:0,angle:35,penumbra:0.4,castShadow:false}}),
    asset('rock-world','planet',[60,-8,0],{prefab:prefab('planet',2,6,{primary:'#b5674a',secondary:'#ffb38a'})}),
    asset('ocean-world','planet',[-20,-14,-100],{prefab:prefab('planet',3.5,2,{primary:'#3f7fbf',secondary:'#a9d8ff'})}),
    asset('ringed-giant','planet',[150,-20,120],{prefab:prefab('planet',5,7,{primary:'#d9b380',secondary:'#e8d6b0'}),scale:[2,2,2]}),
    asset('belt','asteroid',[0,-4,-210],{repeat:scatter,prefab:prefab('asteroid',1.4,4)}),
    asset('station','spaceStation',[30,6,55],{prefab:prefab('spaceStation',1,3,{secondary:'#7fe9ff'})}),
    asset('ship-a','spaceship',[10,14,85],{rotation:[0,200,0],prefab:prefab('spaceship',1,5,{secondary:'#ff8a3d'}),animation:{kind:'orbit',axis:'y',duration:60,amplitude:14,phase:0,start:'auto',easing:'linear',keys:[]}}),
    asset('ship-b','spaceship',[-40,20,60],{rotation:[0,140,0],prefab:prefab('spaceship',0.8,9,{primary:'#3b4250',secondary:'#56f0ff'}),animation:{kind:'float',axis:'y',duration:8,amplitude:1.5,phase:90,start:'auto',easing:'smooth',keys:[]}}),
    asset('probe','satellite',[-30,10,30],{prefab:prefab('satellite',1,2)}),
  ]
  return scene('Sistema solar',nodes,{sky:'space',bloom:1,toneMapping:'agx',shadows:false,objective:{type:'explore',title:'Voe entre os planetas, a estação e o cinturão de asteroides',timeLimit:0},
    player:{spawn:[0,18,150],yaw:0,speed:9,jumpHeight:1.1,mode:'fly',allowFly:true,health:100,camera:'first'}})
}

/** Forest biome: dense mixed canopy on relief, undergrowth, a clearing with a campfire and a glowing mushroom ring. */
export function createEnchantedForestScene():ThreeSceneDocument {
  const onto=(count:number,seed:number,offset:Vector3Tuple=[100,0,100])=>({mode:'scatter',count,offset,radius:0,axis:'y',columns:1,jitter:0.6,seed,onto:'forest-floor'})
  const prefab=(type:string,size:number,seed:number,extra:Record<string,unknown>={})=>({type,size,seed,primary:null,secondary:null,text:'',lit:false,interactive:false,...extra})
  const nodes:unknown[]=[
    node('forest-floor','terrain',[0,0,0],[120,6,120],{color:'#ffffff',surface:{texture:'grass',textureScale:8},geometry:{segments:112,detail:3,seed:23,terrainStyle:'rolling',biome:'forest'}}),
    asset('campfire','campfire',[0,0,0],{repeat:{...single,onto:'forest-floor'},prefab:prefab('campfire',1,1,{lit:true})}),
    asset('tent','tent',[4.5,0,-2],{rotation:[0,-30,0],repeat:{...single,onto:'forest-floor'},prefab:prefab('tent',1,2)}),
    asset('bench-log','log',[-3,0,2.5],{rotation:[0,25,0],repeat:{...single,onto:'forest-floor'},prefab:prefab('log',0.8,3)}),
    asset('oaks','tree',[0,0,0],{repeat:onto(70,5),prefab:prefab('tree',1,8,{primary:'#b9cc8f',secondary:'#9fb879'})}),
    asset('pines','pine',[0,0,0],{repeat:onto(60,9),prefab:prefab('pine',1.1,4,{primary:'#9db58a',secondary:'#86a376'})}),
    asset('bushes','bush',[0,0,0],{repeat:onto(70,13),prefab:prefab('bush',1,6,{primary:'#7f9f5a'})}),
    asset('logs','log',[0,0,0],{repeat:onto(14,17),prefab:prefab('log',1,2)}),
    asset('stumps','stump',[0,0,0],{repeat:onto(14,19),prefab:prefab('stump',1,4)}),
    asset('glow-mushrooms','mushroom',[0,0,-14],{repeat:{...onto(9,21,[14,0,10])},prefab:prefab('mushroom',1.4,3,{lit:true})}),
    asset('rocks','rock',[0,0,0],{repeat:onto(20,29),prefab:prefab('rock',1.2,7)}),
    node('fireflies','sphere',[0,2.2,-6],[0.08,0.08,0.08],{color:'#fff7a0',surface:{emissive:'#e8ff6a',emissiveIntensity:5},collidable:false,
      animation:{kind:'float',axis:'y',duration:3.5,amplitude:0.6,phase:0,start:'auto',easing:'smooth',keys:[]},repeat:{mode:'scatter',count:40,offset:[30,2,30],radius:0,axis:'y',columns:1,jitter:0,seed:31,onto:null}}),
  ]
  return scene('Floresta encantada',nodes,{sky:'sunset',sunElevation:12,sunAzimuth:220,fog:0.012,bloom:0.7,toneMapping:'agx',shadows:true,ambientOcclusion:true,
    objective:{type:'explore',title:'Explore a floresta e encontre o círculo de cogumelos',timeLimit:0},player:{spawn:null,yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk',allowFly:true,health:100,camera:'first'}})
}

export const creationIdeas=[
  ['Arena de combate','Crie uma arena futurista de combate corpo a corpo com sentinelas robóticas e criaturas rastejantes, coberturas, iluminação de emergência, início seguro e objetivo de derrotar os inimigos. Sem casas ou vegetação.'],
  ['Plataformas no espaço','Crie uma fase de plataformas no espaço, com saltos progressivos entre passarelas, pontos de controle, perigos sob os caminhos e um portal final. Sem estradas, casas ou inimigos obrigatórios.'],
  ['Puzzle no laboratório','Crie um laboratório abandonado com um puzzle de alavancas que movem uma ponte física sobre um fosso, portas interativas, pistas luminosas e uma saída alcançável após resolver o percurso. Sem vila ou floresta.'],
  ['Sistema solar','Crie uma cena no espaço sideral com uma estrela brilhante, três planetas diferentes (um com anéis), uma estação espacial giratória, naves em órbita e um cinturão de asteroides para explorar voando.'],
  ['Floresta encantada','Crie uma floresta densa ao entardecer com relevo suave, árvores e pinheiros variados, troncos caídos, cogumelos luminosos, vaga-lumes, uma trilha até uma clareira com fogueira e barraca.'],
  ['Exploração e ruínas','Crie uma fase de exploração em ruínas antigas, com passagens, salas distintas, escadas, mecanismos e um templo como marco. Priorize descobrir o lugar e seus segredos; sem combate obrigatório.'],
] as const
