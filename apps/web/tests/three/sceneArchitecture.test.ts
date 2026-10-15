import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { buildingPlan, buildingStyles } from '../../src/three/sceneArchitecture.ts'
import { createNode, hasSurface, parseScene, validateScene } from '../../src/three/sceneDocument.ts'
import { applySceneEdit, editThreeScene, expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { sceneMatrices } from '../../src/three/scenePlacement.ts'
import { buildStaticCollider, emptyInput, findWalkableSpawn, stepPlayer, type PlayerState } from '../../src/three/scenePlayer.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { reviewSceneDirection } from '../../src/three/sceneDirection.ts'
import type { PrefabSpec } from '../../src/three/scenePrefabs.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'
import { auditScene, settleLayout } from '../../src/three/sceneLayout.ts'

const spec = (style: typeof buildingStyles[number], floors = 2): PrefabSpec => ({type:'house',size:1,seed:1,primary:null,secondary:null,text:'',lit:true,interactive:true,building:{style,floors,width:9.4,depth:9,furnished:true}})
const template = (asset: PrefabSpec) => ({...createNode('group'),id:'home',name:'Casa',color:'#ffffff',metalness:0,roughness:0.8,prefab:asset,repeat:{mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}})
const house = (asset: PrefabSpec) => expandSceneRecipe({name:'Casa',background:'#aabbcc',exposure:1,lightIntensity:1,duration:12,nodes:[template(asset)]})

test('architectural walls have real bidirectional openings, transparent glass and usable human dimensions', () => {
  for(const style of buildingStyles) {
    const scene=house(spec(style)), walls=scene.nodes.find(n=>n.id==='home.walls')!, glass=scene.nodes.find(n=>n.id==='home.glass')!
    const matrix=sceneMatrices(scene).get(walls.id)!.clone().scale(new THREE.Vector3(...walls.dimensions)), geometry=buildNodeGeometry(walls)
    geometry.applyMatrix4(matrix)
    const bvh=new MeshBVH(geometry), w=9.4,d=9
    for(const level of [0,1]) for(const sign of [-1,1]) {
      const x=w*0.27+0.24,y=0.22+3.35*level+1.55,z=d/2
      const ray=new THREE.Ray(new THREE.Vector3(x,y,z+sign),new THREE.Vector3(0,0,-sign))
      assert.equal(bvh.raycast(ray,THREE.DoubleSide).filter(hit=>hit.distance<2).length,0,`${style}: blocked window ${level}/${sign}`)
    }
    assert.ok(bvh.raycast(new THREE.Ray(new THREE.Vector3(w*0.43,1.7,d/2+1),new THREE.Vector3(0,0,-1)),THREE.DoubleSide).some(hit=>hit.distance<2),'wall must remain solid beside opening')
    assert.ok(glass.material.transparent && glass.material.opacity!<0.4 && glass.material.doubleSided)
    assert.equal(glass.material.emissiveIntensity,0)
    assert.ok(scene.nodes.find(n=>n.id==='home.door')!.dimensions[0]>1.1)
    assert.ok(scene.nodes.length<30,'detailed architecture uses material batches')
    assert.equal(inspectSceneGeometry(scene).intersections.length,0,style)
    geometry.dispose()
  }
})

test('a grounded human capsule walks up the full stair, reaches the landing and descends without jumping', () => {
  const scene=house(spec('townhouse')), matrices=sceneMatrices(scene)
  const entries=scene.nodes.filter(node=>hasSurface(node.kind)&&node.collidable&&node.id!=='home.door').map(node=>({geometry:buildNodeGeometry(node),matrix:matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))}))
  const {bvh,omitted}=buildStaticCollider(entries), collider={bvh,boxes:[],floor:-20}
  assert.equal(omitted,0)
  const bounds=new THREE.Box3(new THREE.Vector3(-8,0,-8),new THREE.Vector3(8,10,8))
  for(const y of [0.22,3.57]) {
    const spawn=findWalkableSpawn(collider,new THREE.Vector3(0,y,-2.9),bounds,null)
    assert.ok(Math.abs(spawn.y-y)<0.04,`interior spawn snapped to a different floor: ${spawn.toArray()}`)
  }
  const player: PlayerState={position:new THREE.Vector3(9.4/2-0.28-0.8-0.12,0.22,9/2-0.65),velocity:new THREE.Vector3(),yaw:0,pitch:0,onGround:true,fly:false}
  for(let i=0;i<420 && player.position.z > -2.5;i++) stepPlayer(player,{...emptyInput(),forward:true},collider,{speed:2,jumpHeight:1},1/60)
  assert.ok(player.position.y>3.5,`failed ascent: ${player.position.toArray()}`)
  assert.ok(player.position.z< -2,`failed landing: ${player.position.toArray()}`)
  for(let i=0;i<360 && player.position.z < 3.8;i++) stepPlayer(player,{...emptyInput(),back:true},collider,{speed:2,jumpHeight:1},1/60)
  assert.ok(player.position.y<0.4,`failed descent: ${player.position.toArray()}`)
  for(const {geometry} of entries) geometry.dispose()
  bvh!.geometry.dispose()
})

test('semantic rebuilding adds a real upper floor, preserves transforms and references and survives serialization', () => {
  const original=house(spec('cottage',1)), root=original.nodes.find(n=>n.id==='home')!
  root.position=[12,3,-8]; root.rotation=[0,35,0]
  const edited=applySceneEdit(original,{updates:[],additions:[],removals:[],rebuilds:[{id:'home',prefab:spec('lodge',2)}]})
  const next=edited.nodes.find(n=>n.id==='home')!
  assert.deepEqual(next.position,root.position); assert.deepEqual(next.rotation,root.rotation)
  assert.equal(next.asset!.building!.floors,2)
  assert.equal(edited.nodes.find(n=>n.id==='home.door')!.interaction!.targetId,'home.hinge')
  assert.ok(edited.nodes.some(n=>n.id==='home.lamp-upper'))
  assert.equal(buildingPlan(parseScene(JSON.stringify(edited)).nodes.find(n=>n.id==='home')!.asset!).style,'lodge')
  assert.equal(original.nodes.find(n=>n.id==='home')!.asset!.building!.floors,1)
  assert.throws(()=>validateScene({...edited,nodes:edited.nodes.map(node=>node.id==='home'?{...node,asset:{...node.asset,building:[]}}:node)}),/planta/)
})

test('production review catches missing upper floors and repeated architecture independently of color', () => {
  const scene=house(spec('cottage',1))
  assert.ok(reviewSceneDirection(scene,'Uma casa com primeiro andar mobiliado').some(issue=>issue.includes('pavimento superior')))
  const repeated=expandSceneRecipe({name:'Vila',background:'#aabbcc',exposure:1,lightIntensity:1,duration:12,nodes:[{...template(spec('cottage',1)),repeat:{mode:'linear',count:3,offset:[16,0,0],radius:0,axis:'y'}}]})
  assert.ok(reviewSceneDirection(repeated,'Uma vila com casas diferentes').some(issue=>issue.includes('mesma arquitetura')))
  assert.deepEqual(reviewSceneDirection({...scene,nodes:[]},'Remova a casa'),[])
})

test('the editing agent refines a structurally valid patch that fails the requested accessible upper floor',async()=>{
  const original=house(spec('cottage',1)), plans:unknown[]=[{updates:[],additions:[],rebuilds:[]},{updates:[],additions:[],rebuilds:[{id:'home',prefab:spec('townhouse',2)}]}]
  let calls=0
  const provider={maxOutputTokens:8192,generateStructured:async<T>(messages:unknown)=>{if(calls) assert.ok(JSON.stringify(messages).includes('pavimento superior')); return plans[calls++] as T}} as unknown as LLMProvider
  const events:import('../../src/three/sceneGeneration.ts').SceneGenerationEvent[]=[]
  const result=await editThreeScene(provider,original,'Adicione um primeiro andar à casa',new AbortController().signal,{mode:'edit',onProgress:event=>events.push(event)})
  assert.equal(calls,2)
  assert.equal(result.nodes.find(n=>n.id==='home')!.asset!.building!.floors,2)
  assert.equal(events.at(-1)!.attempt,2)
})

test('automatic repair preserves reachable rewards on an upper floor, both independent and parented to the house',()=>{
  for(const parentId of [null,'home']) {
    const scene=house(spec('townhouse',2)), item={...createNode('sphere',parentId),id:'reward',name:'Recompensa do quarto',position:[0,4.67,-2.8] as [number,number,number],dimensions:[0.3,0.3,0.3] as [number,number,number],collidable:false,
      interaction:{trigger:'proximity' as const,key:'',radius:1.4,action:'collect' as const,targetId:null,message:''}}
    const ground={...createNode('plane'),id:'ground',position:[0,0,0] as [number,number,number],dimensions:[40,0.01,40] as [number,number,number]}
    const original=validateScene({...scene,nodes:[...scene.nodes,ground,item]}), inspection=inspectSceneGeometry(original)
    assert.deepEqual(auditScene(original,inspection).unreachable,[],parentId??'independent')
    const settled=settleLayout(original,inspection).document
    assert.deepEqual(settled.nodes.find(n=>n.id==='home')!.position,[0,0,0])
    assert.deepEqual(settled.nodes.find(n=>n.id==='reward')!.position,item.position)
  }
})
