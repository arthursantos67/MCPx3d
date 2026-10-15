import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'

const close = (a: number, b: number) => Math.abs(a-b)<0.00002
function bounds(vertices: number[]) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
  vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)})
  return {min,max}
}
function canonicalBatch(node: SceneNode, size: number) {
  if(node.kind!=='mesh' || node.rotation.some(Boolean) || node.scale.some(v=>!close(v,1))) return false
  const {min,max}=bounds(node.geometry.vertices)
  return node.position.every((v,i)=>close(v,(min[i]+max[i])/2*size)) && node.dimensions.every((v,i)=>close(v,(max[i]-min[i])*size))
}

/** Surgical migration: remove only the legacy stone face underneath the wood finish.
 * Materials, custom children, transforms and every other foundation triangle are preserved.
 * Edited/transformed batches that no longer match the compiler's coordinate convention are left alone.
 */
export function migrateHouseFloorSurfaces(document: ThreeSceneDocument): ThreeSceneDocument {
  const replacements=new Map<string,SceneNode>()
  for(const root of document.nodes) {
    if(root.asset?.type!=='house') continue
    const parts=document.nodes.filter(node=>node.parentId===root.id)
    const stone=parts.find(node=>/\.foundation(?:@\d+)*$/.test(node.id)), floor=parts.find(node=>/\.floors(?:@\d+)*$/.test(node.id))
    if(!stone || !floor || !canonicalBatch(stone,root.asset.size) || !canonicalBatch(floor,root.asset.size)) continue
    const a=stone.geometry,b=floor.geometry
    if(a.vertices.length<72 || b.vertices.length<72 || a.indices.length<30) continue
    const top=(vertices:number[])=>[16,17,18,19].map(i=>vertices.slice(i*3,i*3+3))
    const outer=top(a.vertices),inner=top(b.vertices),y=outer[0][1]
    if(!outer.every(p=>close(p[1],y)) || !inner.every(p=>close(p[1],y))) continue
    if(![16,17,18,16,18,19].every((v,i)=>a.indices[24+i]===v)) continue
    const xs=outer.map(p=>p[0]),zs=outer.map(p=>p[2]),ix=inner.map(p=>p[0]),iz=inner.map(p=>p[2])
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs)
    const left=Math.min(...ix),right=Math.max(...ix),back=Math.min(...iz),front=Math.max(...iz)
    if(!(left>x0 && right<x1 && back>z0 && front<z1)) continue
    const geometry={...a,vertices:[...a.vertices],indices:[...a.indices.slice(0,24),...a.indices.slice(30)],uvs:[...a.uvs],normals:[...a.normals]}
    const quad=(l:number,r:number,b:number,f:number)=>{
      const offset=geometry.vertices.length/3
      for(const [x,z] of [[l,f],[r,f],[r,b],[l,b]]) {
        geometry.vertices.push(x,y,z)
        if(geometry.uvs.length) geometry.uvs.push(x-x0,z1-z)
        if(geometry.normals.length) geometry.normals.push(0,1,0)
      }
      geometry.indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3)
    }
    quad(x0,left,z0,z1);quad(right,x1,z0,z1);quad(left,right,z0,back);quad(left,right,front,z1)
    replacements.set(stone.id,{...stone,geometry})
  }
  return replacements.size?{...document,nodes:document.nodes.map(node=>replacements.get(node.id)??node)}:document
}
