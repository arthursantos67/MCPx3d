import * as THREE from 'three'
import { hasSurface, type ThreeSceneDocument } from './sceneDocument.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { buildNodeGeometry, geometryKey } from './sceneGeometry.ts'
import { MeshBVH } from 'three-mesh-bvh'

export interface SurfaceConflict { a: string; b: string; nameA: string; nameB: string; area: number; point: [number,number,number] }
interface Face { id:string; name:string; points:[number,number][]; minX:number;maxX:number;minY:number;maxY:number;normal:THREE.Vector3; distance:number; axis:number }
const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
function overlapArea(subject:[number,number][],clip:[number,number][]) {
  let polygon=subject
  const orientation=Math.sign(cross(clip[0],clip[1],clip[2]))
  for(let edge=0;edge<3 && polygon.length;edge++) {
    const a=clip[edge],b=clip[(edge+1)%3],input=polygon
    polygon=[]
    for(let i=0;i<input.length;i++) {
      const p=input[i],q=input[(i+1)%input.length],dp=cross(a,b,p)*orientation,dq=cross(a,b,q)*orientation
      if(dp>=-1e-9) polygon.push(p)
      if((dp>0 && dq<0)||(dp<0 && dq>0)) { const t=dp/(dp-dq);polygon.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]) }
    }
  }
  return {area:Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-q[0]*p[1]},0))/2,
    center:polygon.length?[polygon.reduce((sum,p)=>sum+p[0],0)/polygon.length,polygon.reduce((sum,p)=>sum+p[1],0)/polygon.length]:[0,0]}
}

/** Finds coplanar surfaces even inside an assembly and without volumetric overlap.
 * Area is measured from actual projected triangles, so adjacent tiles and their shared diagonals are safe.
 */
export function inspectSurfaceConflicts(document:ThreeSceneDocument, options:{maxTriangles?:number;maxMilliseconds?:number}={}) {
  const start=performance.now(),limit=options.maxTriangles??200000,deadline=options.maxMilliseconds??4000
  const matrices=sceneMatrices(document),byId=new Map(document.nodes.map(n=>[n.id,n])),planes=new Map<string,Face[]>(),geometries=new Map<string,THREE.BufferGeometry>()
  const conflicts=new Map<string,SurfaceConflict>()
  const solids:{bounds:THREE.Box3;inverse:THREE.Matrix4;geometry:THREE.BufferGeometry}[]=[],trees=new Map<THREE.BufferGeometry,MeshBVH>(),buriedCache=new Map<string,boolean>()
  const buried=(point:THREE.Vector3)=>{
    const key=point.toArray().map(v=>Math.round(v*1000)).join(',')
    if(buriedCache.has(key)) return buriedCache.get(key)!
    let result=false
    for(const solid of solids) {
      if(!solid.bounds.containsPoint(point)) continue
      if(!trees.has(solid.geometry)) trees.set(solid.geometry,new MeshBVH(solid.geometry,{indirect:true}))
      let votes=0
      for(const direction of [[0.918,0.257,0.302],[-0.331,0.891,0.311],[0.219,-0.417,0.882]]) {
        const ray=new THREE.Ray(point.clone(),new THREE.Vector3(...direction).normalize()).applyMatrix4(solid.inverse)
        const hits=trees.get(solid.geometry)!.raycast(ray,THREE.DoubleSide).sort((a,b)=>a.distance-b.distance)
        let winding=0
        for(let i=0;i<hits.length;) {
          const distance=hits[i].distance,signs=new Set<number>()
          while(i<hits.length && Math.abs(hits[i].distance-distance)<1e-7) {const hit=hits[i++];if(hit.face) signs.add(Math.sign(hit.face.normal.dot(ray.direction)))}
          for(const sign of signs) winding+=sign
        }
        if(Math.abs(winding)>0.5) votes++
      }
      if(votes>=2) {result=true;break}
    }
    buriedCache.set(key,result)
    return result
  }
  let triangles=0,complete=true,comparisons=0
  const eligible=(id:string)=>{for(let node=byId.get(id);node;node=node.parentId?byId.get(node.parentId):undefined) if(!node.visible || node.animation.kind!=='none') return false;return true}
  try {
    scan:for(const node of document.nodes) {
      if(!hasSurface(node.kind) || !['box','roundedBox','plane','mesh','extrude'].includes(node.kind) || node.material.alphaTest!>0 || node.material.transparent || node.material.opacity!<1 || !eligible(node.id)) continue
      const key=geometryKey(node)
      if(!geometries.has(key)) geometries.set(key,buildNodeGeometry(node))
      const geometry=geometries.get(key)!,positions=geometry.getAttribute('position'),index=geometry.index,matrix=matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))
      solids.push({geometry,inverse:matrix.clone().invert(),bounds:geometry.boundingBox!.clone().applyMatrix4(matrix)})
      const count=index?index.count:positions.count
      for(let i=0;i<count;i+=3) {
        if(++triangles>limit || ((triangles&511)===0 && performance.now()-start>deadline)) {complete=false;break scan}
        const points=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+k):i+k).applyMatrix4(matrix))
        const normal=new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]),points[2].clone().sub(points[0]))
        if(normal.length()/2<0.01) continue
        normal.normalize()
        const axis=Math.abs(normal.x)>Math.abs(normal.y)?(Math.abs(normal.x)>Math.abs(normal.z)?0:2):(Math.abs(normal.y)>Math.abs(normal.z)?1:2)
        const canonical=normal.clone().multiplyScalar(Math.sign(normal.getComponent(axis)))
        const plane=[canonical.x,canonical.y,canonical.z,canonical.dot(points[0])].map(v=>Math.round(v*10000)).join(',')
        const axes=[0,1,2].filter(v=>v!==axis),projected=points.map(p=>[p.getComponent(axes[0]),p.getComponent(axes[1])] as [number,number])
        const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1])
        const face:Face={id:node.id,name:node.name,points:projected,minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys),normal,distance:normal.dot(points[0]),axis}
        const bucket=planes.get(plane)??[];bucket.push(face);planes.set(plane,bucket)
      }
    }
    outer:for(const list of planes.values()) {
      list.sort((a,b)=>a.minX-b.minX)
      for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length && list[j].minX<list[i].maxX-1e-5;j++) {
        if((++comparisons&1023)===0 && performance.now()-start>deadline) {complete=false;break outer}
        const a=list[i],b=list[j]
        if(a.id===b.id || a.maxY<=b.minY+1e-5 || b.maxY<=a.minY+1e-5 || a.normal.dot(b.normal)<0.9999) continue
        const overlap=overlapArea(a.points,b.points),area=overlap.area/Math.max(Math.abs(a.normal.x),Math.abs(a.normal.y),Math.abs(a.normal.z))
        if(area<0.01) continue
        const axes=[0,1,2].filter(v=>v!==a.axis),point=new THREE.Vector3()
        point.setComponent(axes[0],overlap.center[0]);point.setComponent(axes[1],overlap.center[1])
        point.setComponent(a.axis,(a.distance-point.dot(a.normal))/a.normal.getComponent(a.axis))
        if(buried(point.addScaledVector(a.normal,0.002))) continue
        const ids=[a.id,b.id].sort(),key=ids.join('|'),existing=conflicts.get(key)
        if(existing) existing.area+=area
        else conflicts.set(key,{a:a.id,b:b.id,nameA:a.name,nameB:b.name,area,point:point.toArray() as [number,number,number]})
        if(conflicts.size>=200) {complete=false;break outer}
      }
    }
  } finally {for(const geometry of geometries.values()) geometry.dispose()}
  return {conflicts:[...conflicts.values()].map(issue=>({...issue,area:Math.round(issue.area*1000)/1000})),complete,triangles,elapsedMs:performance.now()-start}
}
