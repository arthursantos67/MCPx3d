import type { ThreeSceneDocument } from './sceneDocument.ts'

/** Browser drafts share repeated geometry; exports remain ordinary self-contained scene JSON. */
export function serializeSceneDraft(scene:ThreeSceneDocument):string {
  const entries=new Map<string,{count:number;index:number}>(), library:unknown[]=[]
  const keys=scene.nodes.map(node=>JSON.stringify(node.geometry))
  for(const key of keys) {const entry=entries.get(key);if(entry) entry.count++;else entries.set(key,{count:1,index:-1})}
  const nodes=scene.nodes.map((node,i)=>{
    const key=keys[i],entry=entries.get(key)!
    if(key.length<256 || entry.count<2) return node
    if(entry.index<0) {entry.index=library.length;library.push(node.geometry)}
    return {...node,geometry:{draftGeometry:entry.index}}
  })
  return JSON.stringify(library.length?{...scene,nodes,geometryLibrary:library}:scene)
}

/** Resolve only local draft references, enforcing the expanded byte budget before validation clones arrays. */
export function expandSceneDraft(value:unknown,maxNodes:number,maxBytes:number):unknown {
  if(!value || typeof value!=='object' || Array.isArray(value)) return value
  const raw=value as Record<string,unknown>
  if(raw.geometryLibrary===undefined) return raw
  if(!Array.isArray(raw.nodes) || raw.nodes.length>maxNodes || !Array.isArray(raw.geometryLibrary) || raw.geometryLibrary.length>maxNodes) throw new Error('Biblioteca de geometrias do rascunho inválida.')
  const encoder=new TextEncoder(),library=raw.geometryLibrary
  const sizes=library.map(geometry=>encoder.encode(JSON.stringify(geometry)).byteLength)
  let expandedBytes=encoder.encode(JSON.stringify({...raw,geometryLibrary:undefined})).byteLength
  const nodes=raw.nodes.map(value=>{
    if(!value || typeof value!=='object' || Array.isArray(value)) return value
    const node=value as Record<string,unknown>,geometry=node.geometry
    if(!geometry || typeof geometry!=='object' || Array.isArray(geometry) || !('draftGeometry' in geometry)) return node
    const reference=geometry as Record<string,unknown>,index=reference.draftGeometry
    if(Object.keys(reference).length!==1 || typeof index!=='number' || !Number.isInteger(index) || index<0 || index>=library.length) throw new Error('Referência de geometria do rascunho inválida.')
    expandedBytes+=sizes[index]-JSON.stringify(reference).length
    if(expandedBytes>maxBytes) throw new Error('O projeto expandido excede o limite de 32 MB.')
    return {...node,geometry:library[index]}
  })
  const {geometryLibrary:_library,...document}=raw
  return {...document,nodes}
}
