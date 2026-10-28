import { useEffect, useRef } from 'react'
import type { HudModel } from './sceneHud.ts'
import { itemKey } from './sceneGameplay.ts'

export default function ThreeInventory({ model, onClose, onCraft, onUse }: { model: HudModel; onClose(): void; onCraft(id: string): void; onUse(item: string): void }) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => { dialog.current?.focus() }, [])
  return <div className="three-inventory__backdrop"><div className="three-inventory" role="dialog" aria-modal="true" aria-label="Inventário e fabricação" tabIndex={-1} ref={dialog} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = controls.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
  }}>
    <header><div><small>MOCHILA · B</small><h2>Inventário e fabricação</h2></div><button type="button" onClick={onClose} aria-label="Fechar inventário">Fechar · Esc</button></header>
    <div className="three-inventory__columns"><section><h3>Seus itens</h3>
      {model.items.length ? <ul className="three-inventory__items">{model.items.map(item => {
        const healing = model.recipes?.find(recipe => itemKey(recipe.output.item) === itemKey(item.name) && recipe.healing > 0)
        return <li key={item.name}><span>{item.name}</span><strong>×{item.count}</strong>{healing && <button type="button" disabled={model.health >= model.maxHealth} onClick={() => onUse(item.name)}>Usar · +{healing.healing} vida</button>}</li>
      })}</ul> : <p>Você ainda não tem recursos. Mire em árvores, rochas ou objetos coletáveis próximos e pressione E.</p>}
      <p className="three-inventory__hint">Árvores dão madeira, rochas dão pedra e arbustos dão fibra. Objetos resistentes precisam de vários golpes.</p>
    </section><section><h3>Fabricar</h3>{model.recipes?.length ? <ul className="three-inventory__recipes">{model.recipes.map(recipe => <li key={recipe.id}>
      <strong>{recipe.name}</strong><span>Produz {recipe.output.amount} × {recipe.output.item}</span><p>{recipe.inputs.map(input => `${input.amount} ${input.item}`).join(' + ')}</p>
      <button type="button" onClick={() => onCraft(recipe.id)} disabled={!recipe.available}>Fabricar {recipe.name}</button>
      {!recipe.available && <small>Falta: {recipe.missing}</small>}
    </li>)}</ul> : <p>Este jogo não possui receitas.</p>}</section></div>
    {!!model.questSteps?.length && <section className="three-inventory__mission"><h3>{model.objective}</h3><ul>{model.questSteps.map((step, index) => <li key={index}>{step.value >= step.count ? '✓' : '○'} {step.label} · {step.value}/{step.count}</li>)}</ul></section>}
  </div></div>
}
