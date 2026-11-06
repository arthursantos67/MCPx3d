/** Known compatible rigs. Stored in prefab metadata so variants survive save/load and export. */
export const characterModels = {
  knight: 'knight', rogue: 'villager', mage: 'wizard', barbarian: 'knight', rogue_hooded: 'villager',
  skeleton_warrior: 'skeleton', skeleton_minion: 'skeleton', skeleton_rogue: 'skeleton', skeleton_mage: 'skeleton',
} as const
export type CharacterModelId = keyof typeof characterModels
