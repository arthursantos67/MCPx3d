import * as THREE from 'three'
import {catalogModelData,loadModelCatalog,searchCatalog,type ModelCatalog} from './sceneModelCatalog.ts'
import {createEmptyScene,hasSurface,type SceneNode} from './sceneDocument.ts'
import {sceneMatrices} from './scenePlacement.ts'
import {importGlb} from './importGlb.ts'

/** The agent gets a bounded selection of real IDs, never thousands of meshes in its context. */
export function catalogBrief(catalog:ModelCatalog,request:string):string {
  const selected=new Map<string,typeof catalog.models[number]>(),terms=request.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]{4,}/g)??[]
  for(const term of terms)for(const model of searchCatalog(catalog,term).slice(0,5))selected.set(model.id,model)
  for(const pack of catalog.packs)for(const model of catalog.models.filter(model=>model.pack===pack.id).slice(0,2))if(selected.size<96)selected.set(model.id,model)
  return '\nCATÁLOGO LOCAL: prefira modelos reais compatíveis entre si e com o tema. Use node.catalog={id,height} (altura em metros), kind="group", prefab=null. Transformações e repeat funcionam normalmente; não invente IDs. Personagens animados continuam nos prefabs nativos; este catálogo contém objetos estáticos. Disponíveis:\n'+[...selected.values()].slice(0,96).map(model=>`${model.id}: ${model.name}`).join('\n')
}

async function abortable<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return work
  signal.throwIfAborted();let cancel:()=>void=()=>{}
  const stopped=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason??new DOMException('Cancelado','AbortError'));signal.addEventListener('abort',cancel,{once:true})})
  try{return await Promise.race([work,stopped])}finally{signal.removeEventListener('abort',cancel)}
}
export async function generationCatalog(request:string,signal?:AbortSignal):Promise<{catalog:ModelCatalog|null;brief:string}> {
  if(typeof window==='undefined')return {catalog:null,brief:''}
  try{const catalog=await abortable(loadModelCatalog(),signal);return{catalog,brief:catalogBrief(catalog,request)}}catch(error){if(signal?.aborted)throw error;return{catalog:null,brief:'\nCatálogo local indisponível nesta chamada; utilize os prefabs integrados.'}}
}

/** Decode each selected model once, then let the existing template expander handle copies and grounding. */
export async function resolveCatalogParts(recipe:unknown,catalog:ModelCatalog|null,signal:AbortSignal):Promise<Map<string,SceneNode[]>> {
  const parts=new Map<string,SceneNode[]>(),data=recipe as {nodes?:Record<string,unknown>[]}
  const references=data&&Array.isArray(data.nodes)?data.nodes.filter(node=>node&&node.catalog):[]
  if(!references.length)return parts
  if(!catalog)throw new Error('A receita pede modelos de um catálogo indisponível.')
  if(references.length>24)throw new Error('Use até 24 famílias do catálogo por cena; repeat cria as cópias.')
  const decoded=new Map<string,SceneNode[]>()
  for(const node of references){
    signal.throwIfAborted()
    const ref=node.catalog as {id?:string;height?:number},model=catalog.models.find(model=>model.id===ref.id),pack=model&&catalog.packs.find(pack=>pack.id===model.pack)
    if(!model||!pack||typeof ref.height!=='number'||!Number.isFinite(ref.height)||ref.height<.05||ref.height>100)throw new Error(`Referência de catálogo inválida: ${String(ref.id)}`)
    let original=decoded.get(model.id)
    if(!original){const result=await abortable(importGlb(await abortable(catalogModelData(model,pack),signal),model.name,createEmptyScene()),signal);original=result.document.nodes;decoded.set(model.id,original)}
    const copied=structuredClone(original),root=copied[0];root.position=[0,0,0]
    const matrices=sceneMatrices({...createEmptyScene(),nodes:copied}),bounds=new THREE.Box3()
    for(const part of copied)if(hasSurface(part.kind))bounds.union(new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrices.get(part.id)!.clone().scale(new THREE.Vector3(...part.dimensions))))
    const factor=ref.height/Math.max(.001,bounds.getSize(new THREE.Vector3()).y)
    const id=String(node.id),ids=new Map(copied.map((part,index)=>[part.id,index?`${id}.model-${index}`:id]))
    parts.set(id,copied.slice(1).map(part=>({...part,id:ids.get(part.id)!,parentId:ids.get(part.parentId!)??id,collidable:node.collidable!==false,
      position:[part.position[0]*factor,(part.position[1]-bounds.min.y)*factor,part.position[2]*factor],dimensions:part.dimensions.map(value=>value*factor) as [number,number,number]})))
  }
  signal.throwIfAborted();return parts
}
