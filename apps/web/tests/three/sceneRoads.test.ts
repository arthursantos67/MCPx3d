import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, parseScene, validateScene, type SceneNode, type Vector3Tuple } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { conformTerrainPaths } from '../../src/three/sceneGrounding.ts'
import { PATH_CLEARANCE } from '../../src/three/sceneRoads.ts'
import { terrainHeightAt } from '../../src/three/sceneGeometrySpec.ts'
import { inspectSurfaceConflicts } from '../../src/three/sceneSurfaceQuality.ts'
import { inspectGroundQuality } from '../../src/three/sceneGroundQuality.ts'

const single={mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}
function scene() {
  const ground={...createNode('terrain'),id:'ground',dimensions:[48,18,42] as Vector3Tuple,geometry:{...createNode('terrain').geometry,segments:32,seed:84,detail:4,pads:[[0,0,0.12,0.18,0.22]]}}
  return expandSceneRecipe({name:'Caminhos',background:'#ddeeff',exposure:1,lightIntensity:1,duration:12,
    nodes:[{...ground,color:'#ffffff',metalness:0,roughness:1,repeat:single}],roads:[
      {name:'Curva larga',points:[[-20,-14],[0,-2],[13,-12],[17,15]],width:6,onto:'ground',texture:'tiles'},
      {name:'Cruzamento',points:[[-18,8],[17,-8]],width:4,onto:'ground',texture:'rock'}]})
}
function assertClear(road:SceneNode,ground:SceneNode) {
  const v=road.geometry.vertices,indices=road.geometry.indices
  for(let i=0;i<indices.length;i+=3) {
    const triangle=indices.slice(i,i+3).map(index=>v.slice(index*3,index*3+3))
    for(const [a,b,c] of [[1,0,0],[0,1,0],[0,0,1],[1/3,1/3,1/3],[0.25,0.5,0.25],[0.5,0.5,0]]) {
      const p=[0,1,2].map(axis=>triangle[0][axis]*a+triangle[1][axis]*b+triangle[2][axis]*c)
      const surface=ground.position[1]+terrainHeightAt(ground.geometry,(p[0]-ground.position[0])/ground.dimensions[0],(p[2]-ground.position[2])/ground.dimensions[2])*ground.dimensions[1]
      assert.ok(Math.abs(p[1]-surface-PATH_CLEARANCE)<0.00001,`terrain penetrates road triangle ${i/3}: ${p[1]-surface}`)
    }
  }
}

test('wide curved paths follow the entire triangulated terrain, including triangle interiors and joins',()=>{
  const document=scene(),ground=document.nodes.find(n=>n.kind==='terrain')!,roads=document.nodes.filter(n=>n.role==='path')
  assert.equal(roads.length,2)
  for(const road of roads) {assert.ok(road.geometry.vertices.length>500);assertClear(road,ground)}
  const report=inspectSurfaceConflicts({...document,nodes:roads})
  assert.equal(report.complete,true)
  assert.deepEqual(report.conflicts,[],'crossings must have a single surface owner')
  assert.deepEqual(parseScene(JSON.stringify(document)),document)
})

test('route networks rebuild idempotently after changes in terrain seed, relief and platform pads',()=>{
  const original=scene(),ground=original.nodes.find(n=>n.kind==='terrain')!
  const changed={...original,nodes:original.nodes.map(node=>node.id===ground.id?{...node,dimensions:[48,12,42] as Vector3Tuple,geometry:{...node.geometry,seed:1,pads:[[0.1,0.1,0.2,0.2,-0.1]]}}:node)}
  const projected=conformTerrainPaths(changed),support=projected.nodes.find(n=>n.id===ground.id)!
  assert.notDeepEqual(projected.nodes.find(n=>n.role==='path')!.geometry.vertices,original.nodes.find(n=>n.role==='path')!.geometry.vertices)
  for(const road of projected.nodes.filter(n=>n.role==='path')) assertClear(road,support)
  assert.equal(conformTerrainPaths(projected),projected)
})

test('compiler ribbon drafts migrate while unrelated authored meshes remain unchanged',()=>{
  const ground={...createNode('terrain'),id:'ground',dimensions:[40,8,40] as Vector3Tuple},base=createNode('mesh')
  const old={...base,id:'old',role:'path' as const,position:[0,0.06,0] as Vector3Tuple,dimensions:[4,0.01,20] as Vector3Tuple,overlapWith:['ground'],
    geometry:{...base.geometry,vertices:[-2,0.06,-10,2,0.06,-10,-2,0.06,10,2,0.06,10],indices:[0,2,1,1,2,3],uvs:[0,0,1,0,0,5,1,5]}}
  const authored={...old,id:'authored',role:'prop' as const}
  const migrated=conformTerrainPaths(validateScene({...createEmptyScene(),nodes:[ground,old,authored]}))
  const next=migrated.nodes.find(n=>n.id==='old')!
  assert.ok(next.path)
  assertClear(next,ground)
  assert.deepEqual(migrated.nodes.find(n=>n.id==='authored'),authored)
  const missingSupport=conformTerrainPaths(validateScene({...createEmptyScene(),nodes:[ground,{...old,overlapWith:[]}]}))
  assert.equal(missingSupport.nodes.find(n=>n.id==='old')!.path!.supportId,'ground','legacy flat roads without contacts should recover the unique terrain')
  assertClear(missingSupport.nodes.find(n=>n.id==='old')!,ground)
})

test('coincident routes render one surface and retain recoverable source for hidden duplicates',()=>{
  const document=scene(),road=document.nodes.find(n=>n.role==='path')!,duplicate={...road,id:'duplicate'}
  const projected=conformTerrainPaths({...document,nodes:[...document.nodes,duplicate]})
  assert.equal(projected.nodes.find(n=>n.id==='duplicate')!.visible,false)
  assert.deepEqual(projected.nodes.find(n=>n.id==='duplicate')!.path,road.path)
})

test('ground review catches clipped paths and competing grounds even when contacts were declared',()=>{
  const document=scene(),road=document.nodes.find(n=>n.role==='path')!,ground=document.nodes.find(n=>n.kind==='terrain')!
  assert.deepEqual(inspectGroundQuality(document),[])
  const low={...road,position:[road.position[0],road.position[1]-1,road.position[2]] as Vector3Tuple}
  assert.ok(inspectGroundQuality({...document,nodes:document.nodes.map(n=>n.id===road.id?low:n)}).some(issue=>issue.includes('atravessando')))
  const duplicate={...ground,id:'duplicate',name:'Outro terreno'}
  assert.ok(inspectGroundQuality({...document,nodes:[...document.nodes,duplicate]}).some(issue=>issue.includes('concorrentes')))
})

test('plane supports and translated roads keep their authored footprint after regeneration',()=>{
  const ground={...createNode('plane'),id:'ground',position:[0,0,0] as Vector3Tuple,dimensions:[50,0.01,50] as Vector3Tuple}
  const path={...createNode('mesh'),id:'route',role:'path' as const,path:{supportId:'ground',points:[[-10,0],[10,0]] as [number,number][],width:3}}
  const flat=conformTerrainPaths({...createEmptyScene(),nodes:[ground,path]}),road=flat.nodes.find(n=>n.id==='route')!
  assert.equal(road.geometry.vertices.length>12,true)
  const moved=conformTerrainPaths({...flat,nodes:flat.nodes.map(n=>n.id===road.id?{...n,position:[n.position[0]+4,n.position[1],n.position[2]+2] as Vector3Tuple}:n)})
  assert.deepEqual(moved.nodes.find(n=>n.id==='route')!.path!.points,[[-6,2],[14,2]])
  assert.equal(conformTerrainPaths(moved),moved)
  assert.deepEqual(inspectGroundQuality(moved),[])
})
