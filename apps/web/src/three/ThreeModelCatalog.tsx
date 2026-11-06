import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { catalogModelData, catalogThumbnail, searchCatalog, type CatalogModel, type CatalogPack, type ModelCatalog } from './sceneModelCatalog.ts'

function Thumbnail({model,pack}:{model:CatalogModel;pack:CatalogPack}) {
  const ref=useRef<HTMLDivElement>(null),[url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false)
  useEffect(()=>{
    let stopped=false,owned:string|null=null
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting)) return
      observer.disconnect()
      void catalogThumbnail(model,pack).then(value=>{if(stopped){if(value)URL.revokeObjectURL(value)}else{owned=value;setUrl(value)}}).catch(()=>{if(!stopped)setFailed(true)})
    },{rootMargin:'160px'})
    if(ref.current)observer.observe(ref.current)
    return()=>{stopped=true;observer.disconnect();if(owned)URL.revokeObjectURL(owned)}
  },[model,pack])
  return <div ref={ref} className="catalog-thumbnail">{url?<img src={url} alt=""/>:<span>{failed?'Prévia indisponível':model.thumbnail?'Carregando prévia…':pack.category}</span>}</div>
}

function Preview({model,pack}:{model:CatalogModel;pack:CatalogPack}) {
  const container=useRef<HTMLDivElement>(null),[error,setError]=useState('')
  useEffect(()=>{
    const host=container.current!,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,1000)
    const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true}),controls=new OrbitControls(camera,renderer.domElement)
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping
    renderer.setClearColor('#252d35',1);host.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight('#ffffff','#86816d',2.5))
    const sun=new THREE.DirectionalLight('#fff3dc',3);sun.position.set(4,7,5);scene.add(sun)
    let stopped=false,root:THREE.Object3D|null=null
    const render=()=>renderer.render(scene,camera),resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render()}
    const observer=new ResizeObserver(resize);observer.observe(host);controls.addEventListener('change',render)
    const disposeModel=(object:THREE.Object3D)=>{const textures=new Set<THREE.Texture>();object.traverse(child=>{if(!(child instanceof THREE.Mesh))return;child.geometry.dispose();for(const material of Array.isArray(child.material)?child.material:[child.material]){for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);material.dispose()}if(child instanceof THREE.SkinnedMesh)child.skeleton.dispose()});textures.forEach(texture=>texture.dispose())}
    void catalogModelData(model,pack).then(bytes=>new GLTFLoader().parseAsync(bytes,'')).then(gltf=>{
      if(stopped){disposeModel(gltf.scene);return}
      root=gltf.scene;scene.add(root)
      const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z,.1)
      controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(1.3,.8,2).normalize().multiplyScalar(radius*2.5));controls.update();resize()
    }).catch(cause=>{if(!stopped)setError(cause instanceof Error?cause.message:String(cause))})
    return()=>{stopped=true;observer.disconnect();controls.dispose();if(root)disposeModel(root);renderer.dispose();renderer.domElement.remove()}
  },[model,pack])
  return <div className="catalog-preview-canvas" ref={container}>{error&&<p role="alert">{error}</p>}</div>
}

export default function ThreeModelCatalog({catalog,busy,onAdd,onBack}:{catalog:ModelCatalog;busy:boolean;onAdd(model:CatalogModel,pack:CatalogPack,height:number):Promise<void>;onBack():void}) {
  const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[packId,setPackId]=useState(''),[page,setPage]=useState(0)
  const [selected,setSelected]=useState<CatalogModel|null>(null),[height,setHeight]=useState(1),[error,setError]=useState('')
  const packs=useMemo(()=>new Map(catalog.packs.map(pack=>[pack.id,pack])),[catalog])
  const results=useMemo(()=>searchCatalog(catalog,query,packId,category),[catalog,query,packId,category])
  const pack=selected?packs.get(selected.pack)!:null
  const select=(model:CatalogModel)=>{setSelected(model);setError('');setHeight(/floor|tile|road/.test(model.entry)?0.15:/tree|building|house|tower/.test(model.entry)?4:/wall|pillar|door/.test(model.entry)?2.5:/car|truck|ship/.test(model.entry)?1.5:1)}
  const add=async()=>{if(!selected||!pack)return;setError('');try{await onAdd(selected,pack,height)}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}}
  return <section className="model-catalog"><div className="catalog-topline"><button type="button" disabled={busy} onClick={()=>selected?setSelected(null):onBack()}>← {selected?'Voltar aos modelos':'Coleção integrada'}</button><span>{catalog.models.length.toLocaleString('pt-BR')} modelos · {catalog.packs.length} coleções · Kenney · CC0</span></div>
    {error&&<p className="catalog-error" role="alert">{error}</p>}
    {selected&&pack?<section className="catalog-preview"><Preview key={selected.id} model={selected} pack={pack}/><div><span className="workspace-eyebrow">{pack.name} · {pack.style}</span><h3>{selected.name}</h3><p>Malha estática editável · {(selected.bytes/1024).toFixed(0)} KB · {pack.author} · {pack.license}</p><label>Altura no mundo (metros)<input type="number" min="0.05" max="50" step="0.1" value={height} onChange={event=>setHeight(Number(event.target.value))}/></label><button className="catalog-add" type="button" disabled={busy||!Number.isFinite(height)||height<0.05||height>50} onClick={()=>void add()}>{busy?'Preparando…':'Adicionar à cena'}</button><a href={pack.source} target="_blank" rel="noreferrer">Coleção original e licença ↗</a><p>Arraste a prévia para girar. Role para aproximar. O modelo será salvo junto com o projeto.</p></div></section>:<>
      <div className="catalog-search"><label>Buscar modelos<input type="search" value={query} placeholder="Árvore, parede, espada, carro…" onChange={event=>{setQuery(event.target.value);setPage(0)}}/></label><label>Categoria<select aria-label="Categoria" value={category} onChange={event=>{setCategory(event.target.value);setPage(0);setPackId('')}}><option value="">Todas as categorias</option>{[...new Set(catalog.packs.map(pack=>pack.category))].map(name=><option key={name}>{name}</option>)}</select></label><label>Coleção<select aria-label="Coleção" value={packId} onChange={event=>{setPackId(event.target.value);setPage(0)}}><option value="">Todas as coleções</option>{catalog.packs.filter(item=>!category||item.category===category).map(item=><option value={item.id} key={item.id}>{item.name} · {item.models}</option>)}</select></label></div>
      <p className="catalog-count" role="status">{results.length.toLocaleString('pt-BR')} modelos encontrados · malhas estáticas prontas para editar</p>
      <div className="model-library-grid">{results.slice(page*36,(page+1)*36).map(model=><button type="button" key={model.id} disabled={busy} aria-label={`Visualizar modelo: ${model.name}`} onClick={()=>select(model)}><Thumbnail model={model} pack={packs.get(model.pack)!}/><span><strong>{model.name}</strong><small>{packs.get(model.pack)!.name} · estático</small></span><b aria-hidden="true">↗</b></button>)}</div>
      {results.length>36&&<div className="catalog-pages"><button type="button" disabled={!page} onClick={()=>setPage(value=>value-1)}>← Anterior</button><span>Página {page+1} de {Math.ceil(results.length/36)}</span><button type="button" disabled={(page+1)*36>=results.length} onClick={()=>setPage(value=>value+1)}>Próxima →</button></div>}
    </>}
    <footer><span>Arquivos locais · carregamento por coleção · cache limitado</span><a href="https://kenney.nl/assets/category:3D" target="_blank" rel="noreferrer">Kenney ↗</a></footer>
  </section>
}
