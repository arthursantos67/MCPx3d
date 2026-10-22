import { Box3, Vector3 } from 'three'
import { createEmptyScene, createNode, hasSurface, validateScene, type NodeKind, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { expandSceneRecipe } from './sceneGeneration.ts'
import { sceneMatrices } from './scenePlacement.ts'

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

/** Width (X) and depth (Z) of a prefab at rest, measured from its compiled parts, so walls can leave exact openings. */
export function prefabExtent(type:string,size=1):{width:number;depth:number;height:number} {
  const doc=expandSceneRecipe({name:type,background:'#000000',exposure:1,lightIntensity:1,duration:12,nodes:[asset('probe',type,[0,0,0],{prefab:{type,size,seed:1,primary:null,secondary:null,text:'',lit:false,interactive:false}})]})
  const matrices=sceneMatrices(doc),box=new Box3()
  for(const item of doc.nodes) if(hasSurface(item.kind)) box.union(new Box3(new Vector3(-0.5,-0.5,-0.5),new Vector3(0.5,0.5,0.5)).applyMatrix4(matrices.get(item.id)!.clone().scale(new Vector3(...item.dimensions))))
  const size3=box.getSize(new Vector3())
  return {width:size3.x,depth:size3.z,height:size3.y}
}
const prefabOf=(type:string,size:number,seed:number,extra:Record<string,unknown>={})=>({type,size,seed,primary:null,secondary:null,text:'',lit:true,interactive:true,...extra})
const say=(lines:string[])=>({trigger:'click',key:'',radius:3.5,action:'dialogue',targetId:null,message:lines.join('|')})
type Env=Record<string,unknown>
const living=(base:Env,extra:Env)=>({...base,...extra})
/** Seats prefab groups on their floor with onto, so plinths, roots and feet below the origin are declared contacts. */
const rest=(nodes:unknown[],support:(item:Env)=>string|null)=>nodes.map(entry=>{
  const item=entry as Env,repeat=item.repeat as Env,target=item.prefab?support(item):null,position=item.position as number[]
  return target&&repeat.onto==null?{...item,position:[position[0],0,position[2]],repeat:{...repeat,onto:target}}:item
})

/** Dungeon: a key opens the gate between two halls; skeletons patrol, a golem guards the exit portal. */
export function createCryptScene():ThreeSceneDocument {
  const gate=prefabExtent('gate'),turn=gate.depth>gate.width,gap=(turn?gate.depth:gate.width)+0.04,segment=(20-gap)/2
  const stone={surface:{texture:'rock',textureScale:3,normalStrength:1.2},color:'#8d877f',roughness:0.9,metalness:0}
  const nodes:unknown[]=[node('crypt-floor','plane',[0,0,0],[20,0.01,44],{...stone,surface:{texture:'tiles',textureScale:6,normalStrength:0.8},color:'#9a948a'})]
  for(const side of [-1,1]) {
    nodes.push(node(`crypt-wall${side}`,'box',[side*10.25,2.5,0],[0.5,5,44],stone),node(`crypt-end${side}`,'box',[0,2.5,side*22.25],[21,5,0.5],stone))
    nodes.push(node(`divider${side}`,'box',[side*(gap/2+segment/2),2.5,0],[segment,5,0.8],stone))
    for(const z of [-16,-6,6,16]) nodes.push(asset(`torch${side}${z}`,'torch',[side*8.6,0,z],{prefab:prefabOf('torch',1,Math.abs(z),{lit:z===16||z===-16})}))
  }
  nodes.push(asset('crypt-gate','gate',[0,0,0],{rotation:[0,turn?90:0,0],prefab:prefabOf('gate',1,2,{text:'Chave da cripta'})}))
  nodes.push(asset('key-altar','statue',[-6.5,0,4],{rotation:[0,90,0],prefab:prefabOf('statue',0.8,3,{primary:'#b8b0a2'})}))
  nodes.push(asset('crypt-key','key',[-4.6,0,4.5],{prefab:prefabOf('key',1,1,{text:'Chave da cripta'})}))
  nodes.push(asset('skeleton-a','skeleton',[-4,0,10],{prefab:prefabOf('skeleton',1,3)}),asset('skeleton-b','skeleton',[5,0,6],{prefab:prefabOf('skeleton',1,8)}))
  nodes.push(asset('heart-a','heart',[6.5,0,15],{prefab:prefabOf('heart',1,1)}),asset('heart-b','heart',[-6.5,0,-6],{prefab:prefabOf('heart',1,2)}))
  nodes.push(asset('golem','golem',[3,0,-11],{rotation:[0,180,0],prefab:prefabOf('golem',1,5),behavior:{type:'enemy',speed:1.6,range:9,damage:35,health:10,attack:'melee'}}))
  nodes.push(asset('treasure','chest',[-6,0,-17],{rotation:[0,45,0],prefab:prefabOf('chest',1,4)}),asset('exit','portal',[0,0,-18],{prefab:prefabOf('portal',1,1,{primary:'#b46bff'})}))
  for(const z of [-10,10]) nodes.push(node(`crypt-light${z}`,'light',[0,4,z],[0.2,0.2,0.2],{light:{type:'point',color:z<0?'#9c7bff':'#ffb36b',intensity:45,distance:20,angle:35,penumbra:0.5,castShadow:z>0}}))
  return scene('Cripta do Rei Esqueleto',rest(nodes,()=>'crypt-floor'),living(environment('Encontre a chave, abra o portão e alcance o portal','reachGoal',[0,0.02,19]),{
    sky:'night',fog:0.025,bloom:0.7,grade:'cinematic',weather:'dust',audio:{ambience:'dungeon',music:'mystery',volume:0.7},
    premise:'O Rei Esqueleto guarda a saída da própria tumba; só a chave esquecida no altar abre o caminho até o portal.',motion:{wind:0,grass:'none',fauna:'none'},
    player:{spawn:[0,0.02,19],yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk',allowFly:false,health:120,camera:'third',weapon:'sword',avatar:'knight'}}))
}

/** Peaceful market town: NPCs talk, a lost key opens a chest and the town wall frames the square. */
export function createMarketTownScene():ThreeSceneDocument {
  const nodes:unknown[]=[node('square','plane',[0,0,0],[72,0.01,72],{color:'#d7d0bf',surface:{texture:'grass',textureScale:14},roughness:0.95,metalness:0}),
    asset('fountain','fountain',[0,0,0],{prefab:prefabOf('fountain',1,2)})]
  for(let i=0;i<6;i++) {
    const angle=i/6*Math.PI*2+0.3,x=Math.cos(angle)*10,z=Math.sin(angle)*10
    nodes.push(asset(`stall${i}`,'marketStall',[x,0,z],{rotation:[0,90-angle*180/Math.PI,0],prefab:prefabOf('marketStall',1,i,{primary:['#c0392b','#2e86c1','#27ae60','#d68910','#8e44ad','#16a085'][i]})}))
  }
  const lines:Record<string,string[]>={
    'npc-mira':['Bom dia, viajante! Bem-vinda ao mercado de Valemar.','Perdi a Chave do baú perto do celeiro, ao leste.','Se encontrar, abra o baú atrás da fonte — o que estiver lá é seu!'],
    'npc-guard':['Alto! Ah, é só uma visitante.','A muralha protege o mercado dos lobos da floresta.','Fique dentro dos portões quando anoitecer.'],
    'npc-sage':['As estrelas contam histórias antigas…','Dizem que o chafariz foi erguido por um mago da torre norte.'],
  }
  const npc=(type:string,routine:unknown[],reaction='greet')=>({type:'npc',speed:type==='knight'?1.1:1,range:8,damage:0,routine,reaction})
  const period=(activity:string,target:string|null,from:number,to:number)=>({activity,target,from,to})
  nodes.push(asset('bench-a','bench',[0,0,5.6],{rotation:[0,180,0],prefab:prefabOf('bench',1,1)}),asset('bench-b','bench',[-5.6,0,0],{rotation:[0,90,0],prefab:prefabOf('bench',1,2)}))
  nodes.push(asset('npc-mira','villager',[4,0,7],{rotation:[0,200,0],prefab:prefabOf('villager',1,7,{primary:'#b5543c',character:{age:'adult',build:'average',height:0.97,style:'stylized',skin:null,hair:'#8a3b22',hairStyle:'ponytail',beard:'none'}}),interaction:say(lines['npc-mira']),
    behavior:npc('villager',[period('work','stall0',7,17),period('chat','fountain',17,21),period('sleep',null,21,7)])}))
  nodes.push(asset('npc-guard','knight',[0,0,27],{rotation:[0,180,0],prefab:prefabOf('knight',1,2,{character:{age:'adult',build:'athletic',height:1.06,style:'stylized',skin:null,hair:null,hairStyle:'short',beard:'short'}}),interaction:say(lines['npc-guard']),
    behavior:npc('knight',[period('patrol','tower33',6,20),period('guard',null,20,6)])}))
  nodes.push(asset('npc-sage','wizard',[-15,0,-18],{rotation:[0,40,0],prefab:prefabOf('wizard',1,4,{character:{age:'elder',build:'slim',height:0.95,style:'stylized',skin:null,hair:null,hairStyle:'long',beard:'long'}}),interaction:say(lines['npc-sage']),
    behavior:npc('wizard',[period('sit','bench-b',9,15),period('perform','well',15,19),period('wander',null,19,9)])}))
  nodes.push(asset('npc-buyer','villager',[-8,0,4],{rotation:[0,120,0],prefab:prefabOf('villager',1,12,{primary:'#3d6b8f',character:{age:'young',build:'slim',height:1.02,style:'stylized',skin:'#9a6440',hair:'#1c1a1d',hairStyle:'braids',beard:'none'}}),interaction:say(['Os tomates daqui são os melhores do reino!']),
    behavior:npc('villager',[period('chat','fountain',8,20),period('wander',null,20,8)],'flee')}))
  nodes.push(asset('npc-elder','villager',[2.5,0,4.2],{rotation:[0,180,0],prefab:prefabOf('villager',1,31,{primary:'#6b5b45',character:{age:'elder',build:'heavy',height:0.92,style:'stylized',skin:'#f2c7a5',hair:'#d9d6d0',hairStyle:'short',beard:'long'}}),interaction:say(['No meu tempo, o chafariz jorrava vinho nas festas!']),
    behavior:npc('villager',[period('sit','bench-a',7,19),period('chat','fountain',19,22)],'alert')}))
  nodes.push(asset('npc-child','villager',[-3,0,-6],{rotation:[0,30,0],prefab:prefabOf('villager',1,44,{primary:'#d68910',character:{age:'child',build:'slim',height:1,style:'stylized',skin:'#c98d66',hair:'#5a3a22',hairStyle:'bun',beard:'none'}}),interaction:say(['Você viu o lobo? Eu vi um lobo! Bem grandão!']),
    behavior:npc('villager',[period('chat','fountain',8,18),period('wander',null,18,8)],'flee')}))
  nodes.push(asset('barn-cart','cart',[24,0,-14],{rotation:[0,30,0],prefab:prefabOf('cart',1,3)}),asset('hay-a','haystack',[27,0,-19],{prefab:prefabOf('haystack',1,1)}),asset('hay-b','haystack',[21,0,-21],{prefab:prefabOf('haystack',1,2)}))
  nodes.push(asset('lost-key','key',[25,0,-23],{prefab:prefabOf('key',1,3,{text:'Chave do baú'})}),asset('reward-chest','chest',[0,0,-16],{prefab:prefabOf('chest',1,6,{text:'Chave do baú'})}))
  for(const x of [-24,-12,12,24]) nodes.push(asset(`wall-n${x}`,'castleWall',[x,0,-33],{prefab:prefabOf('castleWall',1,Math.abs(x))}))
  for(const x of [-33,33]) nodes.push(asset(`tower${x}`,'castleTower',[x,0,-33],{prefab:prefabOf('castleTower',1,x>0?3:5)}))
  for(const [i,[x,z]] of [[-14,14],[14,14],[-14,-14],[14,-14]].entries()) nodes.push(asset(`lamp${i}`,'lampPost',[x,0,z],{prefab:prefabOf('lampPost',1,i)}),asset(`banner${i}`,'banner',[x*1.25,0,z*1.25],{prefab:prefabOf('banner',1,i,{primary:'#7a1f2b'})}))
  nodes.push(asset('trees','tree',[0,0,24],{repeat:{mode:'linear',count:5,offset:[-9,0,0],radius:0,axis:'y',columns:1,jitter:0,seed:3,onto:null},position:[18,0,24],prefab:prefabOf('tree',1,6,{interactive:false})}))
  nodes.push(asset('well','well',[-24,0,10],{prefab:prefabOf('well',1,2)}))
  return scene('Mercado de Valemar',rest(nodes,()=>'square'),living(environment('Converse com Mira, encontre a chave e abra o baú','explore',[0,0.02,22]),{
    sky:'day',sunElevation:34,sunAzimuth:120,fog:0.004,bloom:0.2,grade:'warm',weather:'leaves',audio:{ambience:'meadow',music:'festive',volume:0.7},
    premise:'Valemar vive da feira: as barracas abrem de manhã, a praça se enche ao entardecer e Mira perdeu a chave do baú da família.',
    motion:{wind:0.7,grass:'auto',fauna:'auto'},dayCycle:{enabled:true,duration:480,start:8},
    player:{spawn:[0,0.02,22],yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk',allowFly:false,health:100,camera:'third',weapon:'none',avatar:'explorer'}}))
}

/** Platformer in the sky: moving platforms, jump pads, a jump power-up and coins on the way to the portal. */
export function createSkyIslandsScene():ThreeSceneDocument {
  const platform=prefabExtent('movingPlatform'),travel=Math.max(platform.width,platform.depth)
  const islands:[number,number,number,number][]=[[0,0,12,12],[0,0,-6-travel,8],[7,2,-16-travel,7],[0,8,-28-travel,9]]
  const nodes:unknown[]=[node('void','box',[0,-14,-12],[80,0.4,90],{color:'#2c3e66',behavior:{type:'hazard',speed:0,range:1,damage:100},surface:{emissive:'#1b2b55',emissiveIntensity:0.4}})]
  for(const [i,[x,top,z,size]] of islands.entries()) {
    nodes.push(node(`island${i}`,'roundedBox',[x,top-1.5,z],[size,3,size],{color:'#a8d07a',surface:{texture:'grass',textureScale:size/2},geometry:{bevel:0.12}}))
    nodes.push(node(`rock${i}`,'cone',[x,top-5.2,z],[size*0.8,4.4,size*0.8],{rotation:[180,0,0],color:'#8a7a6a',surface:{texture:'rock',textureScale:2,flatShading:true},geometry:{segments:9}}))
    if(i<3) nodes.push(asset(`coins${i}`,'coin',[x,top,z],{repeat:{mode:'radial',count:5,offset:[0,0,0],radius:size*0.3,axis:'y',columns:1,jitter:0,seed:1,onto:null},prefab:prefabOf('coin',1,i)}))
  }
  nodes.push(asset('lift','movingPlatform',[0,-0.2,12-6-travel/2-1],{prefab:prefabOf('movingPlatform',1,1)}))
  nodes.push(asset('pad','jumpPad',[0,0,-6-travel+2],{prefab:prefabOf('jumpPad',1,1)}))
  nodes.push(asset('orb','powerOrb',[7,2,-16-travel],{prefab:prefabOf('powerOrb',1,1,{text:'jump'})}),asset('flag','checkpoint',[-2,2,-16-travel+2],{prefab:prefabOf('checkpoint',0.8,2,{interactive:false,lit:false})}))
  nodes.push(asset('finish','portal',[0,8,-28-travel],{prefab:prefabOf('portal',1,3)}))
  return scene('Ilhas Celestes',nodes,living(environment('Salte entre as ilhas e alcance o portal','reachGoal',[0,0.02,15]),{
    premise:'Ilhas arrancadas do chão flutuam sobre as nuvens; o último portal para casa espera na ilha mais alta.',motion:{wind:1,grass:'auto',fauna:'auto'},
    sky:'day',sunElevation:42,bloom:0.35,grade:'vivid',weather:'none',audio:{ambience:'wind',music:'adventure',volume:0.7},
    player:{spawn:[0,0.02,15],yaw:0,speed:5,jumpHeight:1.3,mode:'walk',allowFly:false,health:100,camera:'third',weapon:'none',avatar:'explorer'}}))
}

/** Survival: hold out for 90 s against waves that arrive every 20 s, with cover, healing and a blaster. */
export function createWastelandSurvivalScene():ThreeSceneDocument {
  const nodes:unknown[]=[node('dunes','plane',[0,0,0],[56,0.01,56],{color:'#e2c49a',surface:{texture:'sand',textureScale:12},roughness:0.95,metalness:0})]
  for(const side of [-1,1]) nodes.push(node(`ridge-x${side}`,'box',[side*28.5,1.5,0],[1,3,58],{color:'#9c7b5c',surface:{texture:'rock',textureScale:4}}),node(`ridge-z${side}`,'box',[0,1.5,side*28.5],[56,3,1],{color:'#9c7b5c',surface:{texture:'rock',textureScale:4}}))
  for(const [i,[x,z,r]] of [[-8,6,0],[9,-4,90],[-4,-12,20],[12,12,-30]].entries()) nodes.push(asset(`cover${i}`,'container',[x,0,z],{rotation:[0,r,0],prefab:prefabOf('container',1,i,{primary:['#a8442f','#3f6e8c','#6b7d3a','#b07b2c'][i]})}))
  for(const [i,[x,z]] of [[0,0],[-14,-6],[15,3]].entries()) nodes.push(asset(`medkit${i}`,'heart',[x,0,z],{prefab:prefabOf('heart',1,i)}))
  nodes.push(asset('shield','powerOrb',[-2,0,-20],{prefab:prefabOf('powerOrb',1,1,{text:'shield'})}))
  const waves:[string,number,number,number][]=[['goblin',-20,-20,0],['goblin',20,-20,0],['orc',0,-24,20],['spider',-22,8,20],['goblin',22,10,40],['orc',-20,20,40],['wolf',20,22,60],['drone',0,-20,60]]
  for(const [i,[type,x,z,delay]] of waves.entries()) nodes.push(asset(`raider${i}`,type,[x,0,z],{prefab:prefabOf(type,1,i),behavior:{type:'enemy',speed:type==='orc'?2.4:3.2,range:40,damage:type==='orc'?25:12,health:type==='orc'?4:2,attack:type==='drone'?'ranged':type==='wolf'?'charge':'melee',...(type==='drone'?{flying:true}:{}),delay}}))
  return scene('Ermo dos Saqueadores',rest(nodes,()=>'dunes'),living(environment('Sobreviva por 90 segundos','reachGoal',[0,0.02,4]),{
    objective:{type:'survive',title:'Sobreviva por 90 segundos às ondas de saqueadores',timeLimit:90},
    sky:'sunset',sunElevation:9,sunAzimuth:250,fog:0.008,bloom:0.4,grade:'cinematic',weather:'dust',audio:{ambience:'desert',music:'combat',volume:0.7},
    premise:'Seu robô ficou sem bateria no meio do ermo, e os saqueadores sentiram o cheiro de sucata. Aguente até o resgate.',motion:{wind:1.3,grass:'none',fauna:'auto'},
    player:{spawn:[0,0.02,4],yaw:0,speed:4.8,jumpHeight:1.1,mode:'walk',allowFly:false,health:150,camera:'third',weapon:'blaster',avatar:'robot'}}))
}

export const creationIdeas=[
  ['Arena de combate','Crie uma arena futurista de combate corpo a corpo com sentinelas robóticas e criaturas rastejantes, coberturas, iluminação de emergência, início seguro e objetivo de derrotar os inimigos. Sem casas ou vegetação.'],
  ['Plataformas no espaço','Crie uma fase de plataformas no espaço, com saltos progressivos entre passarelas, pontos de controle, perigos sob os caminhos e um portal final. Sem estradas, casas ou inimigos obrigatórios.'],
  ['Puzzle no laboratório','Crie um laboratório abandonado com um puzzle de alavancas que movem uma ponte física sobre um fosso, portas interativas, pistas luminosas e uma saída alcançável após resolver o percurso. Sem vila ou floresta.'],
  ['Sistema solar','Crie uma cena no espaço sideral com uma estrela brilhante, três planetas diferentes (um com anéis), uma estação espacial giratória, naves em órbita e um cinturão de asteroides para explorar voando.'],
  ['Floresta encantada','Crie uma floresta densa ao entardecer com relevo suave, árvores e pinheiros variados, troncos caídos, cogumelos luminosos, vaga-lumes, uma trilha até uma clareira com fogueira e barraca.'],
  ['Exploração e ruínas','Crie uma fase de exploração em ruínas antigas, com passagens, salas distintas, escadas, mecanismos e um templo como marco. Priorize descobrir o lugar e seus segredos; sem combate obrigatório.'],
] as const
