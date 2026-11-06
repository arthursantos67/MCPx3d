import { unzipSync } from 'three/addons/libs/fflate.module.js'

export interface CatalogPack { id: string; name: string; category: string; style: string; author: string; license: string; source: string; file: string; bytes: number; sha256: string; models: number }
export interface CatalogModel { id: string; name: string; pack: string; entry: string; thumbnail: string | null; bytes: number; sha256: string }
export interface ModelCatalog { version: number; packs: CatalogPack[]; models: CatalogModel[] }
const base = `${(import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}models/catalog/`
const banks = new Map<string,Uint8Array>(), pending = new Map<string,Promise<Uint8Array>>()
let catalog: Promise<ModelCatalog> | null = null
export function loadModelCatalog(): Promise<ModelCatalog> {
  return catalog ??= fetch(`${base}manifest.json`,{signal:AbortSignal.timeout(15000)}).then(async response=>{
    if(!response.ok) throw new Error('Não foi possível abrir o catálogo de modelos.')
    const data=await response.json() as ModelCatalog
    if(data.version!==1 || !Array.isArray(data.packs) || !Array.isArray(data.models)) throw new Error('Catálogo de modelos inválido.')
    return data
  }).catch(error=>{catalog=null;throw error})
}
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const synonyms: Record<string,string[]> = {
  arvore:['tree'],pedra:['rock','stone'],rocha:['rock'],colina:['hill'],montanha:['mountain'],
  arma:['weapon','gun','blaster','sword'],espada:['sword'],escudo:['shield'],machado:['axe'],
  parede:['wall'],piso:['floor','tile'],porta:['door'],escada:['stairs','staircase','ladder'],
  casa:['house','building'],carro:['car','sedan','suv'],barco:['boat','ship'],
  mesa:['table','desk'],cadeira:['chair'],bau:['chest'],caixa:['crate','box'],barril:['barrel'],
  cerca:['fence'],ponte:['bridge'],castelo:['castle'],flor:['flower'],comida:['food'],
}
export function searchCatalog(data: ModelCatalog,query: string,packId='',category=''): CatalogModel[] {
  const packs=new Map(data.packs.map(pack=>[pack.id,pack])),terms=normalized(query).split(/\s+/).filter(Boolean)
  return data.models.filter(model=>{
    const pack=packs.get(model.pack)
    if(!pack || packId && model.pack!==packId || category && pack.category!==category) return false
    const text=normalized(`${model.name} ${model.entry} ${pack.name} ${pack.category} ${pack.author}`)
    return terms.every(term=>[term,...synonyms[term]??[]].some(word=>text.includes(word)))
  })
}
async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(value=>value.toString(16).padStart(2,'0')).join('')
}
async function bank(pack: CatalogPack): Promise<Uint8Array> {
  const cached=banks.get(pack.id)
  if(cached) {banks.delete(pack.id);banks.set(pack.id,cached);return cached}
  if(pending.has(pack.id)) return pending.get(pack.id)!
  const request=fetch(`${base}${pack.file}`,{signal:AbortSignal.timeout(30000)}).then(async response=>{
    if(!response.ok) throw new Error(`Não foi possível carregar a coleção ${pack.name}.`)
    const bytes=new Uint8Array(await response.arrayBuffer())
    if(bytes.byteLength!==pack.bytes || await sha256(bytes)!==pack.sha256) throw new Error(`A coleção ${pack.name} está incompleta ou foi alterada.`)
    banks.set(pack.id,bytes)
    // Keep compressed banks only; decoded meshes are owned by the import, not this browser cache.
    while(banks.size>2 || banks.size>1 && [...banks.values()].reduce((sum,value)=>sum+value.byteLength,0)>16*1024*1024) banks.delete(banks.keys().next().value!)
    return bytes
  }).finally(()=>pending.delete(pack.id))
  pending.set(pack.id,request);return request
}
async function entry(pack: CatalogPack,name: string): Promise<Uint8Array> {
  const bytes=unzipSync(await bank(pack),{filter:file=>file.name===name && file.originalSize<=16*1024*1024})[name]
  if(!bytes) throw new Error(`Arquivo ausente na coleção ${pack.name}: ${name}`)
  return bytes
}
export async function catalogModelData(model: CatalogModel,pack: CatalogPack): Promise<ArrayBuffer> {
  const bytes=await entry(pack,model.entry)
  if(bytes.byteLength!==model.bytes || await sha256(bytes)!==model.sha256) throw new Error('O modelo não corresponde ao manifesto da coleção.')
  return bytes.slice().buffer
}
export async function catalogThumbnail(model: CatalogModel,pack: CatalogPack): Promise<string | null> {
  if(!model.thumbnail) return null
  const bytes=await entry(pack,model.thumbnail)
  return URL.createObjectURL(new Blob([bytes.slice().buffer],{type:'image/png'}))
}
