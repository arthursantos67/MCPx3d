import type { SceneNode, Vector3Tuple } from './sceneDocument.ts'
import { terrainHeights } from './sceneGeometrySpec.ts'

type Point=[number,number]
type Polygon=Point[]
export const PATH_CLEARANCE=0.06
const cross=(a:Point,b:Point,p:Point)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
const area=(p:Polygon)=>p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1]},0)/2
function halfPlane(polygon:Polygon,a:Point,b:Point,inside:boolean):Polygon {
  const output:Polygon=[],sign=inside?1:-1
  for(let i=0;i<polygon.length;i++) {
    const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=cross(a,b,p)*sign,dq=cross(a,b,q)*sign
    if(dp>=-1e-9) output.push(p)
    if((dp>1e-9&&dq< -1e-9)||(dp< -1e-9&&dq>1e-9)) {const t=dp/(dp-dq);output.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t])}
  }
  return output
}
function intersect(subject:Polygon,clip:Polygon):Polygon {let out=subject;for(let i=0;i<clip.length&&out.length;i++) out=halfPlane(out,clip[i],clip[(i+1)%clip.length],true);return out}
function subtract(subject:Polygon,clip:Polygon):Polygon[] {
  const outside:Polygon[]=[];let remaining=subject
  for(let i=0;i<clip.length&&remaining.length;i++) {
    const fragment=halfPlane(remaining,clip[i],clip[(i+1)%clip.length],false)
    if(fragment.length>=3&&Math.abs(area(fragment))>1e-8) outside.push(fragment)
    remaining=halfPlane(remaining,clip[i],clip[(i+1)%clip.length],true)
  }
  return outside
}
function ccw(p:Polygon):Polygon{return area(p)<0?p.reverse():p}
function footprints(points:Point[],width:number):Polygon[] {
  const result:Polygon[]=[]
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-4) continue
    const nx=-(b[1]-a[1])/length*width/2,nz=(b[0]-a[0])/length*width/2
    result.push(ccw([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]]))
    // Round joins fill the outside of sharp bends without overlapping already assigned surface.
    if(i<points.length-1) result.push(ccw(Array.from({length:12},(_,k)=>[b[0]+Math.cos(k/12*Math.PI*2)*width/2,b[1]+Math.sin(k/12*Math.PI*2)*width/2] as Point)))
  }
  return result
}

/** Infer only the old compiler's regular two-vertices-per-station ribbon; arbitrary meshes stay authored. */
export function legacyRoadSource(node:SceneNode,supportId:string):SceneNode['path']|undefined {
  const g=node.geometry,count=g.vertices.length/3
  if(count<4||count%2||g.indices.length!==(count/2-1)*6||g.uvs.length!==count*2) return
  for(let station=1;station<count/2;station++) {
    const a=(station-1)*2,expected=[a,a+2,a+1,a+1,a+2,a+3],actual=g.indices.slice((station-1)*6,station*6)
    if(!expected.every((v,i)=>actual[i]===v)) return
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
  g.vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)})
  const world=(i:number,axis:number)=>node.position[axis]+(g.vertices[i*3+axis]-(min[axis]+max[axis])/2)/(max[axis]-min[axis]||1)*node.dimensions[axis]
  const points:Point[]=[],widths:number[]=[]
  for(let i=0;i<count;i+=2) {points.push([(world(i,0)+world(i+1,0))/2,(world(i,2)+world(i+1,2))/2]);widths.push(Math.hypot(world(i,0)-world(i+1,0),world(i,2)-world(i+1,2)))}
  const width=widths.reduce((s,n)=>s+n,0)/widths.length
  if(width<1||width>16||widths.some(w=>Math.abs(w-width)>0.02)) return
  // Simplify straight samples; preserve bends within the portable source budget.
  const simplified=points.filter((p,i)=>!i||i===points.length-1||Math.abs(cross(points[i-1],points[i+1],p))>0.0001)
  if(simplified.length>64) return
  return {supportId,points:simplified,width}
}

const cache=new Map<string,Map<string,Pick<SceneNode,'geometry'|'position'|'dimensions'>>>()
/** Clip each route against the actual terrain triangles. One owner per patch prevents junction z-fighting. */
export function compileTerrainRoads(paths:SceneNode[],support:SceneNode):Map<string,Pick<SceneNode,'geometry'|'position'|'dimensions'>> {
  const signature=JSON.stringify([paths.map(n=>[n.id,n.path]),support.kind,support.geometry,support.position,support.scale,support.dimensions])
  const cached=cache.get(signature);if(cached) return cached
  const n=support.kind==='plane'?1:support.geometry.segments,heights=support.kind==='plane'?new Float32Array(4):terrainHeights(support.geometry),width=support.dimensions[0]*support.scale[0],depth=support.dimensions[2]*support.scale[2],tall=support.dimensions[1]*support.scale[1]
  const occupied=new Map<number,Polygon[]>(),result=new Map<string,Pick<SceneNode,'geometry'|'position'|'dimensions'>>()
  const grid=(i:number,j:number):Point=>[support.position[0]+(i/n-0.5)*width,support.position[2]+(j/n-0.5)*depth]
  for(const node of paths) {
    const vertices:number[]=[],indices:number[]=[],uvs:number[]=[]
    for(const footprint of footprints(node.path!.points,node.path!.width)) {
      const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1])
      const x0=Math.max(0,Math.floor((Math.min(...xs)-support.position[0])/width*n+n/2)),x1=Math.min(n-1,Math.floor((Math.max(...xs)-support.position[0])/width*n+n/2))
      const z0=Math.max(0,Math.floor((Math.min(...zs)-support.position[2])/depth*n+n/2)),z1=Math.min(n-1,Math.floor((Math.max(...zs)-support.position[2])/depth*n+n/2))
      for(let j=z0;j<=z1;j++) for(let i=x0;i<=x1;i++) for(let half=0;half<2;half++) {
        const corners=half?[[i+1,j+1],[i,j+1],[i+1,j]]:[[i,j],[i+1,j],[i,j+1]],triangle=corners.map(([x,z])=>grid(x,z))
        const clipped=intersect(triangle,footprint);if(clipped.length<3||Math.abs(area(clipped))<1e-8) continue
        const key=(j*n+i)*2+half,prior=occupied.get(key)??[]
        let fragments=[clipped]
        for(const piece of prior) fragments=fragments.flatMap(fragment=>subtract(fragment,piece))
        const [a,b,c]=triangle,denominator=cross(a,b,c),levels=corners.map(([x,z])=>support.position[1]+heights[z*(n+1)+x]*tall+PATH_CLEARANCE)
        for(const fragment of fragments) {
          if(fragment.length<3||Math.abs(area(fragment))<1e-8) continue
          const base=vertices.length/3
          for(const p of fragment) {
            const wb=((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/denominator,wc=cross(a,b,p)/denominator
            const compact=(v:number)=>Math.round(v*1e6)/1e6||0
            vertices.push(compact(p[0]),compact(levels[0]*(1-wb-wc)+levels[1]*wb+levels[2]*wc),compact(p[1]));uvs.push(compact(p[0]/2),compact(p[1]/2))
          }
          for(let k=1;k<fragment.length-1;k++) indices.push(base,base+k+1,base+k)
          prior.push(fragment)
        }
        occupied.set(key,prior)
      }
    }
    if(!indices.length) continue
    if(vertices.length/3>100000||indices.length/3>100000) throw new Error('A malha do caminho excedeu o orçamento; reduza extensão, largura ou resolução do terreno.')
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
    vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)})
    result.set(node.id,{geometry:{...node.geometry,vertices,indices,uvs,normals:[]},position:min.map((v,i)=>(v+max[i])/2) as Vector3Tuple,dimensions:min.map((v,i)=>Math.max(0.01,max[i]-v)) as Vector3Tuple})
  }
  if(cache.size>24) cache.clear();cache.set(signature,result)
  return result
}
