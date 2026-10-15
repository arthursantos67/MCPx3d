import { createNode, validateScene, type NodeKind, type Vector3Tuple, type ThreeSceneDocument } from './sceneDocument.ts'
import { expandSceneRecipe } from './sceneGeneration.ts'
import { hashNoise, terrainHeightAt } from './sceneGeometrySpec.ts'
import type { PrefabType } from './scenePrefabs.ts'
import { valleyPads, valleyPlacements, valleyRemoved } from './sceneShowcaseLayout.ts'
import { conformTerrainPaths } from './sceneGrounding.ts'

let valley: ThreeSceneDocument | null = null

/** A deliberately composed, walkable reference level, built with the same contract available to the agent. */
export function buildValleyScene() {
  const templates: Record<string, unknown>[] = []
  const add = (id: string, kind: NodeKind, position: Vector3Tuple, patch: Record<string, unknown> = {}) => {
    const node = createNode(kind)
    templates.push({ ...node, id, name: id, position, color: '#ffffff', metalness: 0, roughness: 0.85,
      repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', onto: 'ground' }, ...patch })
  }
  const prefab = (id: string, type: PrefabType, x: number, z: number, size = 1, seed = 1, patch: Record<string, unknown> = {}) =>
    add(id, 'group', [x, 0, z], { prefab: { type, size, seed, primary: null, secondary: null, text: '', lit: true, interactive: true }, ...patch })
  const scatter = (count: number, seed: number) => ({ mode: 'scatter', count, offset: [118, 0, 112], radius: 0, axis: 'y', columns: 1, jitter: 0.8, seed, onto: 'ground' })

  add('ground', 'terrain', [0, -2, 0], { name: 'Pradaria, encostas e afloramentos', dimensions: [136, 12, 136],
    geometry: { segments: 128, detail: 3, seed: 37, closed: false, terrainStyle: 'rolling', biome: 'meadow' },
    surface: { texture: 'rock', textureScale: 38, normalStrength: 0.45 }, repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' } })

  prefab('moinho', 'windmill', 0, -25, 1.4, 8, { name: 'O moinho do vale' })
  for (const [i, [x, z, turn]] of [[-18, 4, 65], [19, -3, -65], [-18, -20, 75], [20, -25, -70]].entries()) {
    const buildings = [
      { style: 'cottage', floors: 1, width: 9.4, depth: 9, furnished: true },
      { style: 'townhouse', floors: 2, width: 8, depth: 9.5, furnished: true },
      { style: 'lodge', floors: 2, width: 10, depth: 11, furnished: true },
      { style: 'villa', floors: 2, width: 12, depth: 9.5, furnished: true },
    ]
    prefab(`casa-${i}`, 'house', x, z, 1, i * 31 + 7, { name: ['Casa do jardim', 'Sobrado do artesão', 'Refúgio da encosta', 'Vila do mirante'][i], rotation: [0, turn, 0],
      prefab: { type: 'house', size: 1, seed: i * 31 + 7, primary: ['#e4d2b6', '#ded4c3', '#bda58a', '#d8d4c9'][i], secondary: ['#93583f', '#515c64', '#725343', '#777c79'][i], building: buildings[i], text: '', lit: true, interactive: true } })
  }
  prefab('poco', 'well', 7, 10, 1, 1, { name: 'Poço da praça' })
  prefab('banco', 'bench', -6, 12, 1, 1, { rotation: [0, 30, 0] })
  prefab('placa', 'sign', 3.5, 27, 1, 1, { prefab: { type: 'sign', size: 1, seed: 1, primary: null, secondary: null, text: 'O VALE DOS VENTOS\nSiga a trilha. Encontre os 7 cristais.', lit: false, interactive: true } })
  prefab('acampamento', 'campfire', -22, 20, 1, 1)
  prefab('chegada', 'portal', 0, -37, 1, 1, { name: 'Destino: jardim do moinho' })
  for (const [i, [x, z]] of [[0, 23], [0, -7], [0, -30]].entries()) prefab(`checkpoint-${i}`, 'checkpoint', x + 3, z, 0.85, i + 1)
  for (const [i, [x, z]] of [[-3, 20], [4, 9], [-6, 1], [4, -7], [-4, -15], [4, -24], [0, -32]].entries()) prefab(`cristal-${i}`, 'gem', x, z, 1.15, i + 1, { position: [x, 0.8, z] })
  for (const [i, [x, z]] of [[-8, 6], [9, -2], [-9, -16], [10, -25]].entries()) {
    prefab(`canteiro-${i}`, 'flowerBed', x, z, 1.3, i * 29 + 1)
    prefab(`poste-${i}`, 'lampPost', x * 0.65, z + 2, 0.95, i + 1)
  }
  // Forest masses frame the village; small plants do not obstruct the route or building footprints.
  prefab('arvores', 'tree', 0, 0, 1.2, 91, { name: 'Bosque de faias', repeat: scatter(32, 91) })
  prefab('pinheiros', 'pine', 0, 0, 1.45, 72, { name: 'Pinheiros da encosta', repeat: scatter(25, 72) })
  prefab('rochas', 'rock', 0, 0, 1.2, 11, { name: 'Afloramentos', repeat: scatter(24, 11) })
  prefab('arbustos', 'bush', 0, 0, 0.9, 24, { name: 'Vegetação rasteira', repeat: scatter(42, 24) })
  // A crossed blade cluster has 6 triangles instead of a solid cone for each tuft.
  add('gramineas', 'mesh', [0, 0, 0], { name: 'Gramíneas do vale', dimensions: [0.7, 0.6, 0.7], collidable: false,
    color: '#809954', surface: { doubleSided: true, roughness: 1 }, geometry: {
      vertices: [-0.5, 0, 0, -0.2, 0.85, 0.1, 0, 0, 0, 0, 0, -0.5, 0.1, 1, -0.15, 0, 0, 0.2, 0.1, 0, 0.1, 0.4, 0.65, 0, 0.5, 0, 0.2],
      indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    }, repeat: scatter(170, 53) })
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10 * 1.5 + 0.15) * Math.PI, x = Math.cos(angle) * 54, z = Math.sin(angle) * 54 - 8
    add(`escarpa-${i}`, 'polyhedron', [x, 0, z], { name: 'Escarpa de pedra', dimensions: [18 + hashNoise(i, 2, 7) * 6, 6 + hashNoise(i, 3, 7) * 8, 14],
      color: '#aba99b', surface: { texture: 'rock', textureScale: 5, roughness: 0.95 }, geometry: { variant: 'dodecahedron', detail: 2, bevel: 0.14, seed: i * 13 + 1 }, rotation: [0, i * 31 - 160, 0] })
  }
  const scene = expandSceneRecipe({ name: 'Vale dos Ventos', background: '#c6d8dd', exposure: 1.05, lightIntensity: 1.45, duration: 24,
    environment: { sky: 'day', sunElevation: 32, sunAzimuth: 125, fog: 0.0012, bloom: 0.12, ambientOcclusion: true, toneMapping: 'agx',
      player: { spawn: [0, 10, 29], yaw: 0, speed: 5, jumpHeight: 1.1, mode: 'walk', allowFly: true, health: 100, camera: 'first' },
      objective: { type: 'collectAll', title: 'Encontre os 7 cristais e chegue ao moinho', timeLimit: 0 } },
    roads: [{ name: 'Caminho do moinho', points: [[0, 32], [-1, 19], [1, 7], [-2, -5], [1, -17], [-5, -21], [-5, -30], [0, -34]], width: 3, texture: 'sand', onto: 'ground' },
      { name: 'Trilha dos chalés', points: [[-13, 6.4], [0, 8], [14, -0.7]], width: 2, texture: 'sand', onto: 'ground' },
      { name: 'Acesso do refúgio', points: [[-12, -18.5], [-6, -17], [1, -17]], width: 2, texture: 'sand', onto: 'ground' },
      { name: 'Acesso do mirante', points: [[13.5, -22.5], [7, -22.5], [1, -20]], width: 2, texture: 'sand', onto: 'ground' }], nodes: templates })
  // Spawn follows the final road surface; gameplay also validates it against the collider.
  const ground = scene.nodes.find((node) => node.id === 'ground')!
  if (scene.environment.player) scene.environment.player.spawn = [0, ground.position[1] + terrainHeightAt(ground.geometry, 0, 29 / 136) * ground.dimensions[1] + 0.15, 29]
  return scene
}

/** Layout is validated at build time so opening the studio never runs a synchronous physics audit. */
export function createValleyScene() {
  if (valley) return structuredClone(valley)
  const scene = buildValleyScene()
  const removed = new Set(valleyRemoved)
  scene.nodes = scene.nodes.filter((node) => !removed.has(node.id)).map((node) => ({ ...node,
    ...(valleyPlacements[node.id] ? { position: valleyPlacements[node.id] } : {}),
    ...(node.id === 'ground' && valleyPads ? { geometry: { ...node.geometry, pads: valleyPads } } : {}),
    overlapWith: node.overlapWith.filter((id) => !removed.has(id)),
  }))
  valley = validateScene(valleyPads ? conformTerrainPaths(scene) : scene)
  return structuredClone(valley)
}

/** Close reference for checking interiors, stairs, balcony and real windows in first person. */
export function createArchitectureScene() {
  const single={mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}
  const node=(id:string,kind:NodeKind,position:Vector3Tuple,patch:Record<string,unknown>={})=>({...createNode(kind),id,name:id,position,color:'#d7d0bc',metalness:0,roughness:0.85,repeat:single,...patch})
  return expandSceneRecipe({name:'Casa do artesão',background:'#bed3e3',exposure:1,lightIntensity:1.1,duration:12,
    environment:{sky:'day',sunElevation:42,sunAzimuth:220,fog:0.001,bloom:0.08,ambientOcclusion:true,toneMapping:'agx',
      player:{spawn:[0,0.22,7.3],yaw:0,speed:3.5,jumpHeight:1,mode:'walk',allowFly:true,health:100,camera:'first'},
      objective:{type:'explore',title:'Explore a casa, suba a escada e visite a varanda',timeLimit:0}},
    nodes:[node('jardim','plane',[0,-0.01,0],{dimensions:[48,0.01,48],color:'#c3cbb1',surface:{texture:'grass',textureScale:24}}),
      node('casa','group',[0,0,0],{prefab:{type:'house',size:1,seed:1,primary:'#dbcfb8',secondary:'#67544b',lit:true,interactive:true,building:{style:'townhouse',floors:2,width:9.4,depth:9,furnished:true}}}),
      node('caminho','plane',[0,0.004,9],{dimensions:[2,0.01,8],role:'path',surface:{texture:'rock',textureScale:4}}),
      node('arvore','group',[-9,0,-2],{prefab:{type:'tree',size:1.4,seed:15,lit:false,interactive:false}}),
      node('pinheiro','group',[9,0,-5],{prefab:{type:'pine',size:1.4,seed:6,lit:false,interactive:false}}),
      node('banco','group',[-7,0,6],{rotation:[0,30,0],prefab:{type:'bench',size:1,seed:1,lit:false,interactive:false}}),
      ...[-1,1].map(s=>node(`flores${s}`,'group',[s*3.2,0,6.9],{prefab:{type:'flowerBed',size:1.2,seed:3,lit:false,interactive:false}})),
    ]})
}
