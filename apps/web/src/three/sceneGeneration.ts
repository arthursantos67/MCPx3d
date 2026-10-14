import type { AgentMessage, JsonSchema, LLMProvider } from '../../../../packages/agent/src/provider.ts'
import { inspectSceneAsync } from './inspectSceneAsync.ts'
import { repairImproved, type SceneInspection } from './sceneInspection.ts'
import { defaultGeometry } from './sceneGeometrySpec.ts'
import { createEmptyScene, MAX_SCENE_NODES, validateAnimation, validateScene, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'

const numeric = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum })
const tuple = (minimum: number, maximum: number) => ({ type: 'array', items: numeric(minimum, maximum), minItems: 3, maxItems: 3 })
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const axis = { type: 'string', enum: ['x', 'y', 'z'] }
const partial = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false })
const geometrySchema = partial({ segments: { type: 'integer', minimum: 8, maximum: 128 }, radius: numeric(0.001, 0.5), bevel: numeric(0, 0.2), closed: { type: 'boolean' },
  profile: { type: 'array', maxItems: 64, items: { type: 'array', minItems: 2, maxItems: 2, items: numeric(-1000, 1000) } },
  holes: { type: 'array', maxItems: 8, items: { type: 'array', maxItems: 32, items: { type: 'array', minItems: 2, maxItems: 2, items: numeric(-1000, 1000) } } },
  points: { type: 'array', maxItems: 64, items: tuple(-1000, 1000) },
  vertices: { type: 'array', maxItems: 300000, items: numeric(-1000, 1000) }, indices: { type: 'array', maxItems: 300000, items: { type: 'integer', minimum: 0, maximum: 99999 } },
})
const materialSchema = partial({ opacity: numeric(0, 1), transparent: { type: 'boolean' }, doubleSided: { type: 'boolean' }, alphaTest: numeric(0, 1), color: { type: 'string' }, metalness: numeric(0, 1), roughness: numeric(0, 1), clearcoat: numeric(0, 1), transmission: numeric(0, 1),
  emissive: { type: 'string' }, emissiveIntensity: numeric(0, 10), texture: { type: 'string', enum: ['none', 'metal', 'concrete', 'wood', 'solar', 'tiles'] }, textureScale: numeric(0.1, 32) })
export const sceneRecipeSchema: JsonSchema = object({
  name: { type: 'string', minLength: 1, maxLength: 120 }, background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
  exposure: numeric(0.1, 3), lightIntensity: numeric(0, 5), duration: numeric(1, 120),
  nodes: { type: 'array', minItems: 1, maxItems: 80, items: object({
    id: { type: 'string', minLength: 1, maxLength: 100 }, parentId: { type: ['string', 'null'] }, name: { type: 'string', minLength: 1, maxLength: 110 },
    kind: { type: 'string', enum: ['group', 'box', 'sphere', 'cylinder', 'torus', 'roundedBox', 'cone', 'torusKnot', 'extrude', 'lathe', 'tube', 'mesh'] },
    geometry: { anyOf: [{ type: 'null' }, geometrySchema] },
    surface: { anyOf: [{ type: 'null' }, materialSchema] },
    overlapWith: { type: 'array', maxItems: 32, items: { type: 'string' } },
    position: tuple(-10000, 10000), rotation: tuple(-360, 360), scale: tuple(0.01, 100), dimensions: tuple(0.01, 1000),
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, metalness: numeric(0, 1), roughness: numeric(0, 1),
    animation: object({ kind: { type: 'string', enum: ['none', 'spin', 'float', 'orbit'] }, axis, duration: numeric(1, 120), amplitude: numeric(0, 100), phase: numeric(0, 360) }),
    repeat: object({ mode: { type: 'string', enum: ['linear', 'radial'] }, count: { type: 'integer', minimum: 1, maximum: 100 }, offset: tuple(-1000, 1000), radius: numeric(0, 1000), axis }),
  }) },
})
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A receita precisa conter objetos JSON.')
  return value as Record<string, unknown>
}
export function expandSceneRecipe(value: unknown, onExpand: (templates: number) => void = () => {}, existingNodes: SceneNode[] = []): ThreeSceneDocument {
  const recipe = record(value)
  if (!Array.isArray(recipe.nodes) || !recipe.nodes.length || recipe.nodes.length > 80) throw new Error('Use de 1 a 80 templates na receita.')
  onExpand(recipe.nodes.length)
  const nodes: SceneNode[] = []
  for (const entry of recipe.nodes) {
    const node = record(entry), repeat = record(node.repeat)
    if (!Number.isInteger(repeat.count) || (repeat.count as number) < 1 || (repeat.count as number) > 100) throw new Error('Repetições precisam de 1 a 100 cópias.')
    if (!['linear', 'radial'].includes(repeat.mode as string) || !['x', 'y', 'z'].includes(repeat.axis as string)) throw new Error('Padrão de repetição inválido.')
    if (!Array.isArray(repeat.offset) || repeat.offset.length !== 3 || repeat.offset.some((v) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1000)) throw new Error('Offset de repetição inválido.')
    if (typeof repeat.radius !== 'number' || !Number.isFinite(repeat.radius) || repeat.radius < 0 || repeat.radius > 1000) throw new Error('Raio de repetição inválido.')
    if (node.kind === 'group' && repeat.count !== 1) throw new Error('Grupos não podem ser repetidos; repita suas malhas.')
    if (existingNodes.length + nodes.length + (repeat.count as number) > MAX_SCENE_NODES) throw new Error('A expansão excede 500 nós. Reduza as repetições.')
    // Validate a template before arithmetic, without requiring its parent to have appeared first.
    const base = validateScene({ ...createEmptyScene(), nodes: [{ ...node, parentId: null, visible: true,
      material: { color: node.color, metalness: node.metalness, roughness: node.roughness, ...(node.surface ? record(node.surface) : {}) }, overlapWith: [], animation: validateAnimation(node.animation) }] }).nodes[0]
    for (let index = 0; index < (repeat.count as number); index++) {
      const position: Vector3Tuple = [...base.position], rotation: Vector3Tuple = [...base.rotation]
      if (repeat.mode === 'linear') for (let i = 0; i < 3; i++) position[i] += (repeat.offset[i] as number) * index
      else {
        const a = { x: 0, y: 1, z: 2 }[repeat.axis as 'x' | 'y' | 'z'], angle = 2 * Math.PI * index / (repeat.count as number)
        position[(a + 1) % 3] += repeat.radius * Math.cos(angle)
        position[(a + 2) % 3] += repeat.radius * Math.sin(angle)
        rotation[a] = ((rotation[a] + angle * 180 / Math.PI + 180) % 360) - 180
      }
      nodes.push({ ...structuredClone(base), id: index ? `${base.id}~${index + 1}` : base.id,
        name: index ? `${base.name.slice(0, 110)} ${index + 1}` : base.name, overlapWith: node.overlapWith === undefined ? [] : node.overlapWith as string[], parentId: node.parentId as string | null, position, rotation })
    }
  }
  return validateScene({ version: '1.0', name: recipe.name, nodes: [...existingNodes, ...nodes], timeline: { duration: recipe.duration },
    environment: { background: recipe.background, exposure: recipe.exposure, lightIntensity: recipe.lightIntensity, grid: false, wireframe: false } })
}
const SYSTEM = `Você é o diretor de arte 3D do Forma. Produza uma cena COMPLETA, detalhada e animada como receita JSON, sem código, markdown ou perguntas. Planeje composição, escala, paleta, arquitetura, adereços e movimentos coerentes. Use grupos com IDs únicos, parentId null na raiz e referências somente a grupos. Eixo vertical Y, metros, rotações XYZ em graus, transformações locais ao pai. Catálogo: group, box, roundedBox (bevel normalizado), sphere, cylinder e cone (altura Y), torus (anel XY), torusKnot, extrude, lathe, tube e mesh. geometry pode ser null para os padrões. extrude usa profile [[x,y],...] sem cruzamentos, holes opcional para recortes, profundidade Z e bevel; lathe usa profile [[raio,altura],...] girando em Y (comece/termine com raio zero para fechar); tube usa points XYZ de uma CatmullRom com radius normalizado; mesh usa vertices XYZ planos e indices de triângulos. Toda geometria é centrada e normalizada para a caixa dimensions. Mais segmentos refinam curvas sem mudar as dimensões. Reserve superfícies orgânicas para lathe/tube/extrude; dê aos elementos principais silhueta e espessura próprias. dimensions é a caixa XYZ. scale normalmente [1,1,1].
Use repeat para gerar muitos detalhes com poucos tokens: linear desloca cada cópia por offset; radial distribui cópias ao redor de position, no plano normal a axis, com radius e rotação correspondente. Para nós únicos: repeat={mode:"linear",count:1,offset:[0,0,0],radius:0,axis:"y"}. Nunca repita grupos. Máximo 80 templates e 500 nós após expandir, de preferência 12–35 templates bem compostos. Não confunda quantidade de templates com objetos finais. Texturas procedurais em surface.texture: metal, concrete, wood, solar, tiles. Assets GLB importados pelo usuário existem como malhas; nunca invente URLs ou base64. Use geometria especializada nos elementos principais, não monte toda forma só de caixas/esferas.
Cada nó possui animation={kind,axis,duration,amplitude,phase}. none é estático; spin gira 360° por período; float oscila ±amplitude no eixo; orbit circula em torno da posição base no plano normal ao eixo, com raio amplitude. Grupos animam filhos. Evite orbitar grandes estruturas; use grupos para sistemas planetários/engrenagens decorativas. Períodos de 1–120 s, amplitude 0–100 m, fase 0–360°. Use períodos divisores da duração da timeline para loops suaves. Crie movimento onde pedido e preserve bases estáticas. Material: color #RRGGBB, metalness/roughness de 0 a 1. surface aceita clearcoat, transmission, emissive #RRGGBB, emissiveIntensity e texturas procedurais com textureScale. Há iluminação de estúdio com reflexos e sombras. Use acabamentos variados e detalhes construtivos coerentes, evite cores chapadas e formas genéricas. Não há dinâmica física ou validação CAD.
Planeje envelopes espaciais ANTES de posicionar: respeite dimensões/rotações/escala globais, distância entre módulos, raio das órbitas e folgas ao longo do movimento. Em padrões lineares offset deve superar a extensão do objeto na direção repetida. Em padrões radiais, 2*raio*sin(pi/count) deve acomodar a largura tangencial com folga. Use grupos para satélites completos, com órbitas centradas no mesmo núcleo e fases distintas. overlapWith declara SOMENTE contatos intencionais por ID (ex.: eixo que entra no cubo); nunca marque todos os objetos como contatos para esconder erros. O motor inspeciona superfícies e contenção em poses amostradas e recusará sobreposições inesperadas. Não prometa recursos fora deste contrato. Responda estritamente ao schema.`

async function completion(provider: LLMProvider, messages: AgentMessage[], signal: AbortSignal, schema: JsonSchema = sceneRecipeSchema): Promise<unknown> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Cancelado', 'AbortError')
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { void provider.cancel?.().catch(() => {}); reject(signal.reason ?? new DOMException('Cancelado', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([provider.generateStructured<unknown>(messages, schema, { temperature: 0.4, maxTokens: Math.min(8192, provider.maxOutputTokens ?? 8192) }), cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
export class SceneSpatialError extends Error {
  readonly inspection: SceneInspection
  constructor(inspection: SceneInspection) {
    super(!inspection.complete ? 'A inspeção espacial não terminou dentro do orçamento. Reduza a complexidade.' : `A cena apresenta ${inspection.intersections.length} pares com cruzamento/contenção inesperados. ${inspection.intersections.slice(0, 3).map((issue) => `${issue.nameA} ↔ ${issue.nameB}`).join("; ")}. A proposta foi recusada; a cena atual foi preservada.`)
    this.name = 'SceneSpatialError'
    this.inspection = inspection
  }
}
export function spatialSummary(report: SceneInspection): string {
  return JSON.stringify({ complete: report.complete, pairs: report.intersections.length, samples: report.sampledTimes,
    intersections: report.intersections.slice(0, 16).map(({ a, b, kind, times }) => ({ a, b, kind, times })) })
}

export type SceneGenerationStage = 'prepare' | 'waiting' | 'validation' | 'expansion' | 'inspection' | 'application'
export interface SceneGenerationEvent {
  stage: SceneGenerationStage
  attempt: number
  detail: string
  templates?: number
  objects?: number
}
export const generationStageLabels: Record<SceneGenerationStage, string> = {
  prepare: 'Preparar pedido', waiting: 'Planejamento e receita na IA', validation: 'Validar receita',
  expansion: 'Construir objetos', inspection: 'Verificar superfícies e movimentos', application: 'Aplicar cena',
}
export class SceneGenerationTimeoutError extends Error {
  constructor(seconds: number, event: SceneGenerationEvent) {
    super(`O prazo de ${seconds / 60} minutos foi atingido na etapa “${generationStageLabels[event.stage]}” (chamada ${event.attempt}). A cena anterior foi preservada. Ajuste o tempo máximo e envie o pedido novamente; a resposta interrompida não pode ser retomada.`)
    this.name = 'SceneGenerationTimeoutError'
  }
}
export async function generateThreeScene(provider: LLMProvider, request: string, signal: AbortSignal,
  onPhase: (phase: string) => void = () => {}, onProgress: (event: SceneGenerationEvent) => void = () => {}): Promise<ThreeSceneDocument> {
  if (!request.trim() || request.length > 4000) throw new Error('Descreva sua cena em até 4.000 caracteres.')
  const report = (event: SceneGenerationEvent) => { onPhase(event.detail); onProgress(event) }
  report({ stage: 'prepare', attempt: 1, detail: 'Pedido e contrato preparados para a IA.' })
  const messages: AgentMessage[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: request }]
  for (let attempt = 0; attempt < 2; attempt++) {
    report({ stage: 'waiting', attempt: attempt + 1, detail: attempt ? 'Corrigindo o contrato da cena…' : 'Aguardando a IA planejar e produzir a receita completa…' })
    const recipe = await completion(provider, messages, signal)
    if (signal.aborted) throw signal.reason ?? new DOMException('Cancelado', 'AbortError')
    report({ stage: 'validation', attempt: attempt + 1, detail: 'Resposta recebida. Verificando o contrato da receita…' })
    let document: ThreeSceneDocument
    try {
      document = expandSceneRecipe(recipe, (templates) => report({ stage: 'expansion', attempt: attempt + 1,
        detail: `Construindo os objetos a partir de ${templates} templates e verificando a hierarquia…`, templates }))
    } catch (error) {
      if (attempt) throw error
      report({ stage: 'validation', attempt: attempt + 1, detail: `A receita precisa de correção: ${error instanceof Error ? error.message : String(error)}` })
      messages.push({ role: 'assistant', content: JSON.stringify(recipe).slice(0, 50000) },
        { role: 'user', content: `Corrija a receita completa preservando a intenção original. Falha: ${error instanceof Error ? error.message : String(error)}. Última tentativa; entregue JSON.` })
      continue
    }
    report({ stage: 'inspection', attempt: attempt + 1, detail: 'Inspecionando superfícies e movimentos em worker…' })
    const inspection = await inspectSceneAsync(document, signal)
    if (!inspection.complete || inspection.intersections.length) {
      if (attempt || !inspection.complete) throw new SceneSpatialError(inspection)
      messages.push({ role: 'assistant', content: JSON.stringify(recipe).slice(0, 50000) },
        { role: 'user', content: `Ajuste os posicionamentos, dimensões e órbitas para eliminar os cruzamentos inesperados, mantendo os detalhes e objetos solicitados. Contatos legítimos podem ser declarados individualmente; não ignore pares arbitrários. Diagnóstico: ${spatialSummary(inspection)}. Última tentativa. Entregue a receita completa.` })
      continue
    }
    report({ stage: 'application', attempt: attempt + 1, detail: `${document.nodes.length} objetos e poses amostradas verificados. Preparando aplicação…`, objects: document.nodes.length })
    return document
  }
  throw new Error('Não foi possível validar a cena.')
}

const nodeRecipeSchema = (sceneRecipeSchema.properties as Record<string, { items: unknown }>).nodes.items
export const sceneEditSchema: JsonSchema = object({
  updates: { type: 'array', maxItems: 500, items: object({ id: { type: 'string' }, changes: partial({ kind: { type: 'string', enum: ['group', 'box', 'sphere', 'cylinder', 'torus', 'roundedBox', 'cone', 'torusKnot', 'extrude', 'lathe', 'tube', 'mesh'] }, name: { type: 'string' }, parentId: { type: ['string', 'null'] },
    visible: { type: 'boolean' }, position: tuple(-10000, 10000), rotation: tuple(-360, 360), scale: tuple(0.01, 100), dimensions: tuple(0.01, 1000),
    material: materialSchema, geometry: geometrySchema,
    animation: partial({ kind: { type: 'string', enum: ['none', 'spin', 'float', 'orbit'] }, axis, duration: numeric(1, 120), amplitude: numeric(0, 100), phase: numeric(0, 360) }) }) }) },
  additions: { type: 'array', maxItems: 80, items: nodeRecipeSchema },
})
export function applySceneEdit(doc: ThreeSceneDocument, value: unknown): ThreeSceneDocument {
  const plan = record(value)
  if (!Array.isArray(plan.updates) || plan.updates.length > 500 || !Array.isArray(plan.additions) || plan.additions.length > 80) throw new Error('Edição exige updates/additions dentro dos limites.')
  if (Object.keys(plan).some((key) => !['updates', 'additions'].includes(key))) throw new Error('A edição contém operações desconhecidas; exclusões não são permitidas neste fluxo.')
  const patches = new Map<string, Record<string, unknown>>()
  for (const entry of plan.updates) {
    const update = record(entry), changes = record(update.changes)
    if (typeof update.id !== 'string' || !doc.nodes.some((node) => node.id === update.id) || patches.has(update.id)) throw new Error('Edição referencia um ID inexistente ou duplicado.')
    if (Object.keys(changes).some((key) => !['kind', 'name', 'parentId', 'visible', 'position', 'rotation', 'scale', 'dimensions', 'material', 'geometry', 'animation'].includes(key))) throw new Error('Campo de edição desconhecido. Contatos intencionais não podem ser alterados para mascarar interferências.')
    patches.set(update.id, changes)
  }
  let nodes = doc.nodes.map((node) => {
    const changes = patches.get(node.id)
    return changes ? { ...node, ...changes,
      material: changes.material ? { ...node.material, ...record(changes.material) } : node.material,
      geometry: changes.geometry ? { ...(changes.kind && changes.kind !== node.kind ? defaultGeometry(String(changes.kind)) : node.geometry), ...record(changes.geometry) } : changes.kind && changes.kind !== node.kind ? defaultGeometry(String(changes.kind)) : node.geometry,
      animation: changes.animation ? { ...node.animation, ...record(changes.animation) } : node.animation } : node
  })
  if (plan.additions.length) {
    nodes = expandSceneRecipe({ name: doc.name, background: doc.environment.background, exposure: doc.environment.exposure, lightIntensity: doc.environment.lightIntensity,
      duration: doc.timeline.duration, nodes: plan.additions }, () => {}, nodes).nodes
  }
  const result = validateScene({ ...doc, nodes })
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32 * 1024 * 1024) throw new Error('O projeto editado excede 32 MB.')
  return result
}
function editContext(doc: ThreeSceneDocument, inspection: SceneInspection, selectedId?: string | null): string {
  return JSON.stringify({ name: doc.name, selectedId: selectedId ?? null, timeline: doc.timeline, environment: doc.environment,
    nodes: doc.nodes.map((node) => ({ id: node.id, parentId: node.parentId, name: node.name, kind: node.kind, position: node.position, rotation: node.rotation, scale: node.scale, dimensions: node.dimensions,
      animation: node.animation, overlapWith: node.overlapWith,
      ...(node.id === selectedId ? { material: { ...node.material, textureImage: node.material.textureImage ? '[imagem incorporada preservada]' : '' },
        geometry: node.kind === 'mesh' ? { vertices: node.geometry.vertices.length / 3, triangles: node.geometry.indices.length / 3 } : node.geometry } : {}) })),
    inspection: JSON.parse(spatialSummary(inspection)) })
}
export async function editThreeScene(provider: LLMProvider, doc: ThreeSceneDocument, request: string, signal: AbortSignal,
  options: { mode: 'edit' | 'repair'; selectedId?: string | null; onProgress?: (event: SceneGenerationEvent) => void; onInspection?: (report: SceneInspection) => void }): Promise<ThreeSceneDocument> {
  if (request.length > 4000) throw new Error('Descreva a alteração em até 4.000 caracteres.')
  const report = options.onProgress ?? (() => {})
  report({ stage: 'prepare', attempt: 0, detail: 'Inspecionando a cena existente antes de propor alterações…' })
  const before = await inspectSceneAsync(doc, signal)
  options.onInspection?.(before)
  if (!before.complete) throw new SceneSpatialError(before)
  if (options.mode === 'repair' && !before.intersections.length) {
    report({ stage: 'application', attempt: 0, detail: 'Nenhuma interferência inesperada foi detectada nas poses amostradas. Cena preservada.', objects: doc.nodes.length })
    return doc
  }
  const messages: AgentMessage[] = [{ role: 'system', content: SYSTEM + `
Agora você EDITA uma cena existente. Retorne {updates:[{id,changes:{somente campos alterados}}],additions:[templates de receita]}. Preserve IDs, todos os nós não mencionados, materiais/mapas e movimentos. Não exclua, não oculte objetos para esconder colisões, não troque toda a cena por outra e não altere overlapWith. Edições de reparo devem ajustar posições/rotações/órbitas, preservando dimensões/geometria/hierarquia/visibilidade, para reduzir os pares diagnosticados sem criar novos. A geometria de malhas importadas omitida no contexto deve permanecer intacta. Adicione detalhes somente quando solicitado. A posição é local ao grupo, dimensões são caixas locais; considere rotações e escalas de todos os pais.` },
    { role: 'user', content: `${options.mode === 'repair' ? 'Corrija as sobreposições diagnosticadas conservando a composição, objetos e animações.' : request}
${options.mode === 'repair' ? request : ''}
CENA E DIAGNÓSTICO: ${editContext(doc, before, options.selectedId)}` }]
  for (let attempt = 1; attempt <= 2; attempt++) {
    report({ stage: 'waiting', attempt, detail: attempt === 1 ? 'A IA está revisando a cena existente e propondo alterações por ID…' : 'A IA está corrigindo a proposta com base no novo diagnóstico…' })
    const plan = await completion(provider, messages, signal, sceneEditSchema)
    if (signal.aborted) throw signal.reason
    report({ stage: 'validation', attempt, detail: 'Validando as alterações por ID e a preservação da cena existente…' })
    let candidate: ThreeSceneDocument
    try { candidate = applySceneEdit(doc, plan) }
    catch (error) {
      if (attempt === 2) throw error
      messages.push({ role: 'assistant', content: JSON.stringify(plan).slice(0, 50000) }, { role: 'user', content: `Proposta recusada: ${error instanceof Error ? error.message : String(error)}. Corrija o patch, conservando os IDs da cena original.` })
      continue
    }
    if (options.mode === 'repair') {
      if (candidate.nodes.length !== doc.nodes.length) throw new Error('Reparo espacial não adiciona nem remove objetos; use Editar cena para detalhar.')
      for (const node of candidate.nodes) {
        const original = doc.nodes.find((old) => old.id === node.id)!
        if (node.visible !== original.visible || node.parentId !== original.parentId || node.kind !== original.kind || JSON.stringify(node.dimensions) !== JSON.stringify(original.dimensions) || JSON.stringify(node.scale) !== JSON.stringify(original.scale) || JSON.stringify(node.geometry) !== JSON.stringify(original.geometry)) throw new Error('O reparo tentou ocultar, reparentear ou modificar a geometria/dimensões. Corrija posições, rotações e órbitas preservando os objetos.')
      }
    }
    report({ stage: 'inspection', attempt, detail: 'Verificando as superfícies e os movimentos da cena editada…' })
    const after = await inspectSceneAsync(candidate, signal)
    const originalPairs = new Set(before.intersections.map((issue) => [issue.a, issue.b].sort().join('|')))
    const introduces = after.intersections.some((issue) => !originalPairs.has([issue.a, issue.b].sort().join('|')))
    const accepted = options.mode === 'repair' ? repairImproved(before, after) : after.complete && !introduces
    if (accepted) {
      options.onInspection?.(after)
      report({ stage: 'application', attempt, detail: `Alterações verificadas: ${before.intersections.length} → ${after.intersections.length} pares inesperados.`, objects: candidate.nodes.length })
      return candidate
    }
    if (attempt === 2 || !after.complete) throw new Error(`A alteração não reduziu as interferências ou introduziu novos pares. A cena anterior foi preservada. ${after.intersections.length} pares inesperados permanecem nas poses amostradas.`)
    messages.push({ role: 'assistant', content: JSON.stringify(plan).slice(0, 50000) }, { role: 'user', content: `Corrija o patch a partir da cena ORIGINAL. A proposta introduziu novos problemas ou não reduziu os existentes: ${spatialSummary(after)}. Não oculte nem remova objetos.` })
  }
  throw new Error('Não foi possível validar a edição.')
}
