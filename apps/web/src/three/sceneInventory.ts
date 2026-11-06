import { itemKey, type CraftRecipe, type ItemStack } from './sceneGameplay.ts'
import type { ThreeSceneDocument } from './sceneDocument.ts'

export type CraftCell = ItemStack | null
export type BagCell=ItemStack|null
export const CURSOR_SLOT = 256
/** Layout never owns quantities: reconcile it with the authoritative inventory after crafting/collection. */
export function syncBagCells(layout:readonly BagCell[],items:ReadonlyMap<string,number>):BagCell[] {
  const remaining=new Map([...items].map(([name,count])=>[itemKey(name),{name,count}]))
  const cells:BagCell[]=layout.slice(0,CURSOR_SLOT+1).map(cell=>{
    if(!cell||typeof cell.item!=='string'||!Number.isInteger(cell.amount)||cell.amount<=0)return null
    const stock=remaining.get(itemKey(cell.item)),amount=Math.min(cell.amount,stock?.count??0)
    if(!stock||!amount)return null
    stock.count-=amount;return{item:stock.name,amount}
  })
  for(const stock of remaining.values())if(stock.count>0){const found=cells.find(cell=>cell&&itemKey(cell.item)===itemKey(stock.name));if(found)found.amount+=stock.count;else{const empty=cells.indexOf(null);if(empty>=0)cells[empty]={item:stock.name,amount:stock.count};else cells.push({item:stock.name,amount:stock.count})}}
  while(cells.length<=CURSOR_SLOT)cells.push(null)
  return cells
}
/** Closing an inventory returns the carried stack without changing the owned quantities. */
export function releaseBagCursor(layout:readonly BagCell[]):BagCell[] {
  const cells=layout.map(cell=>cell?{...cell}:null),cursor=cells[CURSOR_SLOT]
  if(!cursor)return cells
  const target=cells.findIndex((cell,index)=>index<CURSOR_SLOT&&cell&&itemKey(cell.item)===itemKey(cursor.item))
  const empty=cells.findIndex((cell,index)=>index<CURSOR_SLOT&&!cell),to=target>=0?target:empty
  if(to<0)return cells
  cells[to]={item:cursor.item,amount:(cells[to]?.amount??0)+cursor.amount};cells[CURSOR_SLOT]=null
  return cells
}
/** Split, merge, swap and move preserve the exact total of each item. */
export function arrangeBagCells(layout:readonly BagCell[],from:number,to:number,requested:number):{cells:BagCell[];moved:number} {
  const cells=layout.map(cell=>cell?{...cell}:null),source=cells[from],target=cells[to]
  if(!source||from===to||!Number.isInteger(from)||!Number.isInteger(to)||to<0||to>=cells.length||!Number.isInteger(requested)||requested<=0)return{cells,moved:0}
  const amount=Math.min(source.amount,requested)
  if(target&&itemKey(target.item)!==itemKey(source.item)){if(amount!==source.amount)return{cells,moved:0};[cells[from],cells[to]]=[target,source]}
  else{cells[to]={item:source.item,amount:(target?.amount??0)+amount};source.amount-=amount;if(!source.amount)cells[from]=null}
  return{cells,moved:amount}
}
/** Only games with actual item mechanics expose an inventory. */
export function sceneHasInventory(scene: ThreeSceneDocument): boolean {
  const rules = scene.environment.gameplay
  return !!(rules?.startingItems.length || rules?.recipes.length || rules?.naturalResources || rules?.quests.some(quest => quest.rewards.length) || scene.nodes.some(node => node.resource || node.interaction?.action === 'collect' && node.interaction.item))
}
/** Workbench cells reserve existing stacks without creating or consuming items. */
export function availableCraftCells(cells: CraftCell[], items: { name: string; count: number }[]): CraftCell[] {
  const remaining = new Map(items.map(item => [itemKey(item.name), item.count]))
  return cells.map(cell => {
    if (!cell) return null
    const key = itemKey(cell.item), amount = Math.min(cell.amount, remaining.get(key) ?? 0)
    remaining.set(key, (remaining.get(key) ?? 0) - amount)
    return amount > 0 ? { item: cell.item, amount } : null
  })
}
export function workbenchRecipe<T extends CraftRecipe>(cells: CraftCell[], recipes: readonly T[]): T | null {
  const totals = new Map<string, number>()
  for (const cell of cells) if (cell) totals.set(itemKey(cell.item), (totals.get(itemKey(cell.item)) ?? 0) + cell.amount)
  return recipes.find(recipe => totals.size === recipe.inputs.length && recipe.inputs.every(input => (totals.get(itemKey(input.item)) ?? 0) >= input.amount)) ?? null
}
export function consumeCraftCells(cells: CraftCell[], recipe: CraftRecipe): CraftCell[] {
  const needed = new Map(recipe.inputs.map(input => [itemKey(input.item), input.amount]))
  return cells.map(cell => {
    if (!cell) return null
    const key = itemKey(cell.item), used = Math.min(cell.amount, needed.get(key) ?? 0)
    needed.set(key, (needed.get(key) ?? 0) - used)
    return cell.amount > used ? { ...cell, amount: cell.amount - used } : null
  })
}
/** Atomic chest transfer with exact conservation at stack/capacity limits. */
export function transferInventoryStack(from: Map<string, number>, to: Map<string, number>, name: string, requested: number): number {
  const source = [...from.keys()].find(key => itemKey(key) === itemKey(name))
  if (!source || !Number.isInteger(requested) || requested <= 0) return 0
  const target = [...to.keys()].find(key => itemKey(key) === itemKey(name)) ?? source
  if (!to.has(target) && to.size >= 64) return 0
  const amount = Math.max(0, Math.min(requested, from.get(source)!, 100000 - (to.get(target) ?? 0)))
  if (!amount) return 0
  const left = from.get(source)! - amount
  if (left) from.set(source, left); else from.delete(source)
  to.set(target, (to.get(target) ?? 0) + amount)
  return amount
}
