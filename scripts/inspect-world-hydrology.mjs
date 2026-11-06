// Geometric validation against actual level-0 terrain triangles; no WebGL or provider calls.
import { mkdir,writeFile } from 'node:fs/promises'
import { createClimateWorld } from '../apps/web/src/three/world/worldExamples.ts'
import { buildWorldMacro } from '../apps/web/src/three/world/worldJobs.ts'
import { createHeightSource } from '../apps/web/src/three/world/worldTerrain.ts'
import { detailedWaterMesh,waterMeshHeightAt } from '../apps/web/src/three/world/worldHydrology.ts'
import { interpolateCell } from '../apps/web/src/three/world/cdlod.ts'

const world=createClimateWorld(),started=performance.now(),macro=buildWorldMacro(world),source=createHeightSource(world,macro),mesh=detailedWaterMesh(macro,source.heightAt)
const [nx,nz]=macro.points,p=mesh.positions
const floor=(x,z)=>{
  const ix=Math.floor(x-macro.origin[0]),iz=Math.floor(z-macro.origin[1]),x0=macro.origin[0]+ix,z0=macro.origin[1]+iz
  return interpolateCell(Math.fround(source.heightAt(x0,z0)),Math.fround(source.heightAt(x0+1,z0)),Math.fround(source.heightAt(x0,z0+1)),Math.fround(source.heightAt(x0+1,z0+1)),x-x0,z-z0)
}
let triangles=0,underground=0,unsupportedRiver=0,maxRiverDepth=0,maxLakeDepth=0,maxQueryError=0
const examples=[]
for(let cell=0;cell<(nx-1)*(nz-1);cell++){
  const i=cell%(nx-1),j=Math.floor(cell/(nx-1)),k=j*nx+i,lake=[k,k+1,k+nx,k+nx+1].some(index=>macro.lake?.[index])
  const from=mesh.cellOffsets?.[cell]??0,to=mesh.cellOffsets?.[cell+1]??0
  for(let t=from;t<to;t+=3){
    const ids=[mesh.indices[t]*3,mesh.indices[t+1]*3,mesh.indices[t+2]*3]
    const x=ids.reduce((sum,index)=>sum+p[index],0)/3,y=ids.reduce((sum,index)=>sum+p[index+1],0)/3,z=ids.reduce((sum,index)=>sum+p[index+2],0)/3,depth=y-floor(x,z)
    triangles++;if(depth<-.03)underground++
    if(lake)maxLakeDepth=Math.max(maxLakeDepth,depth);else{maxRiverDepth=Math.max(maxRiverDepth,depth);if(depth>2.53)unsupportedRiver++}
    const query=waterMeshHeightAt(mesh,macro,x,z)
    maxQueryError=Math.max(maxQueryError,query===null?Infinity:Math.abs(y-query))
    if(!lake&&depth>1&&depth<2.5&&examples.length<8)examples.push({x,y,z,bed:floor(x,z)})
  }
}
const report={date:new Date().toISOString(),world:world.name,seed:world.seed,size:world.terrain.size,macro:macro.stats,vertices:p.length/3,triangles,patches:mesh.patches?.length,underground,unsupportedRiver,maxRiverDepth,maxLakeDepth,maxQueryError,arrayBytes:[mesh.positions,mesh.indices,mesh.levels,mesh.depths,mesh.triangles,mesh.cellOffsets,mesh.normals,...mesh.patches?.map(patch=>patch.indices)??[]].reduce((sum,value)=>sum+(value?.byteLength??0),0),milliseconds:Math.round(performance.now()-started),examples}
await mkdir('.cache/benchmark-three',{recursive:true});await writeFile('.cache/benchmark-three/hydrology-2026-11-06.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
if(underground||unsupportedRiver||maxQueryError>.001)process.exitCode=1
