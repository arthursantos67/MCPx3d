import { useEffect, useRef, useState } from 'react'
import { modelLibrary, modelUrl, type LibraryModelId } from './sceneModelLibrary.ts'
import ThreeModelCatalog from './ThreeModelCatalog.tsx'
import { loadModelCatalog, type CatalogModel, type CatalogPack, type ModelCatalog } from './sceneModelCatalog.ts'

export default function ThreeModelLibrary({ busy, onAdd, onAddCatalog, onClose }: { busy: boolean; onAdd(id: LibraryModelId): void; onAddCatalog(model:CatalogModel,pack:CatalogPack,height:number):Promise<void>; onClose(): void }) {
  const [category, setCategory] = useState('Todos'), dialog = useRef<HTMLDivElement>(null)
  const [catalog,setCatalog]=useState<ModelCatalog|null>(null),[expanded,setExpanded]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let stopped=false;void loadModelCatalog().then(value=>{if(!stopped)setCatalog(value)}).catch(cause=>{if(!stopped)setError(String(cause.message??cause))});return()=>{stopped=true}},[])
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus() }, [])
  return <div className="model-library-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><div className="model-library" role="dialog" aria-modal="true" aria-label="Biblioteca de modelos" tabIndex={-1} ref={dialog} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') { const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select')], index = controls.indexOf(document.activeElement as HTMLElement); event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus() }
  }}>
    <header><div><span className="workspace-eyebrow">KAYKIT + KENNEY · CC0</span><h2>Modelos para dar forma ao mundo</h2><p>Nove personagens com animações originais e milhares de peças para construir mundos. Arquivos locais; carregamento sob demanda por coleção.</p></div><button type="button" disabled={busy} aria-label="Fechar biblioteca" onClick={onClose}>×</button></header>
    {error&&<p role="alert">{error}</p>}
    <div className="catalog-entry"><button type="button" disabled={!catalog||busy} onClick={()=>setExpanded(!expanded)}>{expanded?'Coleção integrada':`Catálogo completo · ${catalog?.models.length.toLocaleString('pt-BR')??'carregando…'} modelos`}</button><span>{catalog?`${catalog.packs.length} coleções Kenney · natureza, masmorras, cidades, veículos, móveis e equipamento`:''}</span></div>
    {expanded&&catalog?<ThreeModelCatalog catalog={catalog} busy={busy} onAdd={onAddCatalog} onBack={()=>setExpanded(false)}/>:<>
    <nav aria-label="Categorias de modelos">{['Todos', 'Personagens', 'Equipamento', 'Natureza','Masmorras'].map(name => <button type="button" aria-pressed={category === name} key={name} onClick={() => setCategory(name)}>{name}</button>)}</nav>
    <div className="model-library-grid">{modelLibrary.filter(model => category === 'Todos' || model.category === category).map(model => <button type="button" key={model.id} disabled={busy} onClick={() => onAdd(model.id)} aria-label={`Adicionar modelo: ${model.name}`}>
      <img src={modelUrl(model.id).replace(/\.glb$/, '.png')} alt="" loading="lazy" /><span><strong>{model.name}</strong><small>{model.category}{'prefab' in model ? ' · animado' : ''}</small></span><b aria-hidden="true">+</b>
    </button>)}</div>
    <footer><span>{busy ? 'Preparando o modelo…' : 'Modelos CC0 · sem conta ou download externo durante o jogo'}</span><a href="https://github.com/KayKit-Game-Assets" target="_blank" rel="noreferrer">Créditos e coleção original ↗</a></footer></>}
  </div></div>
}
