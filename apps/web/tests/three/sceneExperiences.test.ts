import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Vector3 } from 'three'
import { createCreationStage,createCombatArenaScene,createPlatformCourseScene,createLabPuzzleScene } from '../../src/three/sceneExperiences.ts'
import { parseScene } from '../../src/three/sceneDocument.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { auditScene } from '../../src/three/sceneLayout.ts'
import { createRuntime,defeatEnemy,checkOutcome,triggerInteraction,advanceRuntime,runtimePose } from '../../src/three/sceneRuntime.ts'
import { sceneMatrices } from '../../src/three/scenePlacement.ts'
import { applyScenePlanIntent } from '../../src/three/scenePlanRealization.ts'
import type { ScenePlan } from '../../src/three/scenePlanning.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { createNode } from '../../src/three/sceneDocument.ts'

test('the creation stage is neutral and the three game references have distinct functional objectives',()=>{
  const welcome=createCreationStage()
  assert.equal(welcome.name,'Seu próximo jogo')
  assert.ok(!welcome.nodes.some(n=>n.asset||n.behavior||n.kind==='terrain'))
  for(const create of [createCombatArenaScene,createPlatformCourseScene,createLabPuzzleScene]) {
    const scene=create(),inspection=inspectSceneGeometry(scene)
    assert.deepEqual(parseScene(JSON.stringify(scene)),scene)
    assert.equal(inspection.complete,true)
    assert.equal(auditScene(scene,inspection).total,0,scene.name)
    assert.ok(!scene.nodes.some(n=>n.asset?.type==='house'||n.role==='path'||n.kind==='terrain'))
    assert.equal(scene.environment.player!.allowFly,false)
  }
})

test('the combat reference requires defeating distinct enemy families and preserves explicit enemy tuning',()=>{
  const scene=createCombatArenaScene(),runtime=createRuntime(scene),enemies=scene.nodes.filter(n=>n.behavior?.type==='enemy')
  assert.equal(runtime.objective.type,'defeatEnemies')
  assert.equal(enemies.length,3)
  assert.ok(new Set(enemies.map(n=>n.asset?.type)).size>1)
  for(const enemy of enemies) {
    assert.ok(new Vector3(...enemy.position).distanceTo(new Vector3(...scene.environment.player!.spawn!))>enemy.behavior!.range+1)
    assert.equal(runtime.outcome,'playing');assert.equal(defeatEnemy(runtime,enemy.id),true);checkOutcome(runtime)
  }
  assert.equal(runtime.outcome,'won')
  const root=createNode('group'),tuned=expandSceneRecipe({name:'Inimigo',background:'#112233',exposure:1,lightIntensity:1,duration:12,nodes:[{...root,color:'#ffffff',metalness:0,roughness:1,
    prefab:{type:'sentinel',size:1,seed:4},behavior:{type:'enemy',speed:1.25,range:6,damage:9},repeat:{mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}}]})
  assert.deepEqual(tuned.nodes.find(n=>n.id===root.id)!.behavior,{type:'enemy',speed:1.25,range:6,damage:9})
})

test('the lab console actually lowers a solid bridge rather than showing a decorative lever',()=>{
  const scene=createLabPuzzleScene(),runtime=createRuntime(scene),hinge=scene.nodes.find(n=>n.id==='bridge-hinge')!,deck=scene.nodes.find(n=>n.id==='bridge-deck')!
  assert.equal(deck.collidable,true)
  assert.equal(runtimePose(runtime,hinge).rotation[0],90)
  assert.equal(triggerInteraction(runtime,'control'),'Ponte acionada')
  advanceRuntime(runtime,1.5)
  assert.equal(runtimePose(runtime,hinge).rotation[0],0)
  const base=sceneMatrices(scene).get(hinge.id)!,point=new Vector3(...deck.position).applyMatrix4(base)
  assert.ok(Math.abs(point.z)<0.001)
  assert.equal(runtime.objective.type,'reachGoal')
})

test('genre-specific plan handoff preserves platform gaps and indoor floors instead of adding outdoor roads',()=>{
  const plan:ScenePlan={title:'Percurso',identity:'Conectar os setores',extent:[80,70],palette:['#ffffff','#112233','#445566'],terrain:{style:'rolling',biome:'meadow',relief:0},spawnZoneId:'entry',zones:[
    {id:'entry',name:'Entrada',role:'arrival',center:[0,12],radius:7,landmark:'Início',activities:[]},{id:'exit',name:'Saída',role:'destination',center:[0,-9],radius:7,landmark:'Portal',activities:[]}],routes:[{from:'entry',to:'exit',width:3}],buildings:[],objective:null}
  for(const [scene,request] of [[createPlatformCourseScene(),'Crie uma fase de plataformas no espaço'],[createLabPuzzleScene(),'Crie um laboratório de puzzles com ponte']] as const) {
    const result=applyScenePlanIntent(scene,plan,request)
    assert.equal(result.document,scene)
    assert.ok(!result.document.nodes.some(n=>n.path))
  }
})

test('the solar system and enchanted forest examples are valid, playable and free of verified intersections', async () => {
  const { createSolarSystemScene, createEnchantedForestScene } = await import('../../src/three/sceneExperiences.ts')
  const { inspectSceneGeometry } = await import('../../src/three/sceneInspection.ts')
  const { auditScene } = await import('../../src/three/sceneLayout.ts')
  for (const scene of [createSolarSystemScene(), createEnchantedForestScene()]) {
    const report = inspectSceneGeometry(scene)
    assert.equal(report.complete, true, scene.name)
    assert.deepEqual(report.intersections.map((issue) => `${issue.nameA}|${issue.nameB}`), [], scene.name)
    const audit = auditScene(scene, report)
    assert.equal(audit.total, 0, `${scene.name}: ${JSON.stringify(audit)}`.slice(0, 600))
  }
  const space = createSolarSystemScene()
  assert.equal(space.environment.sky, 'space')
  assert.equal(space.environment.player?.mode, 'fly')
  assert.ok(createEnchantedForestScene().nodes.filter((node) => node.asset?.type === 'tree' || node.asset?.type === 'pine').length >= 60)
})
