import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CadAssemblyValidationError, generateCadAssembly, type CadAssemblyProgress } from '../src/generate-cad-assembly.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadAssemblyIssue, CadBounds, CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'

const zero = { x: 0, y: 0, z: 0 }
const fixed = { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '' }
const rotary = { kind: 'rotary', axis: 'x', minimum: 0, maximum: 360, value: 0, pitch: 0, group: '' }
const box = (id: string) => ({ decision: 'create', question: '', assumptions: [], spec: {
  schemaVersion: '3.0', units: 'mm', partId: id, steps: [{ id: 'body', op: 'base', shape: 'box',
    position: zero, rotation: zero, width: 50, depth: 30, height: 20 }],
} })

test('verbose component assumptions do not interrupt an assembly or request a replacement program', async () => {
  const assumptions = Array.from({ length: 14 }, (_, index) => `${index}: ${'Folgas e posições inferidas para este suporte. '.repeat(10)}`)
  const plan = { decision: 'create', partId: 'supports', question: '', assumptions: ['Planejamento detalhado. '.repeat(20)], components: [
    { id: 'suporte-esquerdo', action: 'build', description: 'Support left', position: zero, motion: fixed },
    { id: 'suporte-direito', action: 'build', description: 'Support right', position: { x: 100, y: 0, z: 0 }, motion: fixed },
  ] }
  const left = { ...box('suporte-esquerdo'), assumptions }
  const right = box('suporte-direito')
  const provider = new MockLLMProvider([plan, left, right])
  const checked: string[] = []
  const result = await generateCadAssembly(provider, 'Crie dois suportes separados', async (candidate) => {
    checked.push(candidate.partId)
    return null
  }, async () => null)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.deepEqual(checked, ['suporte-esquerdo', 'suporte-direito'])
  assert.equal(provider.calls.length, 3)
  assert.deepEqual(result.assumptions, [...plan.assumptions, ...assumptions.map((item) => `suporte-esquerdo: ${item}`)])
  assert.deepEqual(result.spec.components.map((component) => component.steps), [left.spec.steps, right.spec.steps])
})

test('assembly explanatory fields must remain strings and string arrays', async () => {
  const provider = new MockLLMProvider(Array(2).fill({ decision: 'clarify', question: 'Preciso de detalhes', assumptions: [{ fake: 'text' }] }))
  await assert.rejects(generateCadAssembly(provider, 'Crie dois suportes', async () => null), /Metadados/)
})

for (const axis of ['x', 'y', 'z'] as const) for (const offset of [0, 40]) {
  test(`accumulates both end repairs along ${axis}, offset ${offset}, preserving geometry and IDs`, async () => {
    const dimensions = (length: number) => ({ width: axis === 'x' ? length : 100,
      depth: axis === 'y' ? length : 100, height: axis === 'z' ? length : 100 })
    const localBody = offset ? 17 : 0
    const localCap = offset ? -11 : 0
    const plan = { decision: 'create', partId: 'renamed_assembly', question: '', assumptions: [], components: [
      { id: 'shell', action: 'build', description: 'A long fixed shell', motion: fixed,
        position: { ...zero, [axis]: offset - localBody } },
      ...[1, -1].map((direction, i) => ({ id: i ? 'lid_negative' : 'lid_positive', action: 'build',
        description: 'A short fixed end body', motion: fixed,
        position: { ...zero, [axis]: offset + direction * 61 - localCap } })),
    ] }
    const programs = plan.components.map((component, i) => ({ ...box(component.id), spec: {
      ...box(component.id).spec, steps: [{ ...box(component.id).spec.steps[0], ...dimensions(i ? 8 : 120),
        position: { ...zero, [axis]: i ? localCap : localBody } }],
    } }))
    const provider = new MockLLMProvider([plan, ...programs])
    let checks = 0
    const inspect = async (candidate: CadAssemblySpec): Promise<CadAssemblyIssue | null> => {
      checks++
      const collisions: CadCollision[] = []
      const bodyBounds = { x: [-50, 50], y: [-50, 50], z: [-50, 50],
        [axis]: [offset - 60, offset + 60] } as CadBounds
      for (const cap of candidate.components.slice(1)) {
        const center = cap.position[axis] + localCap
        const capBounds = { ...bodyBounds, [axis]: [center - 4, center + 4] } as CadBounds
        const lower = Math.max(bodyBounds[axis][0], capBounds[axis][0])
        const upper = Math.min(bodyBounds[axis][1], capBounds[axis][1])
        if (upper <= lower) continue
        const overlapBounds = { ...bodyBounds, [axis]: [lower, upper] } as CadBounds
        const boundsText = (bounds: CadBounds) => ['x', 'y', 'z'].map((a) => {
          const [min, max] = bounds[a as typeof axis]
          return `${a}=[${min.toFixed(2)}, ${max.toFixed(2)}]`
        }).join(', ')
        const volume = (upper - lower) * 10000
        const message = `CAD components shell and ${cap.id} intersect at posição atual by ${volume.toFixed(2)} mm³; ` +
          `component volumes: shell=1200000.00, ${cap.id}=80000.00 mm³; ` +
          `overlap fractions: shell=${(volume / 1200000).toFixed(4)}, ${cap.id}=${(volume / 80000).toFixed(4)}; ` +
          `overlap bounds: ${boundsText(overlapBounds)}; component bounds: shell ${boundsText(bodyBounds)}; ${cap.id} ${boundsText(capBounds)}; add a clearance or reduce the travel`
        collisions.push({ components: ['shell', cap.id], pose: 'current', message, overlapVolumeMm3: volume,
          componentVolumesMm3: [1200000, 80000], overlapBoundsMm: overlapBounds, componentBoundsMm: [bodyBounds, capBounds] })
      }
      return collisions.length ? { message: collisions[0].message, collisions } : null
    }
    const result = await generateCadAssembly(provider, 'Create a mechanism with two fixed ends', async () => null, inspect)
    assert.equal(result.kind, 'create')
    if (result.kind !== 'create') return
    assert.equal(provider.calls.length, 4)
    assert.equal(checks, 3)
    assert.equal(result.spec.components[1].position[axis], offset + 64.5 - localCap)
    assert.equal(result.spec.components[2].position[axis], offset - 64.5 - localCap)
    assert.deepEqual(result.spec.components.map((item) => item.steps), programs.map((item) => item.spec.steps))
    assert.deepEqual(result.spec.components.map((item) => item.id), plan.components.map((item) => item.id))
  })
}

test('decomposes a generic mechanical request into independent bodies and rotary motion', async () => {
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'small_motor', question: '', assumptions: ['nominal millimeter dimensions'], components: [
      { id: 'housing', action: 'build', description: 'Fixed outer housing with an axial clearance bore.', position: zero, motion: fixed },
      { id: 'rotor', action: 'build', description: 'Separate rotating rotor with shaft.', position: zero, motion: rotary },
    ] },
    box('housing'), box('rotor'),
  ])
  const checked: string[] = []
  const progress: CadAssemblyProgress[] = []
  const result = await generateCadAssembly(provider, 'Build a small electric motor', async (spec) => {
    checked.push(spec.partId)
    return null
  }, undefined, undefined, (event) => progress.push(event))
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.deepEqual(result.spec.components.map((component) => component.id), ['housing', 'rotor'])
  assert.equal(result.spec.components[1].motion?.kind, 'rotary')
  assert.deepEqual(checked, ['housing', 'rotor'])
  assert.equal(provider.calls.length, 3)
  assert.equal(provider.calls[0].options?.maxTokens, 3000)
  assert.equal(provider.calls[1].options?.maxTokens, 3500)
  assert.match(provider.calls[0].messages[0].content, /2–8 physically separate/)
  assert.doesNotMatch(provider.calls[0].messages[0].content, /manual press/i)
  assert.deepEqual(progress.map((event) => [event.phase, event.completed]), [
    ['planning', 0], ['building', 0], ['checking-component', 0],
    ['building', 1], ['checking-component', 1], ['checking-assembly', 2], ['complete', 2],
  ])
  assert.deepEqual(progress[1].components.map((item) => item.id), ['housing', 'rotor'])
})

test('normalizes the shared command range and value of a linked motion group', async () => {
  const linked = 'linear_stage'
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'stage', question: '', assumptions: [], components: [
      { id: 'base', action: 'build', description: 'Fixed base.', position: zero, motion: fixed },
      { id: 'carriage', action: 'build', description: 'Sliding carriage.', position: zero,
        motion: { kind: 'slider', axis: 'x', minimum: -40, maximum: 40, value: 12, pitch: 0, group: linked, factor: 1 } },
      { id: 'lead_screw', action: 'build', description: 'Rotary drive screw.', position: zero,
        motion: { kind: 'rotary', axis: 'x', minimum: -360, maximum: 360, value: 90, pitch: 0, group: linked, factor: -90 } },
    ] },
    box('base'), box('carriage'), box('lead_screw'),
  ])
  const result = await generateCadAssembly(provider, 'Create a compact linear stage', async () => null)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  const coupled = result.spec.components.filter((component) => component.motion?.group === linked).map((component) => component.motion!)
  assert.equal(coupled.length, 2)
  assert.deepEqual(coupled.map(({ minimum, maximum, value }) => ({ minimum, maximum, value })), [
    { minimum: -40, maximum: 40, value: 12 },
    { minimum: -40, maximum: 40, value: 12 },
  ])
  assert.deepEqual(coupled.map((movement) => movement.factor), [1, -90])
})

test('provider rate limits stop assembly planning without a second model call', async () => {
  const provider = new MockLLMProvider([() => { throw new ProviderRequestError('status 429') }])
  await assert.rejects(generateCadAssembly(provider, 'Crie um motor', async () => null), /status 429/)
  assert.equal(provider.calls.length, 1)
})

test('retries a rate-limited component without rebuilding validated components', async () => {
  const plan = { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
    { id: 'housing', action: 'build', description: 'Fixed housing.', position: zero, motion: fixed },
    { id: 'rotor', action: 'build', description: 'Rotating core.', position: zero, motion: rotary },
    { id: 'tampa_traseira', action: 'build', description: 'Rear cover.', position: zero, motion: fixed },
  ] }
  const provider = new MockLLMProvider([
    plan, box('housing'), box('rotor'),
    () => { throw new ProviderRequestError('status 429') },
    box('tampa_traseira'),
  ])
  const checked: string[] = []
  const progress: CadAssemblyProgress[] = []
  const inspectPart = async (candidate: { partId: string }) => { checked.push(candidate.partId); return null }
  await assert.rejects(generateCadAssembly(provider, 'Crie um motor', inspectPart,
    undefined, undefined, (event) => progress.push(event)), /Componente tampa_traseira: status 429/)
  assert.equal(provider.calls.length, 4)
  assert.deepEqual(checked, ['housing', 'rotor'])
  assert.equal(progress.at(-1)?.completed, 2)
  assert.equal(progress.at(-1)?.components.length, 3)
  assert.equal(progress.at(-1)?.components[2].id, 'tampa_traseira')

  const resumed = await generateCadAssembly(provider, 'Crie um motor', inspectPart,
    undefined, undefined, (event) => progress.push(event))
  assert.equal(resumed.kind, 'create')
  if (resumed.kind === 'create') assert.equal(resumed.spec.components.length, 3)
  assert.deepEqual(checked, ['housing', 'rotor', 'tampa_traseira'])
  assert.equal(provider.calls.length, 5)
  assert.equal(progress.find((event) => event.phase === 'planning' && event.resumed)?.completed, 2)
  assert.equal(progress.at(-1)?.phase, 'complete')
})

test('edits a moving assembly while reusing geometry of unchanged components', async () => {
  const existing = {
    schemaVersion: '4.0', units: 'mm', partId: 'small_motor', components: [
      { id: 'housing', position: zero, steps: box('housing').spec.steps },
      { id: 'rotor', position: zero, steps: box('rotor').spec.steps,
        motion: { kind: 'rotary', axis: 'x', minimum: 0, maximum: 360, value: 0 } },
    ],
  } as const
  const provider = new MockLLMProvider([{ decision: 'create', partId: 'small_motor', question: '', assumptions: [], components: [
    { id: 'housing', action: 'keep', description: 'Unchanged housing.', position: zero, motion: fixed },
    { id: 'rotor', action: 'keep', description: 'Same rotor at 90 degrees.', position: zero,
      motion: { ...rotary, value: 90 } },
  ] }])
  const result = await generateCadAssembly(provider, 'Gire o rotor até 90 graus', async () => null, async () => null, existing as never)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.equal(result.spec.components[1].motion?.value, 90)
  assert.deepEqual(result.spec.components[0].steps, existing.components[0].steps)
  assert.equal(provider.calls.length, 1)
})

test('does not silently delete an assembly component during an edit', async () => {
  const existing = { schemaVersion: '4.0', units: 'mm', partId: 'drive', components: [
    { id: 'housing', position: zero, steps: box('housing').spec.steps },
    { id: 'shaft', position: zero, steps: box('shaft').spec.steps },
    { id: 'cover', position: zero, steps: box('cover').spec.steps },
  ] } as const
  const plan = { decision: 'create', partId: 'drive', question: '', assumptions: [], components: [
    { id: 'housing', action: 'keep', description: 'Housing', position: zero, motion: fixed },
    { id: 'shaft', action: 'keep', description: 'Shaft', position: zero, motion: fixed },
  ] }
  for (const request of ['Aumente o curso', 'Aumente o curso sem remover componentes', 'Não remova a tampa', 'Keep the cover; never delete it']) {
    await assert.rejects(generateCadAssembly(new MockLLMProvider([plan]), request, async () => null, undefined, existing as never), /removeu um componente/)
  }
})

test('repairs a component interference using the generic assembly plan', async () => {
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'mechanism', question: '', assumptions: [], components: [
      { id: 'frame', action: 'build', description: 'Fixed frame.', position: zero, motion: fixed },
      { id: 'moving_part', action: 'build', description: 'Separate moving body.', position: zero, motion: rotary },
    ] },
    box('frame'), box('moving_part'),
    { decision: 'create', partId: 'mechanism', question: '', assumptions: [], components: [
      { id: 'frame', action: 'keep', description: 'Unchanged frame.', position: zero, motion: fixed },
      { id: 'moving_part', action: 'keep', description: 'Move clear of the frame.', position: { x: 40, y: 0, z: 0 }, motion: rotary },
    ] },
  ])
  const progress: CadAssemblyProgress[] = []
  const result = await generateCadAssembly(provider, 'Crie um mecanismo', async () => null,
    async (spec) => spec.components[1].position.x < 30 ? 'CAD components frame and moving_part intersect' : null,
    undefined, (event) => progress.push(event))
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.equal(result.spec.components[1].position.x, 40)
  assert.equal(provider.calls.length, 4)
  assert.match(provider.calls[3].messages[1].content, /intersect/)
  assert.ok(progress.some((event) => event.phase === 'repairing-assembly' && event.completed === 2))
  assert.ok(progress.some((event) => event.phase === 'planning' && event.replanning))
  assert.equal(progress.at(-1)?.phase, 'complete')
})

test('opens a validated clearance through a housing around a fixed cylindrical body', async () => {
  const housing = { ...box('carcaca'), spec: { ...box('carcaca').spec, steps: [
    { ...box('carcaca').spec.steps[0], width: 100, depth: 100, height: 100 },
  ] } }
  const stator = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'estator', steps: [
      { id: 'core', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 80, height: 80 },
    ],
  } }
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
      { id: 'carcaca', action: 'build', description: 'Outer housing.', position: zero, motion: fixed },
      { id: 'estator', action: 'build', description: 'Fixed cylindrical stator.', position: zero, motion: fixed },
    ] }, housing, stator,
  ])
  const message = 'CAD components carcaca and estator intersect at posição atual'
  const collision: CadAssemblyIssue = { message, collisions: [{ components: ['carcaca', 'estator'], pose: 'current', message,
    overlapVolumeMm3: 402123.86, componentVolumesMm3: [1000000, 402123.86],
    overlapBoundsMm: { x: [-40, 40], y: [-40, 40], z: [-40, 40] },
    componentBoundsMm: [{ x: [-50, 50], y: [-50, 50], z: [-50, 50] }, { x: [-40, 40], y: [-40, 40], z: [-40, 40] }] }] }
  const result = await generateCadAssembly(provider, 'Crie um motor elétrico', async () => null,
    async (spec) => spec.components[0].steps.some((step) => step.id === 'assembly_fit_1') ? null : collision)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  const cut = result.spec.components[0].steps.find((step) => step.id === 'assembly_fit_1')
  assert.equal(cut?.shape, 'cylinder')
  if (cut?.shape === 'cylinder') {
    assert.equal(cut.diameter, 80.4)
    assert.equal(cut.height, 102)
  }
  assert.equal(provider.calls.length, 3)
  assert.match(provider.calls[2].messages[1].content, /Previously validated components/)
})

test('enlarges an existing undersized bore for a small assembly interference', async () => {
  const housing = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'carcaca', steps: [
      { id: 'shell', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 100, height: 100 },
      { id: 'bore', op: 'cut', shape: 'cylinder', position: zero, rotation: zero, diameter: 77, height: 102 },
    ],
  } }
  const stator = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'estator', steps: [
      { id: 'core', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 80, height: 80 },
    ],
  } }
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
      { id: 'carcaca', action: 'build', description: 'Housing with cylindrical bore.', position: zero, motion: fixed },
      { id: 'estator', action: 'build', description: 'Cylindrical inner body.', position: zero, motion: fixed },
    ] }, housing, stator,
  ])
  const message = 'CAD components carcaca and estator intersect at posição atual'
  const collision: CadAssemblyIssue = { message, collisions: [{ components: ['carcaca', 'estator'], pose: 'current', message,
    overlapVolumeMm3: 29593.8, componentVolumesMm3: [319735.59, 402123.86],
    overlapBoundsMm: { x: [-40, 40], y: [-40, 40], z: [-40, 40] },
    componentBoundsMm: [{ x: [-50, 50], y: [-50, 50], z: [-50, 50] }, { x: [-40, 40], y: [-40, 40], z: [-40, 40] }] }] }
  const progress: CadAssemblyProgress[] = []
  const result = await generateCadAssembly(provider, 'Crie um motor', async () => null,
    async (spec) => {
      const bore = spec.components[0].steps[1]
      return bore.shape === 'cylinder' && bore.diameter >= 80.4 ? null : collision
    }, undefined, (event) => progress.push(event))
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  const bore = result.spec.components[0].steps[1]
  assert.equal(bore.shape, 'cylinder')
  if (bore.shape === 'cylinder') assert.equal(bore.diameter, 80.4)
  assert.equal(provider.calls.length, 3)
  assert.ok(progress.some((event) => event.phase === 'repairing-assembly' && event.validationAttempt === 2))
  assert.equal(progress.at(-1)?.phase, 'complete')
})

test('opens a bounded local relief on the cavity owner for a wide thin overlap', async () => {
  const housing = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'carcaca', steps: [
      { id: 'shell', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 100, height: 100 },
      { id: 'bore', op: 'cut', shape: 'cylinder', position: zero, rotation: zero, diameter: 70, height: 102 },
    ],
  } }
  const stator = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'estator', steps: [
      { id: 'core', op: 'base', shape: 'box', position: zero, rotation: zero, width: 90, depth: 40, height: 10 },
    ],
  } }
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
      { id: 'carcaca', action: 'build', description: 'Housing with cavity.', position: zero, motion: fixed },
      { id: 'estator', action: 'build', description: 'Separate internal core.', position: zero, motion: fixed },
    ] }, housing, stator,
  ])
  const collision = 'CAD components carcaca and estator intersect at posição atual by 16594.91 mm³; component volumes: carcaca=346001.50, estator=485733.05 mm³; overlap fractions: carcaca=0.0480, estator=0.0342; overlap bounds: x=[-47.00, 41.80], y=[-50.00, -7.50], z=[-4.64, 5.36]; add a clearance or reduce the travel'
  const result = await generateCadAssembly(provider, 'Crie um conjunto mecânico', async () => null,
    async (spec) => spec.components[0].steps.some((step) => step.id === 'assembly_relief_1') ? null : collision,
    undefined, undefined, 1)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  const relief = result.spec.components[0].steps.find((step) => step.id === 'assembly_relief_1')
  assert.equal(relief?.shape, 'box')
  if (relief?.shape === 'box') {
    assert.equal(relief.width, 90.8)
    assert.equal(relief.depth, 44.5)
    assert.equal(relief.height, 12)
  }
  assert.equal(result.spec.components[1].steps.length, 1)
  assert.equal(provider.calls.length, 3)
})

test('seats a short end component outside the housing after assembly replanning', async () => {
  const housing = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'housing', steps: [
      { id: 'shell', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 80, height: 120 },
      { id: 'interior', op: 'cut', shape: 'cylinder', position: zero, rotation: zero, diameter: 70, height: 122 },
    ],
  } }
  const endbell = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'front_endbell', steps: [
      { id: 'cover', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 80, height: 15 },
    ],
  } }
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
      { id: 'housing', action: 'build', description: 'Hollow cylinder.', position: zero, motion: fixed },
      { id: 'front_endbell', action: 'build', description: 'Front cover.', position: { x: 0, y: 0, z: 55 }, motion: fixed },
    ] }, housing, endbell,
  ])
  const collision = 'CAD components housing and front_endbell intersect at posição atual by 14726.22 mm³; component volumes: housing=141371.67, front_endbell=75398.22 mm³; overlap fractions: housing=0.1042, front_endbell=0.1953; overlap bounds: x=[-40.00, 40.00], y=[-40.00, 40.00], z=[47.50, 60.00]; component bounds: housing x=[-40.00, 40.00], y=[-40.00, 40.00], z=[-60.00, 60.00]; front_endbell x=[-40.00, 40.00], y=[-40.00, 40.00], z=[47.50, 62.50]; add a clearance or reduce the travel'
  const result = await generateCadAssembly(provider, 'Crie um motor com tampa frontal', async () => null,
    async (spec) => spec.components[1].position.z >= 68 ? null : collision,
    undefined, undefined, 1)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.equal(result.spec.components[1].position.z, 68)
  assert.equal(result.spec.components[0].position.z, 0)
  assert.equal(provider.calls.length, 3)
})

test('seats a shallowly overlapping end cover found in a live provider run', async () => {
  const housing = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'housing', steps: [
      { id: 'shell', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 100, height: 150 },
      { id: 'interior', op: 'cut', shape: 'cylinder', position: zero, rotation: zero, diameter: 90, height: 152 },
    ],
  } }
  const cover = { decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: 'front_cover', steps: [
      { id: 'disk', op: 'base', shape: 'cylinder', position: zero, rotation: zero, diameter: 99.8, height: 12 },
    ],
  } }
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
      { id: 'housing', action: 'build', description: 'Hollow cylinder.', position: { x: 0, y: 0, z: 75 }, motion: fixed },
      { id: 'front_cover', action: 'build', description: 'External front cover.', position: { x: 0, y: 0, z: 151.5 }, motion: fixed },
    ] }, housing, cover,
  ])
  const collision = 'CAD components housing and front_cover intersect at posição atual by 6573.92 mm³; component volumes: housing=223838.48, front_cover=89696.18 mm³; overlap fractions: housing=0.0294, front_cover=0.0733; overlap bounds: x=[-49.90, 49.90], y=[-49.90, 49.90], z=[145.50, 150.00]; component bounds: housing x=[-50.00, 50.00], y=[-50.00, 50.00], z=[0.00, 150.00]; front_cover x=[-49.90, 49.90], y=[-49.90, 49.90], z=[145.50, 157.50]; add a clearance or reduce the travel'
  const result = await generateCadAssembly(provider, 'Crie um motor simples', async () => null,
    async (spec) => spec.components[1].position.z >= 156.5 ? null : collision,
    undefined, undefined, 1)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.equal(result.spec.components[1].position.z, 156.5)
  assert.equal(provider.calls.length, 3)
})

test('retains all built components after final validation fails so the same request can resume', async () => {
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'mechanism', question: '', assumptions: [], components: [
      { id: 'frame', action: 'build', description: 'Fixed frame.', position: zero, motion: fixed },
      { id: 'core', action: 'build', description: 'Separate core.', position: zero, motion: fixed },
    ] }, box('frame'), box('core'),
  ])
  let checks = 0
  const inspect = async () => ++checks === 1 ? 'CAD components frame and core intersect at posição atual by 5.00 mm³' : null
  await assert.rejects(generateCadAssembly(provider, 'Crie um mecanismo', async () => null,
    inspect, undefined, undefined, 1), (error: unknown) => {
    assert.ok(error instanceof CadAssemblyValidationError)
    assert.deepEqual(error.spec.components.map((component) => component.id), ['frame', 'core'])
    return true
  })
  assert.equal(provider.calls.length, 3)
  const progress: CadAssemblyProgress[] = []
  const resumed = await generateCadAssembly(provider, 'Crie um mecanismo', async () => null,
    inspect, undefined, (event) => progress.push(event), 1)
  assert.equal(resumed.kind, 'create')
  assert.equal(provider.calls.length, 3)
  assert.equal(progress[0].resumed, true)
  assert.equal(progress[0].completed, 2)
  assert.equal(progress.at(-1)?.phase, 'complete')
})

test('repairs the enclosing body with the model when a local clearance cannot be verified', async () => {
  const correctedHousing = { ...box('carcaca'), spec: { ...box('carcaca').spec, steps: [
    box('carcaca').spec.steps[0],
    { id: 'core_clearance', op: 'cut', shape: 'cylinder', position: zero, rotation: zero, diameter: 26, height: 32 },
  ] } }
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'motor', question: '', assumptions: [], components: [
      { id: 'carcaca', action: 'build', description: 'Outer housing.', position: zero, motion: fixed },
      { id: 'estator', action: 'build', description: 'Separate rectangular core.', position: zero, motion: fixed },
    ] }, box('carcaca'), box('estator'), correctedHousing,
  ])
  const collision = 'CAD components carcaca and estator intersect at posição atual by 20000.00 mm³; component volumes: carcaca=30000.00, estator=20000.00 mm³; overlap fractions: carcaca=0.6667, estator=1.0000; add a clearance or reduce the travel'
  const result = await generateCadAssembly(provider, 'Crie um motor', async () => null,
    async (spec) => spec.components[0].steps.some((step) => step.id === 'core_clearance') ? null : collision)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.equal(result.spec.components[0].steps[1].id, 'core_clearance')
  assert.equal(provider.calls.length, 4)
  assert.match(provider.calls[3].messages[1].content, /Edit ONLY component carcaca/)
})

test('replans a disconnected union as separate physical components', async () => {
  const joined = { ...box('rotor_with_shaft'), spec: { ...box('rotor_with_shaft').spec, steps: [
    box('rotor_with_shaft').spec.steps[0],
    { id: 'shaft', op: 'union', shape: 'cylinder', position: zero, rotation: zero, diameter: 10, height: 60 },
  ] } }
  const firstPlan = { decision: 'create', partId: 'drive', question: '', assumptions: [], components: [
    { id: 'housing', action: 'build', description: 'Housing.', position: zero, motion: fixed },
    { id: 'rotor_with_shaft', action: 'build', description: 'Rotor and separate shaft.', position: zero, motion: rotary },
  ] }
  const revisedPlan = { decision: 'create', partId: 'drive', question: '', assumptions: [], components: [
    { id: 'housing', action: 'build', description: 'Housing.', position: zero, motion: fixed },
    { id: 'rotor', action: 'build', description: 'Rotor body.', position: zero, motion: rotary },
    { id: 'shaft', action: 'build', description: 'Separate shaft.', position: zero, motion: rotary },
  ] }
  const patch = { position: zero, rotation: zero }
  const provider = new MockLLMProvider([
    firstPlan, box('housing'), joined, patch, joined, patch, joined,
    revisedPlan, box('housing'), box('rotor'), box('shaft'),
  ])
  const result = await generateCadAssembly(provider, 'Crie um motor com eixo',
    async (spec) => spec.partId === 'rotor_with_shaft'
      ? 'CAD step shaft (union) leaves 2 separate solids; every union must overlap the part and no cut may split it'
      : null)
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.deepEqual(result.spec.components.map((component) => component.id), ['housing', 'rotor', 'shaft'])
  assert.equal(provider.calls.length, 11)
  assert.match(provider.calls[7].messages[1].content, /represente-o como outro componente/)
})

test('replans an invalid repeated feature at the component level', async () => {
  const invalidHousing = { ...box('housing'), spec: { ...box('housing').spec, steps: [
    box('housing').spec.steps[0],
    { id: 'cooling_fin', op: 'union', shape: 'box', position: zero, rotation: zero,
      width: 4, depth: 8, height: 80,
      pattern: { kind: 'circular', count: 12, axis: 'y', center: zero, sweepAngle: 360 } },
  ] } }
  const correctedHousing = { ...box('housing'), spec: { ...box('housing').spec, steps: [
    box('housing').spec.steps[0],
    { id: 'radial_fin', op: 'union', shape: 'box', position: { x: 0, y: 0, z: 15 }, rotation: zero,
      width: 4, depth: 8, height: 20,
      pattern: { kind: 'circular', count: 12, axis: 'y', center: zero, sweepAngle: 360 } },
  ] } }
  const plan = { decision: 'create', partId: 'drive', question: '', assumptions: [], components: [
    { id: 'housing', action: 'build', description: 'Housing with 12 cooling fins.', position: zero, motion: fixed },
    { id: 'rotor', action: 'build', description: 'Rotating rotor.', position: zero, motion: rotary },
  ] }
  const provider = new MockLLMProvider([
    plan,
    invalidHousing, { position: zero, rotation: zero, width: 4, depth: 8, height: 80 }, invalidHousing,
    { position: zero, rotation: zero, width: 4, depth: 8, height: 80 }, invalidHousing,
    plan, correctedHousing, box('rotor'),
  ])
  const issue = 'CAD step cooling_fin instance 7 does not change the solid; current solid bounds: x=[-40.00, 40.00], y=[-75.00, 50.00], z=[-40.00, 40.00]; tool bounds: x=[-2.00, 2.00], y=[38.00, 46.00], z=[-40.00, 40.00]; duplicates pattern instance 1'
  const result = await generateCadAssembly(provider, 'Crie um motor com aletas',
    async (candidate) => candidate.steps.some((step) => step.id === 'cooling_fin') ? issue : null, async () => null)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.equal(result.spec.components[0].steps[1].id, 'radial_fin')
  assert.match(provider.calls[6].messages[1].content, /recursos repetidos/)
})
