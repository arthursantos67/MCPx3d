import { validateCadProgram, type CadProgramSpec, type CadProgramStep } from './cad-program.ts'

export type CadDesignKind = 'plate' | 'bracket' | 'flange' | 'enclosure' | 'spacer'
export interface CadDesignDocument {
  readonly format: 'forma-parametric-1'
  readonly kind: CadDesignKind
  readonly partId: string
  readonly parameters: Readonly<Record<string, number>>
}
export interface CadDesignField {
  readonly key: string
  readonly label: string
  readonly initial: number
  readonly min: number
  readonly max: number
  readonly integer?: boolean
}
const size = (key: string, label: string, initial: number, min = 1): CadDesignField => ({ key, label, initial, min, max: 1000 })
const holes = size('holeDiameter', 'Diâmetro dos furos (mm)', 5.5)
const thickness = size('thickness', 'Espessura (mm)', 6)
const width = size('width', 'Largura X (mm)', 80)
const depth = size('depth', 'Comprimento Y (mm)', 60)
const edge = size('edgeOffset', 'Centro do furo até a borda (mm)', 12)

export const CAD_DESIGNS: Readonly<Record<CadDesignKind, { label: string; description: string; fields: readonly CadDesignField[] }>> = {
  plate: { label: 'Placa de fixação', description: 'Placa com quatro furos passantes. Os centros acompanham as bordas ao mudar as medidas.', fields: [width, depth, thickness, holes, edge] },
  bracket: { label: 'Cantoneira em L', description: 'Base e parede em um sólido, com dois furos na base e dois na parede. A altura inclui a base.', fields: [width, depth, size('height', 'Altura total Z (mm)', 60), thickness, holes, edge] },
  flange: { label: 'Flange circular', description: 'Furo central e furação circular equidistante. Diâmetros e separação entre furos são verificados juntos.', fields: [size('diameter', 'Diâmetro externo (mm)', 90), thickness, size('boreDiameter', 'Diâmetro central (mm)', 24), size('boltCircleDiameter', 'Diâmetro do círculo de furação (mm)', 62), holes, { key: 'holeCount', label: 'Quantidade de furos', initial: 6, min: 3, max: 12, integer: true }] },
  enclosure: { label: 'Caixa aberta', description: 'Caixa com fundo e quatro paredes de espessura uniforme, aberta na face superior.', fields: [width, depth, size('height', 'Altura total Z (mm)', 35), size('wall', 'Parede e fundo (mm)', 3)] },
  spacer: { label: 'Bucha espaçadora', description: 'Bucha cilíndrica com passagem central e parede contínua.', fields: [size('diameter', 'Diâmetro externo (mm)', 24), size('boreDiameter', 'Diâmetro interno (mm)', 10), size('height', 'Altura Z (mm)', 20)] },
}

export class CadDesignError extends Error {
  readonly issues: readonly string[]
  constructor(issues: readonly string[]) { super(issues.join(' ')); this.name = 'CadDesignError'; this.issues = issues }
}

export function newCadDesign(kind: CadDesignKind): CadDesignDocument {
  return { format: 'forma-parametric-1', kind, partId: `parametric_${kind}`, parameters: Object.fromEntries(CAD_DESIGNS[kind].fields.map((field) => [field.key, field.initial])) }
}

/** A bounded, data-only source document. Never evaluates expressions or imported code. */
export function readCadDesign(raw: unknown): CadDesignDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CadDesignError(['Arquivo paramétrico inválido.'])
  const doc = raw as Record<string, unknown>
  if (doc.format !== 'forma-parametric-1' || typeof doc.kind !== 'string' || !Object.hasOwn(CAD_DESIGNS, doc.kind) ||
    Object.keys(doc).some((key) => !['format', 'kind', 'partId', 'parameters'].includes(key))) throw new CadDesignError(['Formato ou família paramétrica inválida.'])
  if (typeof doc.partId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(doc.partId)) throw new CadDesignError(['Use um identificador de 1–64 letras, números, hífens ou sublinhados.'])
  const kind = doc.kind as CadDesignKind
  if (!doc.parameters || typeof doc.parameters !== 'object' || Array.isArray(doc.parameters)) throw new CadDesignError(['Medidas ausentes.'])
  const values = doc.parameters as Record<string, unknown>
  const fields = CAD_DESIGNS[kind].fields
  const issues: string[] = []
  if (Object.keys(values).some((key) => !fields.some((field) => field.key === key))) issues.push('O arquivo contém medidas desconhecidas para esta família.')
  for (const field of fields) {
    const value = values[field.key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max || field.integer && !Number.isInteger(value)) {
      issues.push(`${field.label}: informe ${field.integer ? 'um inteiro' : 'um valor'} entre ${field.min} e ${field.max}.`)
    }
  }
  if (issues.length) throw new CadDesignError(issues)
  return { format: 'forma-parametric-1', kind, partId: doc.partId, parameters: Object.fromEntries(fields.map(({ key }) => [key, values[key] as number])) }
}

export interface CompiledCadDesign {
  readonly document: CadDesignDocument
  readonly spec: CadProgramSpec
  readonly expectedBoundsMm: readonly [number, number, number]
  readonly expectedVolumeMm3: number
}

/** Resolve design relationships once, then use the same ordinary 3.0 program in preview, validation and export. */
export function compileCadDesign(raw: unknown): CompiledCadDesign {
  const document = readCadDesign(raw)
  const p = document.parameters
  const issues: string[] = []
  const require = (condition: boolean, message: string) => { if (!condition) issues.push(message) }
  const margin = 1 // Explicit geometric allowance, not an engineering strength calculation.
  if (document.kind === 'plate' || document.kind === 'bracket') {
    require(p.edgeOffset - p.holeDiameter / 2 >= margin, 'Deixe pelo menos 1 mm de material entre cada furo e a borda.')
    require(p.width - 2 * p.edgeOffset - p.holeDiameter >= margin, 'A largura precisa separar os furos por pelo menos 1 mm de material.')
    if (document.kind === 'plate') require(p.depth - 2 * p.edgeOffset - p.holeDiameter >= margin, 'O comprimento precisa separar as duas fileiras de furos por pelo menos 1 mm de material.')
    else {
      require((p.depth - p.thickness - p.holeDiameter) / 2 >= margin, 'A base livre precisa acomodar os furos, com 1 mm de material de cada lado.')
      require((p.height - p.thickness - p.holeDiameter) / 2 >= margin, 'A parede acima da base precisa acomodar os furos, com 1 mm de material de cada lado.')
    }
  }
  if (document.kind === 'flange') {
    require((p.diameter - p.boltCircleDiameter - p.holeDiameter) / 2 >= margin, 'Deixe pelo menos 1 mm entre os furos de fixação e a borda externa.')
    require((p.boltCircleDiameter - p.holeDiameter - p.boreDiameter) / 2 >= margin, 'Deixe pelo menos 1 mm entre o furo central e os furos de fixação.')
    require(p.boltCircleDiameter * Math.sin(Math.PI / p.holeCount) - p.holeDiameter >= margin, 'Os furos vizinhos precisam de pelo menos 1 mm de material entre eles.')
  }
  if (document.kind === 'enclosure') {
    require(p.width - 2 * p.wall >= 1 && p.depth - 2 * p.wall >= 1, 'A largura e o comprimento precisam superar duas paredes em pelo menos 1 mm.')
    require(p.height - p.wall >= 1, 'A altura precisa superar a espessura do fundo em pelo menos 1 mm.')
  }
  if (document.kind === 'spacer') require((p.diameter - p.boreDiameter) / 2 >= margin, 'A bucha precisa de pelo menos 1 mm de parede radial.')
  if (issues.length) throw new CadDesignError(issues)

  const zero = { x: 0, y: 0, z: 0 }
  const steps: CadProgramStep[] = []
  const box = (id: string, op: 'base' | 'union' | 'cut', w: number, d: number, h: number, y = 0, z = h / 2): void => {
    steps.push({ id, op, shape: 'box', width: w, depth: d, height: h, position: { x: 0, y, z }, rotation: zero })
  }
  const hole = (id: string, diameter: number, height: number, x: number, y: number, z: number, rotation = zero): CadProgramStep => ({
    id, op: 'cut', shape: 'hole', diameter, height, holeType: 'plain', headDiameter: 0, headDepth: 0, termination: 'through', minBottomThickness: 1,
    position: { x, y, z }, rotation,
  })
  const holeArea = Math.PI * (p.holeDiameter / 2) ** 2
  let bounds: readonly [number, number, number]
  let volume: number
  switch (document.kind) {
    case 'plate': {
      box('plate', 'base', p.width, p.depth, p.thickness)
      for (const [row, y] of [-1, 1].entries()) steps.push({
        ...hole(`mount_row_${row + 1}`, p.holeDiameter, p.thickness + 0.5, -p.width / 2 + p.edgeOffset, y * (p.depth / 2 - p.edgeOffset), p.thickness),
        pattern: { kind: 'linear', count: 2, offset: { x: p.width - 2 * p.edgeOffset, y: 0, z: 0 } },
      })
      bounds = [p.width, p.depth, p.thickness]
      volume = (p.width * p.depth - 4 * holeArea) * p.thickness
      break
    }
    case 'bracket': {
      box('foot', 'base', p.width, p.depth, p.thickness)
      box('upright', 'union', p.width, p.thickness, p.height, -(p.depth - p.thickness) / 2)
      const pattern = { kind: 'linear' as const, count: 2, offset: { x: p.width - 2 * p.edgeOffset, y: 0, z: 0 } }
      steps.push({ ...hole('foot_mounts', p.holeDiameter, p.thickness + 0.5, -p.width / 2 + p.edgeOffset, p.thickness / 2, p.thickness), pattern })
      steps.push({ ...hole('wall_mounts', p.holeDiameter, p.thickness + 0.5, -p.width / 2 + p.edgeOffset, -p.depth / 2 + p.thickness, (p.height + p.thickness) / 2, { x: -90, y: 0, z: 0 }), pattern })
      bounds = [p.width, p.depth, p.height]
      volume = p.width * p.thickness * (p.depth + p.height - p.thickness) - 4 * holeArea * p.thickness
      break
    }
    case 'flange': {
      steps.push({ id: 'disc', op: 'base', shape: 'cylinder', diameter: p.diameter, height: p.thickness, position: { ...zero, z: p.thickness / 2 }, rotation: zero })
      steps.push(hole('center_bore', p.boreDiameter, p.thickness + 0.5, 0, 0, p.thickness))
      steps.push({ ...hole('bolt_circle', p.holeDiameter, p.thickness + 0.5, p.boltCircleDiameter / 2, 0, p.thickness),
        pattern: { kind: 'circular', count: p.holeCount, axis: 'z', center: zero, sweepAngle: 360 } })
      bounds = [p.diameter, p.diameter, p.thickness]
      volume = (Math.PI * (p.diameter ** 2 - p.boreDiameter ** 2) / 4 - p.holeCount * holeArea) * p.thickness
      break
    }
    case 'enclosure': {
      box('outside', 'base', p.width, p.depth, p.height)
      box('cavity', 'cut', p.width - 2 * p.wall, p.depth - 2 * p.wall, p.height - p.wall + 1, 0, (p.height + p.wall + 1) / 2)
      bounds = [p.width, p.depth, p.height]
      volume = p.width * p.depth * p.height - (p.width - 2 * p.wall) * (p.depth - 2 * p.wall) * (p.height - p.wall)
      break
    }
    case 'spacer': {
      steps.push({ id: 'sleeve', op: 'base', shape: 'tube', diameter: p.diameter, innerDiameter: p.boreDiameter, height: p.height, position: { ...zero, z: p.height / 2 }, rotation: zero })
      bounds = [p.diameter, p.diameter, p.height]
      volume = Math.PI * (p.diameter ** 2 - p.boreDiameter ** 2) / 4 * p.height
      break
    }
  }
  const spec: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: document.partId, steps }
  validateCadProgram(spec)
  return { document, spec, expectedBoundsMm: bounds, expectedVolumeMm3: volume }
}
