import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'
import { compileTerrainRoads, legacyRoadSource } from './sceneRoads.ts'

/** Rebuild compiler routes against final terrain topology; arbitrary meshes stay untouched. */
export function conformTerrainPaths(doc:ThreeSceneDocument):ThreeSceneDocument {
  const byId=new Map(doc.nodes.map(node=>[node.id,node])),networks=new Map<string,SceneNode[]>()
  const grounds=doc.nodes.filter(node=>node.visible&&!node.parentId&&!node.rotation.some(Boolean)&&node.role!=='path'&&node.material.texture!=='water')
  const terrains=grounds.filter(node=>node.kind==='terrain'),planes=grounds.filter(node=>node.kind==='plane')
  const unambiguous=terrains.length===1?terrains[0]:terrains.length===0&&planes.length===1?planes[0]:undefined
  for(const node of doc.nodes) {
    if(node.role!=='path'||node.kind!=='mesh'||node.parentId||node.rotation.some(Boolean)||node.scale.some(v=>v!==1)||!node.visible) continue
    const support=node.path?byId.get(node.path.supportId):node.overlapWith.map(id=>byId.get(id)).find(n=>n?.kind==='terrain'||n?.kind==='plane')??unambiguous
    if(!support||!['terrain','plane'].includes(support.kind)||support.parentId||support.rotation.some(Boolean)) continue
    const path=node.path??legacyRoadSource(node,support.id)
    if(!path) continue
    let source=node.path?node:{...node,path}
    if(node.path && node.geometry.uvs.length===node.geometry.vertices.length/3*2) {
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
      node.geometry.vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)})
      const cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2,sx=node.dimensions[0]/(max[0]-min[0]||1),sz=node.dimensions[2]/(max[2]-min[2]||1)
      if(Math.abs(node.position[0]-cx)>1e-7||Math.abs(node.position[2]-cz)>1e-7||Math.abs(sx-1)>1e-7||Math.abs(sz-1)>1e-7) {
        source={...node,path:{...path,width:Math.max(1,Math.min(16,path.width*Math.sqrt(sx*sz))),points:path.points.map(([x,z])=>[node.position[0]+(x-cx)*sx,node.position[2]+(z-cz)*sz])}}
      }
    }
    networks.set(support.id,[...networks.get(support.id)??[],source])
  }
  const replacements=new Map<string,SceneNode>()
  for(const [supportId,network] of networks) {
    const compiled=compileTerrainRoads(network,byId.get(supportId)!)
    for(const source of network) {
      const geometry=compiled.get(source.id),original=byId.get(source.id)!
      if(!geometry) {
        replacements.set(source.id,{...source,visible:false,collidable:false})
        continue
      }
      const same=(a:number[],b:number[])=>a===b||(a.length===b.length&&a.every((v,i)=>v===b[i]))
      if(original.path&&same(original.geometry.vertices,geometry.geometry.vertices)&&same(original.geometry.indices,geometry.geometry.indices)&&same(original.position,geometry.position)&&same(original.dimensions,geometry.dimensions)) continue
      replacements.set(source.id,{...source,...geometry})
    }
  }
  return replacements.size?{...doc,nodes:doc.nodes.map(node=>replacements.get(node.id)??node)}:doc
}
