import type { WeaponKind } from './sceneCombat.ts'
import { itemCount, itemKey, placeableKinds, type GameplayItem, type SceneGameplay } from './sceneGameplay.ts'

export const QUICK_SLOTS = 5
export const LEGACY_WEAPON = '@weapon'
export interface Loadout { slots: (string | null)[]; selected: number }
export interface PlacedStructure { id: string; item: string; kind: typeof placeableKinds[number]; position: [number, number, number]; yaw: number; storage?: [string, number][] }
export const createLoadout = (weapon: WeaponKind): Loadout => ({ slots: [null, weapon === 'none' ? null : LEGACY_WEAPON, null, null, null], selected: weapon === 'none' ? 0 : 1 })
export const definitionOf = (rules: SceneGameplay | undefined, name: string | null | undefined): GameplayItem | undefined => rules?.items?.find(item => name != null && itemKey(item.name) === itemKey(name))
export function bindSlot(loadout: Loadout, slot: number, item: string | null, items: Map<string, number>): boolean {
  if (!Number.isInteger(slot) || slot < 1 || slot >= QUICK_SLOTS || (item !== null && itemCount(items, item) < 1)) return false
  loadout.slots[slot] = item
  return true
}
export const selectSlot = (loadout: Loadout, slot: number) => { loadout.selected = ((Math.trunc(slot) % QUICK_SLOTS) + QUICK_SLOTS) % QUICK_SLOTS }
export function heldItem(loadout: Loadout, items: Map<string, number>): string | null {
  const item = loadout.slots[loadout.selected]
  return item === LEGACY_WEAPON || (item && itemCount(items, item) > 0) ? item : null
}
export function heldWeapon(loadout: Loadout, items: Map<string, number>, rules: SceneGameplay | undefined, legacy: WeaponKind): WeaponKind {
  const item = heldItem(loadout, items)
  return item === LEGACY_WEAPON ? legacy : definitionOf(rules, item)?.equipment ?? 'none'
}
export function spendItem(items: Map<string, number>, item: string): boolean {
  const key = [...items.keys()].find(key => itemKey(key) === itemKey(item) && items.get(key)! > 0)
  if (!key) return false
  const left = items.get(key)! - 1
  if (left) items.set(key, left); else items.delete(key)
  return true
}
export function restoreLoadout(loadout: Loadout, saved: unknown, items: Map<string, number>, legacy: WeaponKind) {
  if (!saved || typeof saved !== 'object') return
  const data = saved as Partial<Loadout>
  if (Array.isArray(data.slots)) for (let i = 1; i < QUICK_SLOTS; i++) {
    const item = data.slots[i]
    loadout.slots[i] = item === LEGACY_WEAPON && legacy !== 'none' ? item : typeof item === 'string' && item.length <= 40 && itemCount(items, item) > 0 ? item : null
  }
  if (Number.isInteger(data.selected) && data.selected! >= 0 && data.selected! < QUICK_SLOTS) loadout.selected = data.selected!
  loadout.slots[0] = null
}
