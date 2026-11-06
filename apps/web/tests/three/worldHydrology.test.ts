import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMacro } from '../../src/three/world/worldMacro.ts'
import { channelAt,carveChannel,detailedWaterMesh,waterMeshHeightAt } from '../../src/three/world/worldHydrology.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import { worldVisibility,distantVegetation } from '../../src/three/world/worldVisibility.ts'
import type { WorldSeed } from '../../src/three/world/worldProtocol.ts'
import { interpolateCell,selectNodes,type LodField,type SelectionInput } from '../../src/three/world/cdlod.ts'
import {buildWorldMacro} from '../../src/three/world/worldJobs.ts'

const macro=(size:number)=>buildMacro({seed:4,size:[size,size],range:[-10,20],seaLevel:null,erosion:0,climate:{temperature:18,humidity:.5,wind:0},base:()=>10,rivers:false})

for(const seed of[12,77,999])test(`generated channels remain filled and supported for world seed ${seed}`,()=>{
  const world:WorldSeed={seed,terrain:{kind:'climate',size:[2048,2048],heightRange:[10,160],seaLevel:null,ruggedness:.4,erosion:.3,climate:{temperature:18,humidity:.5,wind:0}}}
  const fields=buildWorldMacro(world),source=createHeightSource(world,fields),mesh=detailedWaterMesh(fields,source.heightAt),segments=fields.channels!
  assert.ok(segments.length>0)
  let checked=0
  for(let i=0;i<segments.length;i+=8)for(const t of[.2,.5,.8]){
    const x=segments[i]+(segments[i+3]-segments[i])*t,z=segments[i+1]+(segments[i+4]-segments[i+1])*t,water=waterMeshHeightAt(mesh,fields,x,z)
    const k=Math.floor((z-fields.origin[1])/fields.cell)*fields.points[0]+Math.floor((x-fields.origin[0])/fields.cell)
    if([k,k+1,k+fields.points[0],k+fields.points[0]+1].some(index=>fields.lake?.[index]))continue
    if(water===null||water<.1)continue
    const gx=Math.floor(x),gz=Math.floor(z),floor=interpolateCell(...[[gx,gz],[gx+1,gz],[gx,gz+1],[gx+1,gz+1]].map(([x,z])=>Math.fround(source.heightAt(x,z))) as [number,number,number,number],x-gx,z-gz),depth=water-floor
    assert.ok(depth>0&&depth<2.3,`depth ${depth} at ${x},${z}`);checked++
  }
  assert.ok(checked>0)
})

test('connected river sections fill a channel and meet raised banks without coarse-grid holes',()=>{
  const fields=macro(32);fields.channels=new Float32Array([0,-16,4,0,0,3.8,4,2,0,0,3.8,0,16,3.6,4,2])
  const bed=(x:number,z:number)=>carveChannel(10,channelAt(fields,x,z)),mesh=detailedWaterMesh(fields,bed)
  for(let z=-14;z<=14;z+=.25){
    const level=waterMeshHeightAt(mesh,fields,0,z)
    assert.ok(level!==null);assert.ok(Math.abs(level-bed(0,z)-2)<.01)
    assert.equal(waterMeshHeightAt(mesh,fields,5,z),null,'the bank contains the liquid')
  }
})
test('the final height source cuts a real channel below water and retains raised dry banks',()=>{
  const fields=macro(32),world:WorldSeed={seed:4,terrain:{kind:'climate',size:[32,32],heightRange:[10,20],seaLevel:null,ruggedness:0,erosion:0,climate:{temperature:18,humidity:.5,wind:0}}}
  for(let j=0;j<5;j++){fields.water[j*5+2]=4;fields.river[j*5+2]=1}
  const source=createHeightSource(world,fields)
  for(const z of [-8,-3,0,5,8])assert.ok(source.heightAt(0,z)<3,`river bed at ${z}`)
  assert.ok(source.heightAt(12,0)>8);assert.ok(source.heightAt(-12,0)>8)
  assert.equal(carveChannel(10,channelAt(fields,12,0)),10)
  assert.ok(Number.isFinite(source.heightAt(3.2,-2.7)))
})
test('a filled hollow retains its water datum through depth changes instead of draping a sheet over its bed',()=>{
  const fields=macro(8);fields.water.fill(2);fields.river.fill(1)
  const profile=(x:number)=>-8*Math.cos(x*Math.PI/8)**2
  const bed=(x:number)=>{const i=Math.floor(x),t=x-i;return profile(i)*(1-t)+profile(i+1)*t},mesh=detailedWaterMesh(fields,bed)
  assert.ok(mesh.cellOffsets)
  assert.ok(mesh.indices.length>0)
  const level=waterMeshHeightAt(mesh,fields,0,0)
  assert.equal(level,2)
  for(let x=-3;x<=3;x+=.25)for(let z=-3;z<=3;z+=.5){
    const water=waterMeshHeightAt(mesh,fields,x,z)
    assert.equal(water,2,'the same connected volume fills the hollow at one datum')
  }
  fields.lake!.fill(1);fields.river.fill(0)
  const lake=detailedWaterMesh(fields,bed)
  assert.equal(waterMeshHeightAt(lake,fields,0,0),2,'lake datum remains horizontal')
})
test('streaming horizons are hidden in fog and small props have no far billboard tier',()=>{
  for(const quality of ['low','medium','high'] as const){const budget=worldVisibility(quality);assert.ok(Math.exp(-((budget.distance*budget.fogDensity)**2))<.011)}
  assert.ok(worldVisibility('low').distance<worldVisibility('high').distance)
  assert.ok(distantVegetation.has('tree'));assert.ok(!distantVegetation.has('bush'));assert.ok(!distantVegetation.has('rock'))
})

test('the atmospheric horizon bounds tile requests as well as visible draws',()=>{
  const input:SelectionInput={camera:[0,2,0],origin:[-256,-256],levels:4,roots:[1,1],bounds:()=>({minY:0,maxY:0}),resident:level=>level>0,field:{reach:()=>1e6,finer:()=>1e6} as unknown as LodField}
  const all=selectNodes(input),limited=selectNodes({...input,maxDistance:100})
  assert.ok(limited.wanted.length>0&&limited.wanted.length<all.wanted.length)
  assert.ok(limited.wanted.every(node=>node.distance<=100))
  assert.ok(limited.deficit<all.deficit)
})

test('flat lake interiors stay coarse while worker-built patches share geometry and carry correct normals',()=>{
  const fields=macro(16);fields.water.fill(2);fields.lake!.fill(1)
  const mesh=detailedWaterMesh(fields,()=>-2)
  assert.equal(mesh.indices.length/3,8)
  assert.equal(mesh.patches!.length,1)
  assert.equal(mesh.patches![0].indices.length,mesh.indices.length)
  assert.equal(mesh.normals!.length,mesh.positions.length)
  for(let i=1;i<mesh.normals!.length;i+=3)assert.ok(mesh.normals![i]>.999)
})
