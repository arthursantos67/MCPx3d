import { itemKey,type GameplayItem,type ResourceKind,type SceneResource } from './sceneGameplay.ts'
import type { WeaponKind } from './sceneCombat.ts'

/** Explicit metadata wins; inference keeps older saved scenes compatible. */
export function resourceKind(resource:SceneResource):ResourceKind {
  if(resource.kind)return resource.kind
  const name=itemKey(resource.item)
  if(/madeira|wood|resina|timber/.test(name))return 'wood'
  if(/minerio|ore|cobre|iron|ferro/.test(name))return 'ore'
  if(/pedra|stone|rock/.test(name))return 'stone'
  if(/fibra|fiber|folha|erva/.test(name))return 'plant'
  if(/cogumelo|mushroom|fruta|berry|food/.test(name))return 'food'
  return 'custom'
}
export const resourceMethod=(resource:SceneResource)=>resource.method??(['plant','food'].includes(resourceKind(resource))?'gather':'strike')
/** Harvest power belongs to the tool/material pairing, independently of combat damage. */
export function harvestDamage(resource:SceneResource,weapon:WeaponKind,item?:GameplayItem):number {
  if(resourceMethod(resource)==='gather')return 0
  const kind=resourceKind(resource),power=item?.harvest??5
  if(kind==='wood')return weapon==='axe'?power:weapon==='none'?.75:weapon==='pickaxe'?.4:.25
  if(kind==='stone'||kind==='ore')return weapon==='pickaxe'?power:weapon==='none'?.5:weapon==='axe'?.25:.15
  return weapon==='none'?.75:Math.max(1,power*.5)
}
