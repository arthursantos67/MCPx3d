import type { SceneMaterial, Vector3Tuple } from './sceneDocument.ts'
import type { PrefabPart, PrefabSpec } from './scenePrefabs.ts'

export const buildingStyles = ['cottage', 'townhouse', 'lodge', 'villa'] as const
export interface BuildingSpec { style?: typeof buildingStyles[number]; floors?: number; width?: number; depth?: number; furnished?: boolean }
export interface BuildingPlan { style: typeof buildingStyles[number]; floors: number; width: number; depth: number; furnished: boolean }
export function buildingPlan(spec: PrefabSpec): BuildingPlan {
  const options = spec.building ?? {}, style = options.style ?? buildingStyles[Math.abs(Math.trunc(spec.seed)) % buildingStyles.length]
  const clamp = (v: number | undefined, low: number, high: number, fallback: number) => Number.isFinite(v) ? Math.max(low, Math.min(high, v!)) : fallback
  return { style, floors: Math.round(clamp(options.floors, 1, 2, style === 'cottage' ? 1 : 2)),
    width: clamp(options.width, 7.5, 16, style === 'townhouse' ? 8 : style === 'villa' ? 12 : 9.4),
    depth: clamp(options.depth, 8.5, 16, style === 'lodge' ? 11 : 9), furnished: options.furnished !== false }
}

/** Material batches retain real triangles for openings and collision, without hundreds of scene nodes. */
class Batch {
  vertices: number[] = []; indices: number[] = []; uvs: number[] = []
  readonly id: string; readonly name: string; readonly material: Partial<SceneMaterial>; readonly collidable: boolean
  constructor(id: string, name: string, material: Partial<SceneMaterial>, collidable = true) { this.id=id; this.name=name; this.material=material; this.collidable=collidable }
  box(x: number, y: number, z: number, w: number, h: number, d: number, tilt = 0) {
    if (Math.min(w, h, d) < 0.001) return
    const c = Math.cos(tilt), s = Math.sin(tilt)
    const p = (a: number, b: number, e: number): Vector3Tuple => [x + a * c - b * s, y + a * s + b * c, z + e]
    const X = w / 2, Y = h / 2, Z = d / 2
    const faces = [
      [p(-X,-Y,Z),p(X,-Y,Z),p(X,Y,Z),p(-X,Y,Z)], [p(X,-Y,-Z),p(-X,-Y,-Z),p(-X,Y,-Z),p(X,Y,-Z)],
      [p(X,-Y,Z),p(X,-Y,-Z),p(X,Y,-Z),p(X,Y,Z)], [p(-X,-Y,-Z),p(-X,-Y,Z),p(-X,Y,Z),p(-X,Y,-Z)],
      [p(-X,Y,Z),p(X,Y,Z),p(X,Y,-Z),p(-X,Y,-Z)], [p(-X,-Y,-Z),p(X,-Y,-Z),p(X,-Y,Z),p(-X,-Y,Z)],
    ]
    for (const [i, face] of faces.entries()) {
      const offset = this.vertices.length / 3, a = i < 2 ? w : i < 4 ? d : w, b = i < 4 ? h : d
      this.vertices.push(...face.flat().map(v=>Math.round(v*100000)/100000 || 0)); this.indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3)
      this.uvs.push(...[0,0,a,0,a,b,0,b].map(v=>Math.round(v*100000)/100000 || 0))
    }
  }
  part(): PrefabPart | null {
    if (!this.vertices.length) return null
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]
    this.vertices.forEach((v,i) => { min[i%3] = Math.min(min[i%3],v); max[i%3] = Math.max(max[i%3],v) })
    return { id: this.id, parentId: null, name: this.name, kind: 'mesh', position: min.map((v,i)=>(v+max[i])/2) as Vector3Tuple,
      dimensions: min.map((v,i)=>max[i]-v) as Vector3Tuple, geometry: { vertices: this.vertices, indices: this.indices, normals: [], uvs: this.uvs }, material: this.material, collidable: this.collidable }
  }
}
interface Opening { x: number; bottom: number; width: number; height: number; door?: boolean }

export function buildHouse(spec: PrefabSpec): PrefabPart[] {
  const plan = buildingPlan(spec), { width: w, depth: d, floors, style } = plan
  const base = 0.22, story = 3.35, top = base + floors * story, thick = 0.28
  const timber = style === 'lodge', modern = style === 'villa', parts: PrefabPart[] = [], batches: Batch[] = []
  const batch = (id: string, name: string, material: Partial<SceneMaterial>, collidable = true) => { const b = new Batch(id,name,{metalness:0,roughness:0.85,...material},collidable); batches.push(b); return b }
  const walls = batch('walls', 'Alvenaria com vãos de janela e porta', { color: spec.primary ?? (modern ? '#dedbd2' : '#dfd2bc'), texture: timber ? 'wood' : 'plaster', textureScale: timber ? 0.6 : 0.7, normalStrength: 0.35 })
  const stone = batch('foundation', 'Embasamento, soleiras e peitoris', { color: '#a49d8d', texture:'rock', textureScale:0.65, normalStrength:0.4 })
  const floor = batch('floors', 'Assoalho e lajes com abertura da escada', { color: '#b6a087', texture:'wood', textureScale:0.6, normalStrength:0.22 })
  const beams = batch('timber', 'Estrutura, rodapés e cornijas', { color: timber ? '#554234' : '#77624e', texture:'wood', textureScale:0.75, normalStrength:0.3 })
  const frames = batch('frames', 'Caixilhos completos e guarnições', { color: modern ? '#3c4446' : '#dad0bb', texture:'wood', textureScale:0.6 })
  const glass = batch('glass', 'Vidros transparentes, visíveis dos dois lados', { color:'#d7e6e6', opacity:0.22, transparent:true, doubleSided:true, roughness:0.12, clearcoat:1 }, true)
  const roof = batch('roof', modern ? 'Cobertura e platibanda' : 'Águas de telhado e cumeeira', { color: spec.secondary ?? (modern ? '#737a78' : '#7f5142'), texture:modern ? 'concrete' : 'tiles', textureScale:0.65, normalStrength:0.65 })
  const furniture = batch('furniture', 'Mobiliário de madeira', {color:'#947456',texture:'wood',textureScale:0.6})
  const fabric = batch('upholstery', 'Estofados e roupas de cama', {color:style === 'villa' ? '#697b78' : '#89765f',texture:'fabric',textureScale:1,roughness:0.95})
  const metal = batch('metalwork', 'Ferragens, luminárias e guarda-corpos', {color:'#42484a',metalness:0.7,roughness:0.4})
  // Foundation top is the actual interior floor. Human dimensions stay constant between variants.
  // Structural slab below the finish; a stone rim surrounds, rather than overlaps, the wood floor.
  const finish=0.07, rim=thick+0.06
  stone.box(0,(base-finish)/2,0,w+0.12,base-finish,d+0.12)
  for(const side of [-1,1]) {
    stone.box(side*(w/2+0.06-rim/2),base-finish/2,0,rim,finish,d+0.12)
    stone.box(0,base-finish/2,side*(d/2+0.06-rim/2),w-thick*2,finish,rim)
  }
  for(const s of [-1,1]) {
    stone.box(s*(w/4+0.37),base+0.18,d/2-0.04,(w-1.48)/2,0.36,0.15)
    stone.box(s*(w/2-0.04),base+0.18,0,0.15,0.36,d)
  }
  stone.box(0,base+0.18,-d/2+0.04,w,0.36,0.15)
  floor.box(0,base-0.035,0,w-thick*2,0.07,d-thick*2)
  for (let i=0;i<2;i++) stone.box(0,0.055+i*0.11,d/2+0.56-i*0.27,1.8,0.11,0.3)
  const wallFace = (side: 'front'|'back'|'left'|'right', level: number) => {
    const lateral = side === 'left' || side === 'right', length = lateral ? d : w, y0 = base + story*level
    const openings: Opening[] = [-1,1].map(s=>({x:s*length*0.27,bottom:1,width:modern?1.8:1.45,height:1.5}))
    if (side === 'front' && (level === 0 || (!modern && style !== 'cottage'))) openings.push({x:0,bottom:0,width:1.38,height:2.45,door:true})
    const toWorld = (u:number,y:number,out:number): Vector3Tuple => lateral ? [(side==='left'?-1:1)*(w/2-thick/2+out),y,u] : [u,y,(side==='front'?1:-1)*(d/2-thick/2+out)]
    const box = (b:Batch,u:number,y:number,out:number,a:number,h:number,t:number) => { const p=toWorld(u,y,out); b.box(...p,lateral?t:a,h,lateral?a:t) }
    const xs = [...new Set([-length/2,length/2,...openings.flatMap(o=>[o.x-o.width/2,o.x+o.width/2])])].sort((a,b)=>a-b)
    const ys = [...new Set([0,story,...openings.flatMap(o=>[o.bottom,o.bottom+o.height])])].sort((a,b)=>a-b)
    for(let a=1;a<xs.length;a++) for(let b=1;b<ys.length;b++) {
      const u=(xs[a-1]+xs[a])/2, y=(ys[b-1]+ys[b])/2
      if (!openings.some(o=>u>o.x-o.width/2&&u<o.x+o.width/2&&y>o.bottom&&y<o.bottom+o.height)) box(walls,u,y0+y,0,xs[a]-xs[a-1],ys[b]-ys[b-1],thick)
    }
    for (const o of openings) {
      const y=y0+o.bottom+o.height/2
      for (const s of [-1,1]) box(frames,o.x+s*(o.width/2-0.035),y,0,0.07,o.height,thick+0.08)
      box(frames,o.x,y0+o.bottom+o.height-0.035,0,o.width,0.07,thick+0.08)
      if (!o.door) {
        box(frames,o.x,y0+o.bottom+0.035,0,o.width,0.07,thick+0.08)
        box(frames,o.x,y,0,0.045,o.height-0.14,0.08)
        box(frames,o.x,y+0.22,0,o.width-0.14,0.045,0.08)
        box(glass,o.x,y,0,o.width-0.14,o.height-0.14,0.018)
        box(stone,o.x,y0+o.bottom-0.035,0,o.width+0.22,0.11,thick+0.3)
        if (timber && !lateral) for (const s of [-1,1]) box(beams,o.x+s*(o.width/2+0.28),y,0.19,0.38,o.height,0.055)
      }
    }
    // Both interior and exterior finishes frame the openings without covering them.
    box(beams,0,y0+story-0.12,0,length+0.07,0.18,thick+0.1)
    for(const s of [-1,1]) box(beams,s*(length/2-0.08),y0+story/2,0,0.14,story,thick+0.1)
  }
  for(let level=0;level<floors;level++) for(const side of ['front','back','left','right'] as const) wallFace(side,level)
  if(floors>1) {
    const stairW=1.6, x=w/2-thick-stairW/2-0.12, start=d/2-1.2, run=0.285, count=18, end=start-count*run, y=base+story
    const split=x-stairW/2-0.16, left=-w/2+thick, right=w/2-thick
    floor.box((left+split)/2,y-0.09,0,split-left,0.18,d-thick*2)
    for (const [a,b] of [[-d/2+thick,end-0.1],[start+0.1,d/2-thick]]) if(b>a) floor.box((split+right)/2,y-0.09,(a+b)/2,right-split,0.18,b-a)
    for(let i=0;i<count;i++) {
      const stepTop=base+(i+1)*story/count, z=start-(i+0.5)*run
      floor.box(x,stepTop-0.055,z,stairW,0.11,run+0.01)
      beams.box(x,stepTop-story/count/2-0.055,z+run/2-0.025,stairW,story/count,0.05)
    }
    // Full length handrail at upper-floor edge, leaving the rear landing open.
    const z=(start+end)/2, length=start-end
    metal.box(split,y+0.95,z,0.045,0.055,length)
    for(let i=0;i<=12;i++) metal.box(split,y+0.46,end+i*length/12,0.035,0.95,0.035)
    // Stair handrail follows the slope, outside the walking width.
    const slope=Math.atan2(story,count*run)
    for(let i=0;i<count;i+=3) metal.box(x+stairW/2+0.055,base+(i+1)*story/count+0.45,start-(i+0.5)*run,0.04,0.9,0.04)
    // Rail as short horizontal segments avoids a solid barrier across the stair.
    for(let i=0;i<count;i++) metal.box(x+stairW/2+0.055,base+(i+1)*story/count+0.9,start-(i+0.5)*run,0.06,0.06,run/Math.cos(slope))
  }
  // Ceilings isolate interiors from the roof; no solid triangular prism filling the attic.
  floor.box(0,top+0.04,0,w-thick*2,0.08,d-thick*2)
  if(modern) {
    roof.box(0,top+0.06,0,w+0.55,0.18,d+0.55)
    for(const s of [-1,1]) { walls.box(s*(w/2+0.05),top+0.42,0,0.2,0.65,d+0.2); walls.box(0,top+0.42,s*(d/2+0.05),w+0.2,0.65,0.2) }
    // Recessed portico distinguishes a villa from a gabled house.
    roof.box(0,base+2.65,d/2+0.9,w*0.65,0.18,2.1)
    for(const s of [-1,1]) stone.box(s*(w*0.325-0.15),base+1.3,d/2+1.7,0.22,2.6,0.22)
  } else {
    const rise=style==='townhouse'?2.5:1.9, half=w/2+0.48, angle=Math.atan2(rise,half), length=Math.hypot(half,rise)
    for(const s of [-1,1]) {
      roof.box(s*half/2,top+rise/2+0.1,0,length,0.16,d+1,-s*angle)
      beams.box(s*half,top+0.08,0,0.12,0.2,d+1.05)
      for(const z of [-d/2-0.37,d/2+0.37]) beams.box(s*half/2,top+rise/2-0.04,z,length,0.16,0.12,-s*angle)
    }
    roof.box(0,top+rise+0.13,0,0.22,0.15,d+1.05)
    // Gable infill is sliced vertically; it encloses only the attic, above the ceiling.
    for(let i=0;i<24;i++) { const x=-w/2+(i+0.5)*w/24, h=rise*(1-Math.abs(x)/half); for(const z of [-d/2+thick/2,d/2-thick/2]) walls.box(x,top+h/2,z,w/24,h,thick) }
    stone.box(-w*0.25,top+rise*0.8,-d*0.26,0.64,2.2,0.7)
    roof.box(-w*0.25,top+rise*0.8+1.14,-d*0.26,0.86,0.16,0.9)
  }
  const doorMaterial: Partial<SceneMaterial>={color:modern?'#6b655a':'#8d6849',texture:'wood',textureScale:1,metalness:0,roughness:0.7}
  parts.push({id:'hinge',parentId:null,name:'Dobradiça da porta',kind:'group',position:[-0.57,base+0.025,d/2-thick/2],dimensions:[1,1,1],
    animation:spec.interactive?{kind:'keyframes',axis:'y',duration:0.8,amplitude:0,phase:0,start:'trigger',easing:'smooth',keys:[{at:0,move:[0,0,0],turn:[0,0,0],scale:[1,1,1]},{at:1,move:[0,0,0],turn:[0,-90,0],scale:[1,1,1]}]}:undefined})
  parts.push({id:'door',parentId:'hinge',name:'Porta de entrada',kind:'box',position:[0.57,1.15,0],dimensions:[1.14,2.30,0.07],material:doorMaterial,
    interaction:spec.interactive?{trigger:'click',key:'',radius:3.5,action:'toggleAnimation',targetId:'hinge',message:'Abrir / fechar porta'}:undefined})
  for(const s of [-1,1]) parts.push({id:`handle${s}`,parentId:'hinge',name:'Maçaneta',kind:'box',position:[1,1.15,s*0.07],dimensions:[0.13,0.045,0.06],material:{color:'#bfa16a',metalness:0.8,roughness:0.3},collidable:false})
  if(floors>1 && !modern && style!=='cottage') {
    const y=base+story, front=d/2
    floor.box(0,y-0.08,front+0.95,3.8,0.16,1.9)
    stone.box(0,y-0.04,front-thick/2,1.24,0.1,thick+0.04)
    for(const s of [-1,1]) {
      beams.box(s*1.78,base+(story-0.16)/2,front+1.65,0.16,story-0.16,0.16)
      metal.box(s*1.82,y+0.98,front+0.9,0.07,0.07,1.75)
      for(let i=0;i<6;i++) metal.box(s*1.82,y+0.5,front+0.1+i*0.33,0.04,1,0.04)
    }
    metal.box(0,y+0.98,front+1.77,3.7,0.07,0.07)
    for(let i=0;i<12;i++) metal.box(-1.75+i*3.5/11,y+0.5,front+1.77,0.04,1,0.04)
    parts.push({id:'balcony-hinge',parentId:null,name:'Dobradiça da varanda',kind:'group',position:[-0.57,y+0.025,front-thick/2],dimensions:[1,1,1],animation:parts.find(p=>p.id==='hinge')!.animation})
    parts.push({id:'balcony-door',parentId:'balcony-hinge',name:'Porta da varanda',kind:'box',position:[0.57,1.15,0],dimensions:[1.14,2.3,0.07],material:doorMaterial,
      interaction:spec.interactive?{trigger:'click',key:'',radius:3.5,action:'toggleAnimation',targetId:'balcony-hinge',message:'Abrir / fechar varanda'}:undefined})
    for(const s of [-1,1]) parts.push({id:`balcony-handle${s}`,parentId:'balcony-hinge',name:'Maçaneta da varanda',kind:'box',position:[1,1.15,s*0.07],dimensions:[0.13,0.045,0.06],material:{color:'#bfa16a',metalness:0.8,roughness:0.3},collidable:false})
  }
  if(plan.furnished) {
    const x=-w/2+1.8, z=-d/2+1.5
    // Dining area with real knee room and individual legs.
    furniture.box(x,base+0.77,z,1.7,0.1,1.05)
    for(const a of [-1,1]) for(const b of [-1,1]) furniture.box(x+a*0.7,base+0.36,z+b*0.4,0.09,0.72,0.09)
    for(const a of [-1,1]) { furniture.box(x+a*1.15,base+0.45,z,0.5,0.09,0.5); furniture.box(x+a*1.36,base+0.76,z,0.08,0.6,0.5); for(const b of [-1,1]) for(const c of [-1,1]) furniture.box(x+a*1.15+b*0.18,base+0.21,z+c*0.18,0.06,0.42,0.06) }
    const sofaX=-w/2+0.85
    furniture.box(sofaX,base+0.24,0.8,1,0.3,2.2); fabric.box(sofaX+0.05,base+0.495,0.8,0.9,0.2,1.85); fabric.box(sofaX-0.37,base+0.78,0.8,0.22,0.7,2.1)
    for(const s of [-1,1]) fabric.box(sofaX,base+0.65,0.8+s*0.98,1,0.35,0.16)
    // Kitchen along the rear wall, away from the entry and stair approach.
    furniture.box(0.65,base+0.45,-d/2+0.6,2.3,0.9,0.65); stone.box(0.65,base+0.94,-d/2+0.6,2.4,0.08,0.73)
    for(let i=0;i<3;i++) metal.box(-0.08+i*0.7,base+0.72,-d/2+0.98,0.22,0.035,0.035)
    const bedY=base+(floors-1)*story, bedX=floors>1?-w/2+1.65:w/2-1.65, bedZ=d/2-1.7
    furniture.box(bedX,bedY+0.26,bedZ,1.75,0.4,2.35); fabric.box(bedX,bedY+0.52,bedZ,1.7,0.17,2.25)
    furniture.box(bedX,bedY+0.62,bedZ+1.16,1.85,0.9,0.12)
    for(const s of [-1,1]) fabric.box(bedX+s*0.4,bedY+0.66,bedZ+0.72,0.63,0.14,0.48)
    if(floors>1) {
      // A bedroom screen leaves a 1.1 m opening to the upper hall.
      walls.box(-w/2+(w-3.2)/2,bedY+1.4,0,w-3.2,2.8,0.12)
      furniture.box(-w/2+0.65,bedY+0.95,-d/2+1.06,0.6,1.9,1.5)
    }
  }
  // Light comes from fixtures, never from opaque emissive window rectangles.
  for(let level=0;level<floors;level++) {
    const y=base+story*(level+1)-0.35
    metal.box(-0.7,y+0.12,0,0.04,0.32,0.04)
    const shade=batch(`shade${level}`,'Difusor da luminária',{color:'#f3ddba',emissive:'#ffd49b',emissiveIntensity:spec.lit?0.4:0,roughness:0.7},false)
    shade.box(-0.7,y,0,0.48,0.12,0.48)
    if(spec.lit) parts.push({id:level?'lamp-upper':'lamp',parentId:null,name:level?'Iluminação do pavimento superior':'Iluminação interna',kind:'light',position:[-0.7,y-0.12,0],dimensions:[0.15,0.15,0.15],light:{type:'point',color:'#ffdfb2',intensity:28,distance:9,angle:35,penumbra:0.5,castShadow:true}})
  }
  return [...batches.map(b=>b.part()).filter((p):p is PrefabPart=>p!==null),...parts]
}
