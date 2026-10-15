import { Vector3 } from 'three'
import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'
import { terrainHeightAt, terrainHeights } from './sceneGeometrySpec.ts'
import { sceneMatrices } from './scenePlacement.ts'

/** Ground contacts require a surface test: a centre above terrain says nothing about a wide path's middle. */
export function inspectGroundQuality(scene:ThreeSceneDocument):string[] {
  const byId=new Map(scene.nodes.map(n=>[n.id,n])),matrices=sceneMatrices(scene),issues:string[]=[],point=new Vector3()
  const visible=(node:SceneNode):boolean=>node.visible&&(!node.parentId||visible(byId.get(node.parentId)!))
  const supports=scene.nodes.filter(n=>visible(n)&&!n.parentId&&!n.rotation.some(Boolean)&&['terrain','plane'].includes(n.kind)&&n.role!=='path'&&n.material.texture!=='water'&&n.collidable!==false)
  const heights=new Map(supports.filter(n=>n.kind==='terrain').map(n=>[n.id,terrainHeights(n.geometry)]))
  const height=(node:SceneNode,x:number,z:number)=>{
    const u=(x-node.position[0])/(node.dimensions[0]*node.scale[0]),v=(z-node.position[2])/(node.dimensions[2]*node.scale[2])
    if(Math.abs(u)>0.5||Math.abs(v)>0.5) return null
    return node.position[1]+(node.kind==='terrain'?terrainHeightAt(node.geometry,u,v,heights.get(node.id)):0)*node.dimensions[1]*node.scale[1]
  }
  let budget=60000
  for(const path of scene.nodes.filter(n=>visible(n)&&n.role==='path')) {
    const support=(path.path?byId.get(path.path.supportId):path.overlapWith.map(id=>byId.get(id)).find(n=>supports.includes(n!)))??(supports.length===1?supports[0]:undefined)
    if(!support||!supports.includes(support)) {issues.push(`Caminho sem superfície de apoio verificável: ${path.name}.`);continue}
    if(path.kind!=='mesh') {issues.push(`Caminho sem adaptação aos triângulos do terreno: ${path.name}.`);continue}
    const vertices=path.geometry.vertices,indices=path.geometry.indices,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
    vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)})
    const matrix=matrices.get(path.id)!,world=(index:number)=>new Vector3(...[0,1,2].map(axis=>(vertices[index*3+axis]-(min[axis]+max[axis])/2)/(max[axis]-min[axis]||1)*path.dimensions[axis])).applyMatrix4(matrix)
    let buried=false,floating=false,outside=false
    for(let i=0;i<indices.length&&!buried&&!floating;i+=3) {
      if(--budget<0) {issues.push('Cobertura incompleta da análise de caminhos: orçamento de triângulos atingido.');break}
      const a=world(indices[i]),b=world(indices[i+1]),c=world(indices[i+2])
      for(const [wa,wb,wc] of [[1/3,1/3,1/3],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5]]) {
        point.copy(a).multiplyScalar(wa).addScaledVector(b,wb).addScaledVector(c,wc)
        const y=height(support,point.x,point.z)
        if(y===null) {outside=true;continue}
        if(point.y<y-0.015) buried=true
        if(point.y>y+0.2) floating=true
      }
    }
    if(buried) issues.push(`Terreno atravessando o caminho: ${path.name}.`)
    if(floating) issues.push(`Trechos do caminho flutuam acima do apoio: ${path.name}.`)
    if(outside) issues.push(`Caminho ultrapassa os limites do terreno: ${path.name}.`)
    if(budget<0) break
  }
  for(let i=0;i<supports.length;i++) for(let j=i+1;j<supports.length;j++) {
    const a=supports[i],b=supports[j]
    if(a.dimensions[0]*a.scale[0]*a.dimensions[2]*a.scale[2]<16||b.dimensions[0]*b.scale[0]*b.dimensions[2]*b.scale[2]<16) continue
    const x0=Math.max(a.position[0]-a.dimensions[0]*a.scale[0]/2,b.position[0]-b.dimensions[0]*b.scale[0]/2),x1=Math.min(a.position[0]+a.dimensions[0]*a.scale[0]/2,b.position[0]+b.dimensions[0]*b.scale[0]/2)
    const z0=Math.max(a.position[2]-a.dimensions[2]*a.scale[2]/2,b.position[2]-b.dimensions[2]*b.scale[2]/2),z1=Math.min(a.position[2]+a.dimensions[2]*a.scale[2]/2,b.position[2]+b.dimensions[2]*b.scale[2]/2)
    if((x1-x0)<=0||(z1-z0)<=0||(x1-x0)*(z1-z0)<4) continue
    let lo=Infinity,hi=-Infinity
    for(let x=0;x<=4;x++) for(let z=0;z<=4;z++) {
      const px=x0+(x1-x0)*(0.02+0.96*x/4),pz=z0+(z1-z0)*(0.02+0.96*z/4),ha=height(a,px,pz),hb=height(b,px,pz)
      if(ha===null||hb===null) continue
      lo=Math.min(lo,ha-hb);hi=Math.max(hi,ha-hb)
    }
    if(Number.isFinite(lo)&&lo<=0.04&&hi>=-0.04) issues.push(`Superfícies de chão concorrentes: ${a.name} / ${b.name}.`)
  }
  return [...new Set(issues)]
}
