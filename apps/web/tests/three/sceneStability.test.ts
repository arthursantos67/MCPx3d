import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, parseScene, subtreeIds } from '../../src/three/sceneDocument.ts'
import { serializeSceneDraft, expandSceneDraft } from '../../src/three/sceneDraft.ts'
import { createArchitectureScene, createValleyScene } from '../../src/three/sceneShowcase.ts'
import { applySceneEdit, expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { inspectSurfaceConflicts } from '../../src/three/sceneSurfaceQuality.ts'
import { repairImproved, type SceneInspection } from '../../src/three/sceneInspection.ts'
import { createShadowScheduler } from '../../src/three/sceneShadows.ts'
import { prefabParts, type PrefabSpec } from '../../src/three/scenePrefabs.ts'
import { proceduralTexture } from '../../src/three/sceneTextures.ts'

test('detailed default drafts fit browser storage and round trip without shared mutable geometry',()=>{
  const scene=createValleyScene(),full=JSON.stringify(scene),draft=serializeSceneDraft(scene)
  assert.ok(draft.length*2<5*1024*1024,`UTF-16 draft uses ${draft.length*2} bytes`)
  assert.ok(draft.length<full.length*0.65)
  const loaded=parseScene(draft)
  assert.deepEqual(loaded,scene)
  const table=JSON.parse(draft),same=table.nodes.filter((n:{geometry:{draftGeometry?:number}})=>n.geometry.draftGeometry===0)
  assert.ok(same.length>1)
  const a=loaded.nodes.find(n=>n.id===same[0].id)!,b=loaded.nodes.find(n=>n.id===same[1].id)!
  assert.notEqual(a.geometry.vertices,b.geometry.vertices)
  assert.deepEqual(parseScene(full),scene)
})

test('draft references reject corrupt IDs and expanded payloads before cloning geometry',()=>{
  const node=createNode('box'),raw={...createEmptyScene(),nodes:[{...node,geometry:{draftGeometry:0}}],geometryLibrary:[node.geometry]}
  for(const index of [-1,1,0.5,'0']) assert.throws(()=>parseScene(JSON.stringify({...raw,nodes:[{...node,geometry:{draftGeometry:index}}]})),/Referência/)
  assert.throws(()=>parseScene(JSON.stringify({...raw,nodes:[{...node,geometry:{draftGeometry:0,vertices:[]}}]})),/Referência/)
  assert.throws(()=>expandSceneDraft({...raw,nodes:Array.from({length:20},()=>raw.nodes[0])},2000,2000),/expandido/)
})

test('a repair cannot claim to remove coplanar conflicts when its surface coverage is incomplete',()=>{
  const report:SceneInspection={intersections:[],sampledTimes:[0],checkedPairs:0,skippedContacts:0,assemblyContacts:0,complete:true,elapsedMs:0,surfaceCheckComplete:true,
    surfaceConflicts:[{a:'floor',b:'stone',nameA:'Piso',nameB:'Pedra',area:36,point:[0,0.22,0]}]}
  assert.equal(repairImproved(report,{...report,surfaceConflicts:[],surfaceCheckComplete:false}),false)
  assert.equal(repairImproved(report,{...report,surfaceConflicts:[]}),true)
})

test('coplanar audit detects exposed competing finishes, allows adjacent tiles and ignores buried joins',()=>{
  const floor={...createNode('box'),id:'floor',position:[0,0.1,0] as [number,number,number],dimensions:[6,0.2,6] as [number,number,number]}
  const stone={...floor,id:'stone',dimensions:[7,0.4,7] as [number,number,number],position:[0,0,0] as [number,number,number]}
  const doc={...createEmptyScene(),nodes:[floor,stone]}
  const conflict=inspectSurfaceConflicts(doc)
  assert.ok(conflict.complete)
  assert.ok(conflict.conflicts.some(c=>c.area>35),'top surfaces have 36 m² of competing finish')
  assert.deepEqual(inspectSurfaceConflicts({...doc,nodes:[floor,{...floor,id:'tile',position:[6,0.1,0]}]}).conflicts,[])
  const covering={...createNode('box'),id:'cover',position:[0,0.5,0] as [number,number,number],dimensions:[8,1,8] as [number,number,number]}
  assert.deepEqual(inspectSurfaceConflicts({...doc,nodes:[floor,stone,covering]}).conflicts,[])
})

test('old house floors migrate surgically and idempotently while edited batches are preserved',()=>{
  const scene=createArchitectureScene(),stone=scene.nodes.find(n=>n.id==='casa.foundation')!,g=stone.geometry
  // Legacy foundation: full-height first box, without the four separate perimeter rim boxes.
  const vertices=[...g.vertices.slice(0,72).map((v,i)=>i%3===1&&Math.abs(v-0.15)<0.00001?0.22:v),...g.vertices.slice(360)]
  stone.geometry={...g,vertices,indices:[...g.indices.slice(0,36),...g.indices.slice(180).map(i=>i-96)],uvs:[...g.uvs.slice(0,48),...g.uvs.slice(240)],normals:[]}
  stone.material.color='#123456'
  const item={...createNode('sphere','casa'),id:'authored',name:'Objeto do usuário'}
  scene.nodes.push(item)
  assert.ok(inspectSurfaceConflicts(scene).conflicts.some(c=>[c.a,c.b].includes(stone.id)&&c.area>30))
  const fixed=parseScene(JSON.stringify(scene)),after=fixed.nodes.find(n=>n.id===stone.id)!
  assert.equal(after.material.color,'#123456')
  assert.deepEqual(fixed.nodes.find(n=>n.id==='authored'),item)
  assert.deepEqual(after.position,stone.position)
  assert.deepEqual(inspectSurfaceConflicts(fixed).conflicts,[])
  assert.deepEqual(parseScene(JSON.stringify(fixed)),fixed)
  const floor=scene.nodes.find(n=>n.id==='casa.floors')!
  floor.position[1]+=0.02
  assert.deepEqual(parseScene(JSON.stringify(scene)).nodes.find(n=>n.id===stone.id)!.geometry,stone.geometry)
})

test('rebuilding structure preserves user contents, nested assets and removed-part coordinate frames',()=>{
  const scene=createArchitectureScene(),root=scene.nodes.find(n=>n.id==='casa')!,balcony=scene.nodes.find(n=>n.id==='casa.balcony-door')!
  const authored={...createNode('sphere',balcony.id),id:'authored',position:[0,0.4,0] as [number,number,number]}
  const nested={...createNode('group','casa'),id:'nested',asset:{type:'crate',size:1,seed:2,primary:null,secondary:null,text:'',lit:false,interactive:false} as PrefabSpec}
  const contents={...createNode('box','nested'),id:'nested.custom',assetPart:'custom'}
  scene.nodes.push(authored,nested,contents)
  const edited=applySceneEdit(scene,{updates:[],additions:[],rebuilds:[{id:root.id,prefab:{...root.asset!,building:{style:'cottage',floors:1,width:10,depth:10,furnished:true}}}]})
  assert.deepEqual(edited.nodes.find(n=>n.id==='authored'),authored)
  assert.deepEqual(edited.nodes.find(n=>n.id==='nested'),nested)
  assert.deepEqual(edited.nodes.find(n=>n.id==='nested.custom'),contents)
  const frame=edited.nodes.find(n=>n.id===balcony.id)!
  assert.equal(frame.kind,'group')
  assert.deepEqual(frame.position,balcony.position)
  assert.deepEqual(frame.rotation,balcony.rotation)
  assert.ok(!edited.nodes.some(n=>n.id==='casa.lamp-upper'))
  assert.doesNotThrow(()=>parseScene(JSON.stringify(edited)))
})

test('shadow budget follows the player and refreshes only affected static-light caches',()=>{
  const world=new THREE.Group(),sources=Array.from({length:5},(_,i)=>{const light=new THREE.PointLight('#ffffff',2,12);light.position.set(i*30,4,0);world.add(light);return{id:`light${i}`,light}})
  const object=new THREE.Object3D();object.position.set(0,0,0);world.add(object);world.updateMatrixWorld(true)
  const scheduler=createShadowScheduler(sources,[{id:'caster',object,dimensions:[2,2,2]}],2)
  assert.deepEqual(scheduler.update(new THREE.Vector3()).active,['light0','light1'])
  assert.deepEqual(scheduler.update(new THREE.Vector3()).refreshed,[])
  object.position.x=1;world.updateMatrixWorld(true)
  assert.deepEqual(scheduler.update(new THREE.Vector3()).refreshed,['light0'])
  const changed=scheduler.update(new THREE.Vector3(120,0,0))
  assert.deepEqual(changed.active,['light4','light3'])
  assert.deepEqual(changed.refreshed,['light4','light3'])
  assert.equal(sources[0].light.castShadow,false)
  sources[4].light.visible=false;world.updateMatrixWorld(true)
  assert.deepEqual(scheduler.update(new THREE.Vector3(120,0,0)).active,['light3','light2'])
  scheduler.dispose()
  assert.ok(sources.every(source=>!source.light.castShadow && !source.light.shadow.map))
})

test('rebuilding one legacy repeated house preserves its custom contents and the other copy',()=>{
  const root=createArchitectureScene().nodes.find(n=>n.id==='casa')!
  const scene=expandSceneRecipe({name:'Casas',background:'#aabbcc',exposure:1,lightIntensity:1,duration:12,nodes:[{...root,id:'home',prefab:root.asset,color:'#ffffff',metalness:0,roughness:0.8,
    repeat:{mode:'linear',count:2,offset:[20,0,0],radius:0,axis:'y'}}]})
  // The saved project predates compiler part tags.
  scene.nodes.forEach(node=>{delete node.assetPart})
  const copy=scene.nodes.find(node=>node.asset && node.id!=='home')!,scope=subtreeIds(scene.nodes,copy.id),door=scene.nodes.find(node=>scope.has(node.id) && node.name==='Porta de entrada')!
  const authored={...createNode('sphere',copy.id),id:'authored'},originalScope=subtreeIds(scene.nodes,'home'),untouched=scene.nodes.filter(node=>originalScope.has(node.id))
  const control={...createNode('box'),id:'switch',interaction:{...door.interaction!,targetId:door.interaction!.targetId}}
  scene.nodes.push(authored,control)
  const rebuilt=applySceneEdit(scene,{updates:[],additions:[],rebuilds:[{id:copy.id,prefab:{...copy.asset!,building:{style:'lodge',floors:2,width:10,depth:11,furnished:true}}}]})
  assert.deepEqual(rebuilt.nodes.find(node=>node.id==='authored'),authored)
  assert.deepEqual(rebuilt.nodes.filter(node=>originalScope.has(node.id)),untouched)
  const nextScope=subtreeIds(rebuilt.nodes,copy.id),next=rebuilt.nodes.find(node=>node.name==='Porta de entrada' && nextScope.has(node.id))!
  assert.equal(rebuilt.nodes.find(node=>node.id==='switch')!.interaction!.targetId,next.interaction!.targetId)
  assert.ok(rebuilt.nodes.some(node=>node.id===next.interaction!.targetId))
  assert.equal(new Set(rebuilt.nodes.map(node=>node.id)).size,rebuilt.nodes.length)
})

test('vegetation has deterministic branches, distinct silhouettes, outward trunk faces and cutout foliage',()=>{
  for(const type of ['tree','pine'] as const) {
    const spec:PrefabSpec={type,size:1,seed:19,primary:null,secondary:null,text:'',lit:false,interactive:false},parts=prefabParts(spec)
    assert.deepEqual(parts,prefabParts(spec))
    assert.notDeepEqual(parts,prefabParts({...spec,seed:31}))
    assert.ok(parts.length<=6)
    const trunk=parts.find(p=>p.id==='trunk')!,g=trunk.geometry!
    const a=new THREE.Vector3(...g.vertices!.slice(0,3)),b=new THREE.Vector3(...g.vertices!.slice(3,6)),c=new THREE.Vector3(...g.vertices!.slice(33,36))
    const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize()
    assert.ok(normal.dot(new THREE.Vector3(a.x,0,a.z))>0)
    const leaves=parts.filter(p=>p.id.startsWith('foliage'))
    assert.ok(leaves.every(p=>p.material?.alphaTest===0.45 && p.material.doubleSided && !p.collidable))
    const triangles=parts.reduce((sum,p)=>sum+p.geometry!.indices!.length/3,0)
    assert.ok(triangles>600 && triangles<2000,`${type}: ${triangles}`)
  }
  for(const kind of ['foliage','needles'] as const) {
    const texture=proceduralTexture(kind,'map'),pixels=texture.image.data as Uint8Array
    let opaque=0,empty=0
    for(let i=3;i<pixels.length;i+=4) {if(pixels[i]>128) opaque++;else empty++}
    assert.ok(opaque>pixels.length/80 && empty>pixels.length/8)
    texture.dispose()
  }
})
