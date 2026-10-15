import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createNode, parseScene, createEmptyScene, validateScene, type SceneNode } from '../../src/three/sceneDocument.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { createResources } from '../../src/three/sceneBuild.ts'
import { proceduralTexture } from '../../src/three/sceneTextures.ts'
import { terrainGeometryForExport } from '../../src/three/sceneTerrainMaterial.ts'

function ground(biome:'meadow'|'alpine'|'desert'|'volcanic'='meadow'):SceneNode {
  const node=createNode('terrain')
  return {...node,dimensions:[80,18,100],geometry:{...node.geometry,segments:32,biome},material:{...node.material,color:'#ffffff'}}
}

test('terrain detail is measured in metres and layers follow physical slopes instead of landscape size',()=>{
  const node=ground(),a=buildNodeGeometry(node),b=buildNodeGeometry({...node,dimensions:[160,18,200]})
  const uv=a.getAttribute('terrainUv'),wide=b.getAttribute('terrainUv'),weights=a.getAttribute('terrainLayers')
  assert.equal(uv.getX(32),80);assert.equal(wide.getX(32),160)
  assert.equal(uv.getY(32*33),-100);assert.equal(wide.getY(32*33),-200)
  assert.equal(weights.count,a.getAttribute('position').count)
  for(const value of weights.array) assert.ok(Number.isFinite(value)&&value>=0&&value<=1)
  assert.notDeepEqual(weights.array,b.getAttribute('terrainLayers').array)
  a.dispose();b.dispose()
})

test('biomes render albedo, normal and roughness layers and survive texture resource pruning',()=>{
  const resources=createResources(4),node=ground('alpine'),material=resources.material(node,false)
  assert.ok(material.map);assert.ok(material.normalMap);assert.ok(material.roughnessMap)
  assert.equal(material.map.anisotropy,4)
  assert.equal(material.userData.terrainLayering.metresPerTile,2)
  const layers=material.userData.terrainTextures as THREE.Texture[]
  let disposed=0
  for(const layer of new Set(layers)) layer.addEventListener('dispose',()=>{disposed++})
  resources.begin();assert.equal(resources.material({...node,dimensions:[160,18,200]},false),material);resources.prune()
  assert.equal(disposed,0)
  assert.notEqual(resources.material(ground('desert'),false),material)
  resources.begin();resources.prune()
  assert.equal(disposed,new Set(layers).size)
  resources.dispose()
})

test('explicit material overrides stay available and terrain detail adds no transport-only document fields',()=>{
  const resources=createResources(),node=ground(),wood={...node,material:{...node.material,texture:'wood' as const,textureScale:3}}
  const material=resources.material(wood,false)
  assert.equal(material.userData.terrainLayering,undefined)
  assert.equal(material.map?.repeat.x,3)
  const plain=resources.material({...node,geometry:{...node.geometry,biome:'none'}},false)
  assert.equal(plain.vertexColors,false);assert.equal(plain.userData.terrainLayering,undefined)
  const document=validateScene({...createEmptyScene(),nodes:[node]})
  assert.deepEqual(parseScene(JSON.stringify(document)),document)
  resources.dispose()
})

test('GLB fallback preserves metre-scale detail without modifying shared runtime geometry',()=>{
  const source=buildNodeGeometry(ground()),copy=terrainGeometryForExport(source,2)
  assert.equal(source.getAttribute('uv').getX(32),1)
  assert.equal(copy.getAttribute('uv').getX(32),40)
  assert.equal(copy.getAttribute('uv').getY(32*33),-50)
  assert.equal(copy.hasAttribute('terrainUv'),false);assert.equal(copy.hasAttribute('terrainLayers'),false)
  assert.equal(source.hasAttribute('terrainUv'),true)
  assert.deepEqual(copy.getAttribute('color').array,source.getAttribute('color').array)
  source.dispose();copy.dispose()
})

test('fine grass, rock, sand and snow data are deterministic with independent surface relief',()=>{
  const signatures:number[][]=[]
  for(const kind of ['groundGrass','groundRock','groundSand','groundSnow'] as const) {
    const color=proceduralTexture(kind,'map'),normal=proceduralTexture(kind,'normal'),rough=proceduralTexture(kind,'rough'),second=proceduralTexture(kind,'map')
    const data=color.image.data as Uint8Array,normals=normal.image.data as Uint8Array,roughness=rough.image.data as Uint8Array
    assert.deepEqual(data,second.image.data)
    let min=255,max=0,normalRange=0,roughMin=255,roughMax=0
    for(let i=0;i<data.length;i+=4) {
      min=Math.min(min,data[i]);max=Math.max(max,data[i]);normalRange=Math.max(normalRange,Math.abs(normals[i]-128),Math.abs(normals[i+1]-128))
      roughMin=Math.min(roughMin,roughness[i+1]);roughMax=Math.max(roughMax,roughness[i+1])
      assert.equal(data[i+3],255)
    }
    assert.ok(max-min>=20,`${kind} needs visible albedo detail`)
    assert.ok(normalRange>=5,`${kind} needs surface relief`)
    assert.ok(roughMax>roughMin,`${kind} needs variable roughness`)
    signatures.push([min,max,normalRange,roughMin,roughMax])
    for(const map of [color,normal,rough,second]) map.dispose()
  }
  assert.equal(new Set(signatures.map(value=>JSON.stringify(value))).size,4)
})
