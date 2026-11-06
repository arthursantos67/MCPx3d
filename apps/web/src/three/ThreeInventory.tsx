import { useEffect, useRef, useState, type DragEvent } from 'react'
import { itemIcon, type HudModel } from './sceneHud.ts'
import { HudIcon } from './sceneHudIcons.tsx'
import { itemKey,stationLabel } from './sceneGameplay.ts'
import { CURSOR_SLOT, availableCraftCells, consumeCraftCells, workbenchRecipe,syncBagCells, type CraftCell } from './sceneInventory.ts'

type HeldStack = { item: string; source: 'bag' | 'storage' | 'bench' | 'bar' | 'output'; index?: number;amount?:number }
interface Props {
  model: HudModel; onClose(): void; onCraft(id: string): boolean | void; onUse(item: string): void
  onBind?(slot: number, item: string): void; onEmpty?(): void
  onTransfer?(item: string, withdraw: boolean, amount: number): void
  onMove?(item: string, before: string | null): void
  onArrange?(from:number,to:number,amount:number):void
  onTake?(item:string,amount:number):void
}

export default function ThreeInventory({ model, onClose, onCraft, onUse, onBind, onEmpty, onTransfer, onMove,onArrange,onTake }: Props) {
  const dialog = useRef<HTMLDivElement>(null), dragging = useRef<HeldStack | null>(null)
  const [held, setHeld] = useState<HeldStack | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [bench, setBench] = useState<CraftCell[]>(Array(9).fill(null)), [tab, setTab] = useState<'bag' | 'recipes'>('bag')
  const [message, setMessage] = useState('')
  const [pointer,setPointer]=useState({x:0,y:0})
  const recipes = model.recipes ?? [], crafting = recipes.length > 0
  const cells = availableCraftCells(Array.from({length:model.craftingStation?9:4},(_,index)=>bench[index]??null), model.items), output = workbenchRecipe(cells, recipes)
  const count = (name: string, storage = false) => (storage ? model.storage?.items : model.items)?.find(item => itemKey(item.name) === itemKey(name))?.count ?? 0
  const reserved = (name: string) => cells.reduce((sum, cell) => sum + (cell && itemKey(cell.item) === itemKey(name) ? cell.amount : 0), 0)
  const definition = (name: string) => model.itemDefinitions?.find(item => itemKey(item.name) === itemKey(name))
  const icon = (name: string) => {
    const equipment = definition(name)?.equipment
    return equipment && equipment !== 'none' ? equipment==='pickaxe'?'axe':equipment : itemIcon(name)
  }
  const selectedDefinition = selected ? definition(selected) : null
  const healing = selected ? selectedDefinition?.healing ?? recipes.find(recipe => itemKey(recipe.output.item) === itemKey(selected))?.healing ?? 0 : 0

  useEffect(() => { dialog.current?.focus() }, [])
  const clearHeld = () => { dragging.current = null; setHeld(null) }
  const returnCursor = () => {
    if(held?.source!=='bag'||held.index!==CURSOR_SLOT||!onArrange)return
    const layout=model.bagSlots??[],to=layout.findIndex((cell,i)=>i<CURSOR_SLOT&&cell&&itemKey(cell.item)===itemKey(held.item))
    onArrange(CURSOR_SLOT,to>=0?to:layout.findIndex((cell,i)=>i<CURSOR_SLOT&&!cell),held.amount??count(held.item))
  }
  const craft = (carry=true) => {
    if(carry&&held?.source==='bag'&&held.index===CURSOR_SLOT&&output&&itemKey(held.item)!==itemKey(output.output.item))return false
    if (!output?.available || onCraft(output.id) === false) return false
    setBench(consumeCraftCells(cells, output)); setSelected(output.output.item)
    setMessage(`${output.output.item} criado.`)
    if(carry&&onTake){const amount=output.output.amount+(held?.source==='bag'&&held.index===CURSOR_SLOT?held.amount??0:0);returnCursor();onTake(output.output.item,amount);setHeld({item:output.output.item,amount,source:'bag',index:CURSOR_SLOT})}
    return true
  }
  const drop = (zone: 'bag' | 'storage' | 'bench' | 'bar', index = 0, before: string | null = null) => {
    const stack = dragging.current ?? held
    if (!stack) return
    if (stack.source === 'output') {
      if ((zone === 'bag' || zone === 'bar') && craft(false) && zone === 'bar' && index > 0) onBind?.(index, stack.item)
    } else if (zone === 'storage' && stack.source !== 'storage') {
      onTransfer?.(stack.item, false, stack.amount??count(stack.item))
      if (stack.source === 'bench') setBench(previous => previous.map((cell, i) => i === stack.index ? null : cell))
    } else if (stack.source === 'storage' && zone === 'bag') onTransfer?.(stack.item, true,stack.amount??count(stack.item, true))
    else if (zone === 'bar' && index > 0 && stack.source !== 'storage') onBind?.(index, stack.item)
    else if (zone === 'bench' && crafting && stack.source !== 'storage') {
      if (stack.source === 'bench') setBench(previous => { const next = [...previous]; [next[index], next[stack.index!]] = [next[stack.index!], next[index]]; return next })
      else {
        const amount = Math.min(stack.amount??Infinity,count(stack.item) - reserved(stack.item))
        if (amount > 0) {
          const displaced=cells[index]
          setBench(previous => previous.map((cell, i) => i === index ? { item: stack.item, amount:amount+(cell&&itemKey(cell.item)===itemKey(stack.item)?cell.amount:0) } : cell))
          if(displaced&&itemKey(displaced.item)!==itemKey(stack.item)&&onTake){returnCursor();onTake(displaced.item,displaced.amount);dragging.current=null;setHeld({item:displaced.item,amount:displaced.amount,source:'bag',index:CURSOR_SLOT});return}
        }
      }
    } else if (zone === 'bag') {
      if (stack.source === 'bench') setBench(previous => previous.map((cell, i) => i === stack.index ? null : cell))
      else if (stack.source === 'bar') onBind?.(-1, stack.item)
      else if(stack.source==='bag'&&stack.index!==undefined&&onArrange){
        const displaced=model.bagSlots?.[index]
        onArrange(stack.index,index,stack.amount??count(stack.item))
        if(stack.index===CURSOR_SLOT&&displaced&&itemKey(displaced.item)!==itemKey(stack.item)){
          dragging.current=null;setHeld({item:displaced.item,source:'bag',index:CURSOR_SLOT,amount:displaced.amount});return
        }
      }
      else onMove?.(stack.item, before)
    }
    if(zone==='bench'||zone==='bar')returnCursor()
    clearHeld()
  }
  const dragProps = (stack: HeldStack | null) => ({
    draggable: !!stack,
    onDragStart: (event: DragEvent) => { if (!stack) return;const chosen=held?.source===stack.source&&held.index===stack.index?held:stack; dragging.current = chosen; setHeld(chosen); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', stack.item) },
    onDragEnd: clearHeld,
  })
  const target = (zone: 'bag' | 'storage' | 'bench' | 'bar', index = 0, before: string | null = null) => ({
    onDragOver: (event: DragEvent) => { if (dragging.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } },
    onDrop: (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); drop(zone, index, before) },
  })
  const choose = (stack: HeldStack) => {
    setSelected(stack.item);setMessage('')
    if(stack.source==='bag'&&stack.index!==undefined&&onArrange){onArrange(stack.index,CURSOR_SLOT,stack.amount??count(stack.item));setHeld({...stack,index:CURSOR_SLOT})}
    else if(onTake&&stack.source!=='output'){
      const amount=stack.amount??(stack.source==='bench'?cells[stack.index??0]?.amount:count(stack.item))??1
      if(stack.source==='storage')onTransfer?.(stack.item,true,amount)
      if(stack.source==='bench')setBench(previous=>previous.map((cell,i)=>i===stack.index?null:cell))
      onTake(stack.item,amount);setHeld({item:stack.item,amount,source:'bag',index:CURSOR_SLOT})
    }
    else setHeld(stack)
  }
  const inventoryGrid = (storage = false) => {
    const layout=syncBagCells(model.bagSlots??[],new Map(model.items.map(item=>[item.name,item.count])))
    const last=layout.slice(0,CURSOR_SLOT).findLastIndex(cell=>cell!==null)
    const items = storage ? model.storage!.items : layout.slice(0,Math.max(24,Math.ceil((last+1)/8)*8)).map(cell=>cell?{name:cell.item,count:cell.amount}:null), zone = storage ? 'storage' : 'bag'
    const reservation=new Map<string,number>()
    return <div className="inventory-grid" role="group" aria-label={storage ? 'Itens no baú' : 'Itens na mochila'} {...target(zone)}>
      {Array.from({ length: Math.max(24, Math.ceil(items.length / 8) * 8) }, (_, i) => {
        const item = items[i],key=item?itemKey(item.name):'',used=item&&!storage?Math.min(item.count,Math.max(0,reserved(item.name)-(reservation.get(key)??0))):0
        if(item)reservation.set(key,(reservation.get(key)??0)+used)
        const amount=item?item.count-used:0,filled=!!item&&amount>0
        const stack: HeldStack | null = filled ? { item: item.name, source: zone,index:i,amount } : null
        return <button type="button" className={`inventory-slot${selected === item?.name ? ' is-selected' : ''}`} key={i}
          aria-label={filled ? `${storage ? 'Baú' : 'Mochila'}: ${item.name}, ${amount}` : `Espaço vazio ${i + 1}`} title={filled ? `${item.name} ×${amount}` : 'Espaço vazio'}
          {...dragProps(stack)} {...target(zone, i, item?.name ?? null)} onClick={event => {
            if (event.shiftKey && item && model.storage) { onTransfer?.(item.name, storage, amount); clearHeld(); return }
            if (held) { drop(zone, i, item?.name ?? null); return }
            if (stack) choose(stack)
          }} onDoubleClick={() => { if (item && !storage && !held) onUse(item.name) }}
          onContextMenu={event => {
            event.preventDefault()
            if(!storage&&held?.source==='bag'&&held.index!==undefined&&onArrange&&held.index!==i){
              if(item&&itemKey(item.name)!==itemKey(held.item))return
              onArrange(held.index,i,1);const left=(held.amount??1)-1;if(left>0)setHeld({...held,amount:left});else clearHeld();return
            }
            if(stack)choose({...stack,amount:Math.ceil(amount/2)})
          }}>
          {filled && <><HudIcon name={icon(item.name)} /><span className="inventory-slot__count">{amount}</span><span className="inventory-slot__name">{item.name}</span></>}
        </button>
      })}
    </div>
  }

  return <div className="three-inventory__backdrop" onPointerMove={event=>setPointer({x:event.clientX,y:event.clientY})} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="three-inventory" role="dialog" aria-modal="true" aria-label={crafting ? 'Inventário e fabricação' : 'Inventário'} tabIndex={-1} ref={dialog} onKeyDown={event => {
    if (event.key === 'Escape' || event.code === 'KeyB') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (/^[2-5]$/.test(event.key) && selected) { onBind?.(Number(event.key) - 1, selected); clearHeld(); event.preventDefault(); return }
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')], index = controls.indexOf(document.activeElement as HTMLElement)
      event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
    }
  }}>
    <header className="inventory-header"><div><span className="inventory-eyebrow">EQUIPAMENTO & PERTENCES</span><h2>Inventário<span>{model.items.length} tipos de item</span></h2></div><button className="inventory-close" type="button" onClick={onClose} aria-label="Fechar inventário">×<kbd>ESC</kbd></button></header>
    <div className={`inventory-layout${crafting ? '' : ' inventory-layout--simple'}`}>
      <section className="inventory-pack"><div className="inventory-section-title"><h3>Mochila</h3></div>{inventoryGrid()}
        <div className="inventory-section-title"><h3>Acesso rápido</h3></div>
        <div className="inventory-hotbar" role="group" aria-label="Atalhos do inventário">{model.quickbar?.slots.map((slot, i) => <button type="button" key={i} className={`inventory-slot${i === model.quickbar?.selected ? ' is-equipped' : ''}`}
          aria-label={`Atalho ${i + 1}: ${slot.name}`} title={i ? `Arraste um item para equipar no atalho ${i + 1}` : 'Mãos vazias'}
          {...dragProps(slot.item && slot.item !== '@weapon' ? { item: slot.item, source: 'bar', index: i } : null)} {...target('bar', i)}
          onClick={() => { if (!i) { onEmpty?.(); returnCursor();clearHeld() } else if (held) drop('bar', i); else if (slot.item && slot.item !== '@weapon') choose({ item: slot.item, source: 'bar', index: i }) }}>
          <kbd>{i + 1}</kbd>{(i === 0 || slot.item) && <HudIcon name={slot.icon} />}{slot.count > 1 && <span className="inventory-slot__count">{slot.count}</span>}
        </button>)}</div>
        {model.storage && <section className="inventory-storage"><div className="inventory-section-title"><h3>{model.storage.name}</h3><span>SHIFT + CLIQUE TRANSFERE A PILHA</span></div>{inventoryGrid(true)}</section>}
        {selected && <div className="inventory-detail"><HudIcon name={icon(selected)} /><div><strong>{selected}</strong><p>{selectedDefinition?.description || `${count(selected)} na mochila${healing ? ` · +${healing} de vida` : ''}`}</p></div></div>}
      </section>
      {crafting && <section className="inventory-workshop"><div className="inventory-tabs" role="tablist" aria-label="Fabricação"><button role="tab" aria-selected={tab === 'bag'} onClick={() => setTab('bag')}>{model.craftingStation??'Criação manual'}</button><button role="tab" aria-selected={tab === 'recipes'} onClick={() => setTab('recipes')}>Receitas <span>{recipes.length}</span></button></div>
        {tab === 'recipes' ? <div className="inventory-recipe-book">{recipes.map(recipe => <button type="button" key={recipe.id} aria-label={`Preparar receita: ${recipe.name}`} className={`inventory-recipe${recipe.available ? '' : ' is-unavailable'}`} onClick={() => { returnCursor();setBench(Array.from({ length: 9 }, (_, i) => recipe.inputs[i] ?? null)); setTab('bag'); clearHeld() }}>
          <HudIcon name={icon(recipe.output.item)} /><span><strong>{recipe.name}</strong><small>{recipe.inputs.map(input => `${input.amount} ${input.item}`).join(' · ')}{recipe.station?` · Requer ${stationLabel(recipe.station)}`:''}{!recipe.available&&recipe.missing?` · Falta: ${recipe.missing}`:''}</small></span>{recipe.available && <HudIcon name="check" />}</button>)}</div> : <>
          <div className="inventory-crafting"><div className={`inventory-craft-grid${model.craftingStation?'':' inventory-craft-grid--hand'}`} role="group" aria-label="Grade de fabricação">{cells.map((cell, i) => <button type="button" key={i} className="inventory-slot" aria-label={`Bancada ${i + 1}${cell ? `: ${cell.item}, ${cell.amount}` : ': vazio'}`}
            {...dragProps(cell ? { item: cell.item, source: 'bench', index: i } : null)} {...target('bench', i)}
            onClick={() => { if (held) drop('bench', i); else if (cell) choose({ item: cell.item, source: 'bench', index: i }) }}
            onContextMenu={event => {
              event.preventDefault()
              if(held?.source==='bag'&&held.index===CURSOR_SLOT&&onArrange){
                if(cell&&itemKey(cell.item)!==itemKey(held.item))return
                const layout=model.bagSlots??[],same=layout.findIndex((entry,index)=>index<CURSOR_SLOT&&entry&&itemKey(entry.item)===itemKey(held.item)),to=same>=0?same:layout.findIndex((entry,index)=>index<CURSOR_SLOT&&!entry)
                onArrange(CURSOR_SLOT,to,1);setBench(previous=>previous.map((entry,index)=>index===i?{item:held.item,amount:(entry?.amount??0)+1}:entry))
                if((held.amount??1)>1)setHeld({...held,amount:held.amount!-1});else clearHeld()
              }else if(cell&&onTake){
                const amount=Math.ceil(cell.amount/2)
                setBench(previous=>previous.map((entry,index)=>index===i?(cell.amount>amount?{...cell,amount:cell.amount-amount}:null):entry));onTake(cell.item,amount);setHeld({item:cell.item,amount,source:'bag',index:CURSOR_SLOT})
              }
            }}>
            {cell && <><HudIcon name={icon(cell.item)} /><span className="inventory-slot__count">{cell.amount}</span></>}
          </button>)}</div><HudIcon name="arrow" /><button type="button" className="inventory-slot inventory-output" aria-label={output ? `Retirar resultado: ${output.name}` : 'Resultado da fabricação'} title={output ? `${output.output.item} ×${output.output.amount}` : 'Arraste materiais para a grade ou escolha uma receita'}
            disabled={!output?.available} {...dragProps(output?.available ? { item: output.output.item, source: 'output' } : null)} onClick={()=>craft()}>
            {output ? <><HudIcon name={icon(output.output.item)} /><span className="inventory-slot__count">{output.output.amount}</span></> : <span className="inventory-output__empty">?</span>}
          </button></div>{output&&<p className="inventory-result-name">{output.available?output.output.item:output.missing}</p>}
        </>}
      </section>}
    </div>
    <footer className="inventory-footer"><span role="status" aria-live="polite">{message}</span></footer>
  </div>{held&&<div className="inventory-cursor" aria-label={`Carregando ${held.amount??1} ${held.item}`} style={{left:pointer.x,top:pointer.y}}><HudIcon name={icon(held.item)}/><b>{held.amount??1}</b></div>}</div>
}
