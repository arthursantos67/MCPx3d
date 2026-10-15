import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldPlanScene, validateScenePlan, reviewScenePlan, planScene, planningBrief, type ScenePlan } from '../../src/three/scenePlanning.ts'
import { generateThreeScene, expandSceneRecipe, type SceneGenerationEvent } from '../../src/three/sceneGeneration.ts'
import { createNode, createEmptyScene } from '../../src/three/sceneDocument.ts'
import { applyScenePlanIntent } from '../../src/three/scenePlanRealization.ts'
import { reviewPlannedRoutes } from '../../src/three/sceneRouteReview.ts'
import { conformTerrainPaths } from '../../src/three/sceneGrounding.ts'
import { defaultGeometry } from '../../src/three/sceneGeometrySpec.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

const request='Um mundo com casa mobiliada, árvores e caminhos'
const plan=():ScenePlan=>({title:'Aldeia da clareira',identity:'Clareira acolhedora com casa e jardim',extent:[100,80],palette:['#aabbcc','#ccaa88','#446655'],terrain:{style:'rolling',biome:'meadow',relief:0},spawnZoneId:'arrival',
  zones:[{id:'arrival',name:'Chegada',role:'arrival',center:[-22,0],radius:17,landmark:'Casa de dois pavimentos',activities:['Explorar a casa']},{id:'garden',name:'Jardim',role:'nature',center:[22,0],radius:17,landmark:'Árvore central',activities:['Descansar no banco']}],
  routes:[{from:'arrival',to:'garden',width:3}],buildings:[{zoneId:'arrival',style:'townhouse',floors:2,width:9.4,depth:9,count:1,furnished:true}],objective:null})
const recipe=(floors:number)=>{
  const node=(id:string,kind:Parameters<typeof createNode>[0],position:number[],extra={})=>({...createNode(kind),id,position,color:'#aabbcc',metalness:0,roughness:0.8,repeat:{mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'},...extra})
  const prefab=(type:string,extra={})=>({type,size:1,seed:5,primary:null,secondary:null,text:'',lit:true,interactive:true,...extra})
  return{name:'Aldeia',background:'#aabbcc',exposure:1,lightIntensity:1,duration:12,nodes:[
    node('ground','plane',[0,0,0],{dimensions:[100,0.01,80]}),
    node('house','group',[-22,0,0],{prefab:prefab('house',{building:{style:'townhouse',floors,width:9.4,depth:9,furnished:true}})}),
    node('tree','group',[25,0,0],{prefab:prefab('tree')}),node('bench','group',[20,0,8],{prefab:prefab('bench')})]}
}

test('planner is reserved for complex world creation and validates routes, capacities and diversity',()=>{
  assert.equal(shouldPlanScene(request),true)
  for(const prompt of ['Uma casa','Uma cidade de brinquedo','Adicione casas, árvores e caminhos na vila','Remova as árvores do mundo']) assert.equal(shouldPlanScene(prompt),false,prompt)
  assert.deepEqual(validateScenePlan(plan()),plan())
  assert.throws(()=>validateScenePlan({...plan(),routes:[{from:'arrival',to:'unknown',width:3}]}),/inexistente/)
  const disconnected=plan();disconnected.zones.push({...disconnected.zones[1],id:'extra',center:[0,25],radius:10})
  assert.throws(()=>validateScenePlan(disconnected),/sem rota/)
  assert.throws(()=>validateScenePlan({...plan(),buildings:[{...plan().buildings[0],count:3}]}),/três plantas/)
  assert.throws(()=>validateScenePlan({...plan(),buildings:[{...plan().buildings[0],width:16,depth:16,count:2}]}),/circulação/)
  assert.ok(reviewScenePlan(expandSceneRecipe(recipe(1)),plan()).some(issue=>issue.includes('2 pavimentos')))
})

test('planner hands concrete requirements to builder and reviewer enforces them within three completions',async()=>{
  let calls=0;const events:SceneGenerationEvent[]=[],messages:string[]=[]
  const provider={generateStructured:async<T>(input:unknown)=>{messages.push(JSON.stringify(input));return [plan(),recipe(1),recipe(2)][calls++] as T}} as unknown as LLMProvider
  const built=await generateThreeScene(provider,request,new AbortController().signal,()=>{},event=>events.push(event))
  assert.equal(calls,3)
  assert.ok(messages[1].includes('PLANO ESPACIAL VALIDADO'))
  assert.ok(messages[2].includes('Plano não realizado'))
  assert.equal(built.nodes.find(node=>node.asset?.type==='house')!.asset!.building!.floors,2)
  assert.ok(built.nodes.some(node=>node.path && node.geometry.indices.length>6),'the production chain materializes the approved route')
  assert.ok(built.environment.player?.spawn,'the production chain defines the planned safe arrival')
  assert.deepEqual(reviewScenePlan(built,plan()),[],'the final document fulfills the measurable approved plan')
  assert.ok(events.some(event=>event.stage==='planning' && event.attempt===1))
  assert.ok(events.some(event=>event.stage==='inspection' && event.detail.includes('Revisão do plano construído')))
  assert.equal(events.at(-1)!.attempt,3)
  assert.ok(events.every(event=>event.maxAttempts===3))
})

test('invalid planning falls back with an explicit warning, while cancellation and quota stop the chain',async()=>{
  let calls=0;const warnings:string[]=[]
  const fallback={generateStructured:async<T>()=>(calls++===0?{bad:'plan'}:recipe(2)) as T} as unknown as LLMProvider
  await generateThreeScene(fallback,request,new AbortController().signal,()=>{},()=>{},report=>warnings.push(...report.warnings))
  assert.ok(calls>=2 && calls<=3)
  assert.ok(warnings.some(warning=>warning.includes('planejamento especializado')))
  calls=0
  const quota=Object.assign(new Error('quota'),{limit:{kind:'quota'}}),failed={generateStructured:async()=>{calls++;throw quota}} as unknown as LLMProvider
  await assert.rejects(generateThreeScene(failed,request,new AbortController().signal),/quota/)
  assert.equal(calls,1)
  let cancelled=false
  const pending={generateStructured:()=>new Promise(()=>{}),cancel:async()=>{cancelled=true}} as unknown as LLMProvider
  const controller=new AbortController(),work=generateThreeScene(pending,request,controller.signal)
  controller.abort(new Error('Cancelado durante planejamento'))
  await assert.rejects(work,/Cancelado durante planejamento/)
  assert.equal(cancelled,true)
})

test('the compiler materializes omitted planned routes around houses and safely places the player, once',()=>{
  const source=expandSceneRecipe(recipe(2)),realized=applyScenePlanIntent(source,plan()),compiled=conformTerrainPaths(realized.document)
  assert.equal(source.nodes.filter(node=>node.role==='path').length,0,'source document remains untouched')
  const roads=compiled.nodes.filter(node=>node.role==='path')
  assert.equal(roads.length,1)
  assert.ok(roads[0].path!.points.length>=3,'the street detours around the occupied zone center')
  assert.ok(roads[0].geometry.indices.length>6,'the fallback is actual compiled surface geometry')
  assert.deepEqual(reviewPlannedRoutes(compiled,plan()),[])
  assert.deepEqual(reviewScenePlan(compiled,plan()),[])
  const spawn=compiled.environment.player!.spawn!
  assert.ok(Math.hypot(spawn[0]+22,spawn[2])<=17)
  assert.ok(spawn[1]<0.2,'spawn is a foot position, not a camera position')
  assert.ok(realized.notes.some(note=>note.includes('rotas')))
  assert.equal(applyScenePlanIntent(compiled,plan()).document,compiled,'a second pass is a no-op')
})

test('authored paths and player starts are preserved, while review rejects actual disconnected or steep routes',()=>{
  const ground={...createNode('plane'),id:'ground',dimensions:[100,0.01,80] as [number,number,number]}
  const path=(id:string,x:number,width:number,y=0)=>({...createNode('box'),id,role:'path' as const,position:[x,y,0] as [number,number,number],dimensions:[width,0.08,3] as [number,number,number]})
  const scene={...createEmptyScene(),nodes:[ground,path('left',-12,20),path('right',12,20)]}
  assert.ok(reviewPlannedRoutes(scene,plan()).some(issue=>issue.includes('contínuo')))
  const joined={...scene,nodes:[ground,path('left',-11,22),path('right',11,22)]}
  assert.deepEqual(reviewPlannedRoutes(joined,plan()),[],'joined surfaces belong to one network')
  const steep={...scene,nodes:[ground,path('left',-11,22),path('right',11,22,4)]}
  assert.ok(reviewPlannedRoutes(steep,plan()).some(issue=>issue.includes('contínuo')),'touching XZ footprints do not bridge a 4 m height jump')
  const authored={...scene,environment:{...scene.environment,player:{spawn:[25,0.06,0] as [number,number,number],yaw:30,speed:4.5,jumpHeight:1.1,mode:'walk' as const}}}
  assert.equal(applyScenePlanIntent(authored,plan()).document,authored,'explicit authored paths and start remain unchanged')
  assert.ok(reviewScenePlan(authored,plan()).some(issue=>issue.includes('fora da chegada')))
})

test('the reviewer inspects effective visibility, physical scale, gameplay entities and explicit requested counts',()=>{
  const source=expandSceneRecipe(recipe(2)),parent={...createNode('group'),id:'hidden-parent',visible:false}
  const hidden={...source,nodes:[parent,...source.nodes.map(node=>node.asset?.type==='house'?{...node,parentId:parent.id}:node)]}
  assert.ok(reviewScenePlan(hidden,plan()).some(issue=>issue.includes('construídas 0')))
  const tiny={...source,nodes:source.nodes.map(node=>node.asset?.type==='house'?{...node,scale:[0.25,0.25,0.25] as [number,number,number]}:node)}
  assert.ok(reviewScenePlan(tiny,plan()).some(issue=>issue.includes('construídas 0')),'source prefab parameters cannot disguise toy-sized architecture')
  const collectPlan={...plan(),objective:{type:'collectAll' as const,title:'Buscar cristais',zoneId:'garden'}}
  const emptyObjective={...source,environment:{...source.environment,objective:{type:'collectAll' as const,title:'Buscar cristais',timeLimit:0}}}
  const issues=reviewScenePlan(emptyObjective,collectPlan,'Encontre sete cristais e 3 moedas.')
  assert.ok(issues.some(issue=>issue.includes('nenhum objeto coletável')))
  assert.ok(issues.some(issue=>issue.includes('7 cristais')))
  assert.ok(issues.some(issue=>issue.includes('3 moedas')))
  const gem={...createNode('sphere'),id:'gem',name:'Cristal azul',interaction:{trigger:'proximity' as const,key:'',radius:1.4,action:'collect' as const,targetId:null,message:''}}
  const one={...emptyObjective,nodes:[...emptyObjective.nodes,gem]}
  assert.ok(!reviewScenePlan(one,collectPlan,'Encontre um cristal.').some(issue=>issue.includes('objetos correspondentes')))
  const enemy={...createNode('box'),id:'enemy',behavior:{type:'enemy' as const,speed:2,range:5,damage:10},position:[-22,0,0] as [number,number,number]}
  const dangerous={...one,nodes:[...one.nodes,enemy],environment:{...one.environment,player:{spawn:[-21,0,0] as [number,number,number],yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk' as const}}}
  assert.ok(reviewScenePlan(dangerous,collectPlan).some(issue=>issue.includes('menos de 5 m')))
})

test('planned biome fills a missing terrain semantic without repainting or replacing authored materials',()=>{
  const source=expandSceneRecipe(recipe(2)),land={...source.nodes[0],kind:'terrain' as const,geometry:{...defaultGeometry('terrain'),biome:'none' as const},dimensions:[100,4,80] as [number,number,number]}
  const natural={...source,nodes:[land,...source.nodes.slice(1)]},alpine={...plan(),terrain:{style:'rolling' as const,biome:'alpine' as const,relief:4}}
  const result=applyScenePlanIntent(natural,alpine)
  const after=result.document.nodes.find(node=>node.id===land.id)!
  assert.equal(after.geometry.biome,'alpine')
  assert.equal(after.geometry.terrainStyle,land.geometry.terrainStyle)
  assert.deepEqual(after.dimensions,land.dimensions)
  assert.deepEqual(after.material,land.material)
  assert.ok(result.notes.some(note=>note.includes('bioma alpine')))
  for(const material of [{...land.material,texture:'wood' as const},{...land.material,textureImage:'data:image/png;base64,AAAA'}]) {
    const custom=applyScenePlanIntent({...natural,nodes:[{...land,material},...natural.nodes.slice(1)]},alpine)
    assert.equal(custom.document.nodes.find(node=>node.id===land.id)!.geometry.biome,'none','authored non-natural/custom-image terrain is preserved')
  }
})

const technicalPlan=():ScenePlan=>({title:'Instalação de treino orbital',identity:'Plataformas e salas técnicas interligadas, sem paisagem natural',extent:[40,40],palette:['#768390','#233142','#e5b568'],terrain:{style:'rolling',biome:'none',relief:0},spawnZoneId:'arrival',
  zones:[{id:'arrival',name:'Desembarque',role:'arrival',center:[-10,0],radius:5,landmark:'Airlock seguro',activities:['Orientar o jogador']},{id:'destination',name:'Saída',role:'destination',center:[10,0],radius:5,landmark:'Portal técnico',activities:['Alcançar a saída']}],
  routes:[{from:'arrival',to:'destination',width:3}],buildings:[],objective:{type:'reachGoal',title:'Alcance a saída',zoneId:'destination'}})

test('non-village worlds qualify for spatial planning and hand off conceptual genre connections',async()=>{
  const requests=[
    'Crie uma arena sci-fi com inimigos patrulhando, coberturas e portal de saída.',
    'Crie uma estação espacial com laboratórios, corredores e puzzles com interruptores.',
    'Crie um platformer com plataformas móveis, perigos, saltos e checkpoints.',
    'Crie uma masmorra com salas, corredores, inimigos e alavancas de puzzle.',
  ]
  for(const request of requests) {
    assert.equal(shouldPlanScene(request),true,request)
    let prompt=''
    const provider={generateStructured:async<T>(messages:unknown)=>{prompt=JSON.stringify(messages);return technicalPlan() as T}} as unknown as LLMProvider
    const approved=await planScene(provider,request,new AbortController().signal)
    assert.deepEqual(approved,technicalPlan())
    assert.ok(!prompt.includes('Cada casa ocupa'),'housing catalog instructions are absent from non-residential planner prompts')
    const brief=planningBrief(approved,request)
    assert.ok(brief.includes('conectividade conceitual'),request)
    assert.ok(brief.includes('não acrescente casas residenciais'),request)
    assert.ok(!brief.includes('Terreno e apoios: uma superfície principal'),request)
  }
  const provider={generateStructured:async<T>()=>plan() as T} as unknown as LLMProvider
  const arena=await planScene(provider,requests[0],new AbortController().signal)
  assert.deepEqual(arena.buildings,[],'village houses are removed from a technical arena plan instead of losing the whole plan')
  const grassPlan={...technicalPlan(),terrain:{style:'rolling' as const,biome:'meadow' as const,relief:4}}
  const station=await planScene({generateStructured:async<T>()=>grassPlan as T} as unknown as LLMProvider,requests[1],new AbortController().signal)
  assert.deepEqual(station.terrain,{style:'rolling',biome:'none',relief:0},'natural relief is removed from an enclosed station plan')
})

test('planned indoor and platform layouts do not require outdoor paved meshes to pass review',()=>{
  const plan=technicalPlan(),floor={...createNode('plane'),id:'technical-floor',dimensions:[40,0.01,40] as [number,number,number]}
  const goal={...createNode('box'),id:'exit',position:[10,0.5,0] as [number,number,number],behavior:{type:'goal' as const,speed:0,range:1,damage:0}}
  const document={...createEmptyScene(),nodes:[floor,goal],environment:{...createEmptyScene().environment,player:{spawn:[-10,0.06,0] as [number,number,number],mode:'walk' as const,yaw:0,speed:4.5,jumpHeight:1.1},objective:{type:'reachGoal' as const,title:'Saída',timeLimit:0}}}
  for(const request of ['Uma estação espacial com salas e corredores','Um platformer com saltos e plataformas','Uma arena técnica com coberturas']) {
    const realization=applyScenePlanIntent(document,plan,request)
    assert.ok(!realization.document.nodes.some(node=>node.role==='path' || node.path || node.kind==='terrain'),'conceptual connections must not create outdoor roads or fill intentional platform gaps')
    assert.deepEqual(reviewScenePlan(realization.document,plan,request),[],request)
  }
  assert.ok(reviewScenePlan(document,plan,'Um vale com caminhos e árvores').some(issue=>issue.includes('superfície de caminho')),'outdoor circulation retains physical path verification')
})

test('the production chain builds and reviews a sci-fi combat arena in two bounded calls without village defaults',async()=>{
  const request='Crie uma arena sci-fi com inimigos patrulhando, coberturas e portal de saída.'
  const node=(id:string,kind:Parameters<typeof createNode>[0],position:[number,number,number],dimensions:[number,number,number],extra={})=>({...createNode(kind),id,position,dimensions,color:'#a4b3bf',metalness:0.3,roughness:0.65,repeat:{mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'},...extra})
  const builtRecipe={name:'Arena orbital',background:'#151e2a',exposure:1,lightIntensity:1,duration:12,environment:{player:{spawn:[-10,0.06,0],yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk'},objective:{type:'reachGoal',title:'Alcance a saída',timeLimit:0}},nodes:[
    node('floor','plane',[0,0,0],[40,0.01,40]),
    node('exit','box',[10,0.5,0],[1,1,1],{behavior:{type:'goal',speed:0,range:1,damage:0}}),
    node('enemy','capsule',[0,0.9,7],[0.9,1.8,0.9],{behavior:{type:'enemy',speed:2,range:5,damage:10}}),
    node('cover','box',[0,0.65,-4],[3,1.3,1]),
  ]}
  let calls=0;const prompts:string[]=[],events:SceneGenerationEvent[]=[]
  const provider={generateStructured:async<T>(messages:unknown)=>{prompts.push(JSON.stringify(messages));return [technicalPlan(),builtRecipe][calls++] as T}} as unknown as LLMProvider
  const result=await generateThreeScene(provider,request,new AbortController().signal,()=>{},event=>events.push(event))
  assert.equal(calls,2,'valid genre-specific plan and construction need no refinement call')
  assert.ok(prompts[1].includes('conectividade conceitual'))
  assert.ok(!result.nodes.some(node=>node.path || node.kind==='terrain' || node.asset?.type==='house'))
  assert.ok(result.nodes.some(node=>node.behavior?.type==='enemy'))
  assert.deepEqual(reviewScenePlan(result,technicalPlan(),request),[])
  assert.ok(events.some(event=>event.stage==='planning'))
})
