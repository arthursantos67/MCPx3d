import { createNode, subtreeIds, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { prefabParts } from './scenePrefabs.ts'

/** Replace generated structure, retaining independently authored contents and external references. */
export function replaceAssetNodes(document:ThreeSceneDocument,root:SceneNode,rebuilt:SceneNode[]):SceneNode[] {
  const descendants=subtreeIds(document.nodes,root.id),byId=new Map(document.nodes.map(node=>[node.id,node]))
  const oldParts=root.asset?prefabParts(root.asset):[],generated=new Set<string>([root.id]),partNames=new Map<string,string>()
  const owner=(node:SceneNode)=>{for(let p=node.parentId?byId.get(node.parentId):undefined;p;p=p.parentId?byId.get(p.parentId):undefined) if(p.asset) return p.id;return null}
  for(const node of document.nodes) {
    if(!descendants.has(node.id) || node.id===root.id) continue
    if(!root.asset) {generated.add(node.id);continue}
    if(node.asset || owner(node)!==root.id) continue
    // Old documents predate assetPart but retain the compiler's canonical IDs.
    const legacy=oldParts.find(part=>node.id.replace(/(@\d+)+$/,'')===`${root.id.replace(/([@~]\d+)+$/,'')}.${part.id}`)
    const part=node.assetPart??legacy?.id
    if(part) {generated.add(node.id);partNames.set(node.id,part)}
  }
  const newParts=new Map(rebuilt.filter(node=>node.assetPart).map(node=>[node.assetPart!,node.id]))
  const mapping=new Map<string,string>([[root.id,root.id]])
  for(const [id,part] of partNames) {const next=newParts.get(part);if(next) mapping.set(id,next)}
  const retained=document.nodes.filter(node=>!generated.has(node.id)),holders=new Map<string,SceneNode>()
  // A removed part can still be an authored object's coordinate frame. Preserve that frame as a group.
  const preserveParent=(id:string|null):void=>{
    if(!id || !generated.has(id) || mapping.has(id) || holders.has(id)) return
    const source=byId.get(id)!
    holders.set(id,{...createNode('group',source.parentId),id:source.id,name:source.name,position:source.position,rotation:source.rotation,scale:source.scale,visible:source.visible,animation:source.animation})
    preserveParent(source.parentId)
  }
  for(const node of retained) if(descendants.has(node.id)) preserveParent(node.parentId)
  const replacements=rebuilt.map(node=>node.id===root.id?{...node,parentId:root.parentId,overlapWith:root.overlapWith,visible:root.visible}:node)
  const combined=[...retained,...holders.values(),...replacements],ids=new Set(combined.map(node=>node.id))
  const resolve=(id:string)=>mapping.get(id)??id
  const result=combined.map(node=>{
    const target=node.interaction?.targetId?resolve(node.interaction.targetId):null
    return {...node,parentId:node.parentId?resolve(node.parentId):null,overlapWith:[...new Set(node.overlapWith.map(resolve).filter(id=>ids.has(id)&&id!==node.id))],
      ...(node.interaction?{interaction:target&&!ids.has(target)?undefined:{...node.interaction,targetId:target}}:{}),
      ...(node.behavior?.routine?{behavior:{...node.behavior,routine:node.behavior.routine.map(step=>{const place=step.target?resolve(step.target):null;return {...step,target:place&&ids.has(place)&&place!==node.id?place:null}})}}:{})}
  })
  for(const node of result) if(node.interaction?.action==='toggleAnimation') {
    const target=node.interaction.targetId??node.id,scope=subtreeIds(result,target)
    if(!result.some(part=>scope.has(part.id)&&part.animation.kind!=='none')) delete node.interaction
  }
  return result
}
