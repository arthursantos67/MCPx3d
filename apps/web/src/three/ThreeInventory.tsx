import { useEffect, useRef, useState } from 'react'
import type { HudModel } from './sceneHud.ts'
import { itemKey } from './sceneGameplay.ts'

export default function ThreeInventory({ model, onClose, onCraft, onUse, onBind, onEmpty, onTransfer }: { model: HudModel; onClose(): void; onCraft(id: string): void; onUse(item: string): void; onBind?(slot: number, item: string): void; onEmpty?(): void; onTransfer?(item: string, withdraw: boolean): void }) {
  const dialog = useRef<HTMLDivElement>(null)
  const [materials, setMaterials] = useState<string[]>([])
  const [category, setCategory] = useState('Tudo')
  const recipes = model.recipes?.filter(recipe => {
    const definition = model.itemDefinitions?.find(item => itemKey(item.name) === itemKey(recipe.output.item))
    return materials.every(material => recipe.inputs.some(input => itemKey(input.item) === itemKey(material))) && (category === 'Tudo' || category === 'Equipamentos' && definition?.equipment || category === 'Construções' && definition?.placeable || category === 'Consumíveis' && (recipe.healing > 0 || (definition?.healing ?? 0) > 0))
  })
  useEffect(() => { dialog.current?.focus() }, [])
  return <div className="three-inventory__backdrop"><div className="three-inventory" role="dialog" aria-modal="true" aria-label="Inventário e fabricação" tabIndex={-1} ref={dialog} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')], index = controls.indexOf(document.activeElement as HTMLElement)
    event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
  }}>
    <header><div><small>MOCHILA · B</small><h2>Inventário e fabricação</h2></div><div>{onEmpty && <button type="button" onClick={onEmpty}>Mãos vazias · 1</button>}<button type="button" onClick={onClose} aria-label="Fechar inventário">Fechar · Esc</button></div></header>
    {model.storage && <section><h3>{model.storage.name}</h3><p>Guarde ou retire uma unidade por clique. O conteúdo fica salvo com a construção.</p>{model.storage.items.length ? <ul>{model.storage.items.map(item => <li key={item.name}>{item.name} ×{item.count} <button type="button" onClick={() => onTransfer?.(item.name, true)}>Retirar {item.name}</button></li>)}</ul> : <p>Baú vazio.</p>}</section>}
    <div className="three-inventory__columns"><section><h3>Seus itens</h3>
      {model.items.length ? <ul className="three-inventory__items">{model.items.map(item => {
        const healing = model.recipes?.find(recipe => itemKey(recipe.output.item) === itemKey(item.name) && recipe.healing > 0)
        const definition = model.itemDefinitions?.find(entry => itemKey(entry.name) === itemKey(item.name)), usable = definition?.equipment || definition?.placeable || definition?.healing || healing
        return <li key={item.name}><div><span>{item.name}</span>{definition?.description && <small>{definition.description}</small>}</div><strong>×{item.count}</strong>
          {usable && onBind && <select aria-label={`Atalho para ${item.name}`} value={model.quickbar?.slots.findIndex(slot => slot.item === item.name) ?? -1} onChange={event => onBind(Number(event.target.value), item.name)}><option value={-1}>Fora da barra</option>{[1, 2, 3, 4].map(slot => <option key={slot} value={slot}>Slot {slot + 1}</option>)}</select>}
          {(healing || definition?.healing) && <button type="button" disabled={model.health >= model.maxHealth} onClick={() => onUse(item.name)}>Usar · +{healing?.healing ?? definition?.healing} vida</button>}
          <button type="button" aria-pressed={materials.includes(item.name)} onClick={() => setMaterials(previous => previous.includes(item.name) ? previous.filter(name => name !== item.name) : [...previous, item.name])}>Combinar</button>
          {model.storage && <button type="button" onClick={() => onTransfer?.(item.name, false)}>Guardar {item.name}</button>}
        </li>
      })}</ul> : <p>Você ainda não tem recursos. Mire em árvores, rochas ou objetos coletáveis próximos e pressione E.</p>}
      <p className="three-inventory__hint">Árvores dão madeira, rochas dão pedra e arbustos dão fibra. Objetos resistentes precisam de vários golpes.</p>
    </section><section><h3>Bancada de fabricação</h3><p>Selecione materiais em “Combinar” para descobrir o que pode criar. Nenhuma receita depende de uma missão.</p>
      <div className="three-inventory__filters">{['Tudo', 'Equipamentos', 'Construções', 'Consumíveis'].map(name => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
      {!!materials.length && <p className="three-inventory__combination">{materials.join(' + ')} <button type="button" onClick={() => setMaterials([])}>Limpar bancada</button></p>}
      {recipes?.length ? <ul className="three-inventory__recipes">{recipes.map(recipe => <li key={recipe.id}>
      <strong>{recipe.name}</strong><span>Produz {recipe.output.amount} × {recipe.output.item}</span><p>{recipe.inputs.map(input => `${input.amount} ${input.item}`).join(' + ')}</p>
      <button type="button" onClick={() => onCraft(recipe.id)} disabled={!recipe.available}>Fabricar {recipe.name}</button>
      {!recipe.available && <small>Falta: {recipe.missing}</small>}
    </li>)}</ul> : <p>{model.recipes?.length ? 'Nenhuma combinação conhecida com estes materiais. Experimente outros recursos.' : 'Este jogo não possui receitas.'}</p>}</section></div>
    {!!model.questSteps?.length && <section className="three-inventory__mission"><h3>{model.objective}</h3><ul>{model.questSteps.map((step, index) => <li key={index}>{step.value >= step.count ? '✓' : '○'} {step.label} · {step.value}/{step.count}</li>)}</ul></section>}
  </div></div>
}
