import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {harvestDamage,resourceMethod} from '../../src/three/sceneHarvest.ts'
import {arrangeBagCells,syncBagCells} from '../../src/three/sceneInventory.ts'
import {craftItem,createGameplayProgress,naturalResource,validateGameplay} from '../../src/three/sceneGameplay.ts'
import {createEmptyScene,createNode,validateScene} from '../../src/three/sceneDocument.ts'
import {createLiquidQuery,liquidSample,validateLiquid} from '../../src/three/sceneLiquids.ts'
import {stepPlayer,emptyInput,type PlayerState} from '../../src/three/scenePlayer.ts'
import {snapshotRuntime,restoreRuntime} from '../../src/three/sceneProgress.ts'
import {createRuntime} from '../../src/three/sceneRuntime.ts'
import {auroraGameplay} from '../../src/three/world/worldAdventure.ts'
import {expandSceneRecipe} from '../../src/three/sceneGeneration.ts'
import {terrainHeightAt} from '../../src/three/sceneGeometrySpec.ts'
import {conformTerrainPaths} from '../../src/three/sceneGrounding.ts'
import {createClimateWorld,upgradeAurora} from '../../src/three/world/worldExamples.ts'

test('axes, picks, swords and hands have materially different harvesting roles',()=>{
  const wood=naturalResource('tree')!,stone=naturalResource('rock')!
  assert.ok(harvestDamage(wood,'axe')>=6*harvestDamage(wood,'none'))
  assert.ok(harvestDamage(stone,'pickaxe')>=10*harvestDamage(stone,'axe'))
  assert.ok(harvestDamage(wood,'sword')<harvestDamage(wood,'none'))
  assert.ok(harvestDamage(stone,'sword')<harvestDamage(stone,'none'))
  assert.equal(resourceMethod(naturalResource('bush')!),'gather')
  assert.equal(harvestDamage(naturalResource('bush')!,'axe'),0)
})
test('advanced recipes cannot spend ingredients without the required physical station',()=>{
  const rules=validateGameplay(auroraGameplay())!,recipe=rules.recipes.find(recipe=>recipe.id==='espada')!,progress=createGameplayProgress()
  const items=new Map(recipe.inputs.map(input=>[input.item,input.amount])),before=[...items]
  assert.equal(craftItem(progress,items,recipe),false);assert.deepEqual([...items],before)
  assert.equal(craftItem(progress,items,recipe,new Set(['campfire'])),false)
  assert.equal(craftItem(progress,items,recipe,new Set(['workbench'])),true)
  assert.equal(items.get(recipe.output.item),1)
  assert.equal(rules.recipes.find(recipe=>recipe.id==='bancada')!.station,undefined)
})
test('the previous bundled Aurora sandbox gains the bench progression without replacing edited locations',()=>{
  const world=createClimateWorld(),rules=world.environment.gameplay!
  rules.recipes=rules.recipes.filter(recipe=>!['bancada','picareta'].includes(recipe.id)).map(recipe=>({...recipe,station:undefined}))
  rules.items=rules.items!.filter(item=>item.placeable!=='workbench'&&item.equipment!=='pickaxe')
  rules.items.find(item=>item.equipment==='axe')!.harvest=3
  const mara=world.locations[0].scene!.nodes.find(node=>node.id==='mara')!;mara.name='Nome editado'
  const upgraded=upgradeAurora(world)!
  assert.ok(upgraded.environment.gameplay!.recipes.some(recipe=>recipe.id==='bancada'))
  assert.equal(upgraded.environment.gameplay!.recipes.find(recipe=>recipe.id==='espada')!.station,'workbench')
  assert.equal(upgraded.environment.gameplay!.items!.find(item=>item.equipment==='axe')!.harvest,5)
  assert.equal(upgraded.locations[0].scene!.nodes.find(node=>node.id==='mara')!.name,'Nome editado')
  assert.equal(upgradeAurora(upgraded),null)
})
test('split portions, single deposits, merging and reload preserve exact inventory totals',()=>{
  const items=new Map([['Madeira',11],['Pedra',2]])
  let cells=syncBagCells([],items)
  cells=arrangeBagCells(cells,0,2,6).cells
  assert.deepEqual(cells.slice(0,3),[{item:'Madeira',amount:5},{item:'Pedra',amount:2},{item:'Madeira',amount:6}])
  cells=arrangeBagCells(cells,2,3,1).cells
  assert.equal(cells[2]!.amount,5);assert.equal(cells[3]!.amount,1)
  assert.equal(arrangeBagCells(cells,0,1,2).moved,0)
  const scene=validateScene({...createEmptyScene(),environment:{...createEmptyScene().environment,gameplay:{quests:[],recipes:[],naturalResources:true,startingItems:[{item:'Madeira',amount:11},{item:'Pedra',amount:2}]}}})
  const runtime=createRuntime(scene);runtime.bagSlots=cells
  const restored=createRuntime(scene);restoreRuntime(restored,JSON.parse(JSON.stringify(snapshotRuntime(runtime))))
  assert.deepEqual(restored.bagSlots,cells)
  restored.items.set('Madeira',4);const reconciled=syncBagCells(restored.bagSlots,restored.items)
  assert.equal(reconciled.reduce((sum,cell)=>sum+(cell?.item==='Madeira'?cell.amount:0),0),4)
})
test('liquid queries follow triangle height and footprint rather than the top of a bounding box',()=>{
  const node=validateScene({...createEmptyScene(),nodes:[{...createNode('mesh'),id:'lava',liquid:{kind:'lava'},collidable:false}]}).nodes[0]
  assert.equal(node.liquid!.viscosity,6);assert.equal(node.material.texture,'water');assert.ok((node.material.emissiveIntensity??0)>0)
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,4,2,0,0,0,4],3))
  const query=createLiquidQuery([{node,geometry,matrix:new THREE.Matrix4(),visible:()=>true}])
  assert.ok(Math.abs(query.at(1,1)!.level-.5)<1e-6)
  assert.equal(query.at(3,3),null);assert.equal(query.at(5,1),null)
  assert.equal(query.at(1,1)!.damage,30)
  query.dispose();geometry.dispose()
  assert.throws(()=>validateLiquid({kind:'lava',viscosity:NaN}))
})
test('viscous lava slows movement and changes buoyancy while retaining fluid controls',()=>{
  const run=(kind:'water'|'lava')=>{
    const fluid=liquidSample(validateLiquid({kind}),1)
    const player:PlayerState={position:new THREE.Vector3(0,-1,0),velocity:new THREE.Vector3(),yaw:0,pitch:0,onGround:false,fly:false}
    const input={...emptyInput(),forward:true}
    for(let i=0;i<960;i++)stepPlayer(player,input,{bvh:null,boxes:[],floor:-10,liquidAt:()=>fluid},{speed:5,jumpHeight:1},1/120)
    return player
  }
  const water=run('water'),lava=run('lava')
  assert.ok(water.swimming&&lava.swimming)
  assert.ok(Math.abs(lava.position.z)<Math.abs(water.position.z)*.6)
  assert.ok(lava.position.y>water.position.y)
})
test('generated river routes carve their terrain and remain supported after path recompilation',()=>{
  const base=createNode('terrain'),ground={...base,id:'ground',dimensions:[48,18,42],geometry:{...base.geometry,segments:64,seed:84,detail:4}}
  const scene=expandSceneRecipe({name:'Rio',background:'#ddeeff',exposure:1,lightIntensity:1,duration:12,nodes:[{...ground,color:'#ffffff',metalness:0,roughness:1,repeat:{mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}}],roads:[{name:'Rio de teste',points:[[-15,-5],[0,0],[15,5]],width:6,onto:'ground',texture:'water'}]})
  const final=conformTerrainPaths(scene),terrain=final.nodes.find(node=>node.id==='ground')!,water=final.nodes.find(node=>node.liquid)!
  assert.ok(water&&!water.collidable&&water.geometry.indices.length>0)
  assert.ok(terrain.geometry.pads.length>0)
  const floor=(x:number,z:number)=>terrain.position[1]+terrainHeightAt(terrain.geometry,x/48,z/42)*18
  assert.ok(ground.position[1]+terrainHeightAt(ground.geometry,0,0)*18-floor(0,0)>.6)
  const v=water.geometry.vertices,indices=water.geometry.indices
  for(let i=0;i<indices.length;i+=3){const p=[0,1,2].map(axis=>indices.slice(i,i+3).reduce((sum,index)=>sum+v[index*3+axis],0)/3),depth=p[1]-floor(p[0],p[2]);assert.ok(depth<=1.25,`unsupported river: ${depth}`);assert.ok(depth>=-.08,`buried river: ${depth}`)}
})
