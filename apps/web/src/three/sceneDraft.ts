import type { ThreeSceneDocument } from './sceneDocument.ts'

const fields=[{field:'geometry',library:'geometryLibrary',reference:'draftGeometry'},{field:'material',library:'materialLibrary',reference:'draftMaterial'}] as const

/** Browser drafts share repeated meshes and palette materials. Exports stay self-contained ordinary scene JSON. */
export function serializeSceneDraft(scene:ThreeSceneDocument):string {
  const nodes:Record<string,unknown>[]=scene.nodes.map(node=>({...node})),libraries:Record<string,unknown[]>={}
  for(const {field,library,reference}of fields){
    const entries=new Map<string,{count:number;index:number}>(),values:unknown[]=[]
    const keys=scene.nodes.map(node=>JSON.stringify(node[field]))
    for(const key of keys){const entry=entries.get(key);if(entry)entry.count++;else entries.set(key,{count:1,index:-1})}
    for(let i=0;i<nodes.length;i++){
      const key=keys[i],entry=entries.get(key)!
      if(key.length<256||entry.count<2)continue
      if(entry.index<0){entry.index=values.length;values.push(scene.nodes[i][field])}
      nodes[i][field]={[reference]:entry.index}
    }
    if(values.length)libraries[library]=values
  }
  return JSON.stringify({...scene,nodes,...libraries})
}

/** Resolve only local references. Check expanded bytes before validation duplicates geometry arrays or image strings. */
export function expandSceneDraft(value:unknown,maxNodes:number,maxBytes:number):unknown {
  if(!value||typeof value!=='object'||Array.isArray(value))return value
  const raw=value as Record<string,unknown>
  if(fields.every(({library})=>raw[library]===undefined))return raw
  if(!Array.isArray(raw.nodes)||raw.nodes.length>maxNodes)throw new Error('Biblioteca do rascunho inválida.')
  const encoder=new TextEncoder(),document={...raw},libraries=new Map<string,{values:unknown[];sizes:number[]}>()
  for(const {library}of fields){
    if(raw[library]===undefined)continue
    const values=raw[library]
    if(!Array.isArray(values)||values.length>maxNodes)throw new Error('Biblioteca do rascunho inválida.')
    libraries.set(library,{values,sizes:values.map(item=>encoder.encode(JSON.stringify(item)).byteLength)})
    delete document[library]
  }
  let expandedBytes=encoder.encode(JSON.stringify(document)).byteLength
  document.nodes=raw.nodes.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return value
    const node={...value as Record<string,unknown>}
    for(const {field,library,reference}of fields){
      const candidate=node[field]
      if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||!(reference in candidate))continue
      const ref=candidate as Record<string,unknown>,index=ref[reference],source=libraries.get(library)
      if(Object.keys(ref).length!==1||typeof index!=='number'||!Number.isInteger(index)||index<0||!source||index>=source.values.length)throw new Error('Referência do rascunho inválida.')
      expandedBytes+=source.sizes[index]-JSON.stringify(ref).length
      if(expandedBytes>maxBytes)throw new Error('O projeto expandido excede o limite de 32 MB.')
      node[field]=source.values[index]
    }
    return node
  })
  return document
}
