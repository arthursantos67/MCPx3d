import { useEffect, useState } from 'react'

import {
  applyCadEdit, applyCadPlan, clearActiveCadProject, createCadProject, downloadCadRevisionStep,
  inspectCadPlate, openCadProject, recentCadProjects, resumeCadProject,
  type CadInspection, type CadPlateInput, type CadProjectResponse,
} from '../api/client.ts'
import type { CadPartSpec } from '../../../../packages/domain/ts/src/cad-part.ts'
import type { CadEditOutcome } from '../../../../packages/agent/src/generate-cad-edit.ts'
import type { CadCreateOutcome } from '../../../../packages/agent/src/generate-cad-part.ts'
import type { CadPartShape } from '../../../../packages/agent/src/generate-cad-part.ts'
import { cadShapeForRequest, initialCadPart, initialCadPlate, shapeFromCadPart } from './cadPlateDraft.ts'

function inputFromSpec(spec: CadPartSpec): CadPlateInput {
  return {
    partId: spec.partId,
    width: spec.base.width,
    depth: spec.base.depth,
    thickness: spec.base.thickness,
    holeX: spec.features[0].x,
    holeY: spec.features[0].y,
    holeDiameter: spec.features[0].diameter,
    additionalHoles: spec.features.slice(1).map(({ id, x, y, diameter }) => ({ id: id ?? '', x, y, diameter })),
    cornerChamfer: spec.cornerChamfer ?? 0,
    ...(spec.schemaVersion === '2.3' ? { cornerRadius: spec.cornerRadius ?? 0, baseKind: spec.base.kind } : {}),
    ...(spec.schemaVersion === '2.4' ? { cornerRadius: spec.cornerRadius ?? 0, baseKind: spec.base.kind,
      bosses: (spec.bosses ?? []).map(({ id, x, y, diameter, height }) => ({ id, x, y, diameter, height })) } : {}),
    ...(spec.upright ? { upright: {
      height: spec.upright.height,
      thickness: spec.upright.thickness,
      holes: spec.upright.holes.map(({ id, x, z, diameter }) => ({ id, x, z, diameter })),
    } } : {}),
  }
}

interface CadPlatePanelProps {
  readonly onClose: () => void
  readonly onDraftChange: (part: CadPlateInput) => void
  readonly planEdit: (request: string, spec: CadPartSpec) => Promise<CadEditOutcome>
  readonly planCreate: (request: string, shape?: CadPartShape) => Promise<CadCreateOutcome>
  readonly agentReady: boolean
  readonly onOpenProviderSettings: () => void
}

function CadPlatePanel({ onClose, onDraftChange, planEdit, planCreate, agentReady, onOpenProviderSettings }: CadPlatePanelProps) {
  const [part, setPart] = useState<CadPlateInput>(initialCadPlate)
  const [partKind, setPartKind] = useState<CadPartShape>('plate')
  const [project, setProject] = useState<CadProjectResponse | null>(null)
  const [recent, setRecent] = useState(recentCadProjects)
  const [selectedRevision, setSelectedRevision] = useState(0)
  const [inspection, setInspection] = useState<CadInspection | null>(null)
  const [command, setCommand] = useState('')
  const [createRequest, setCreateRequest] = useState('')
  const [creationReply, setCreationReply] = useState<string | null>(null)
  const [assumptions, setAssumptions] = useState<readonly string[]>([])
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => { onDraftChange(part) }, [onDraftChange, part])

  useEffect(() => {
    let active = true
    void resumeCadProject().then((saved) => {
      if (!active) return
      if (saved) {
        setProject(saved)
        setPart(inputFromSpec(saved.spec))
        setPartKind(shapeFromCadPart(inputFromSpec(saved.spec)))
        setSelectedRevision(saved.revision)
        setInspection(saved.inspection)
      }
      setRecent(recentCadProjects())
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])

  const update = (key: keyof CadPlateInput, value: string) => {
    setPart((current) => ({ ...current, [key]: key === 'partId' ? value : Number(value),
      ...(key === 'width' && current.baseKind === 'extruded_disc' ? { depth: Number(value) } : {}) }))
    setInspection(null)
    setError(null)
    setAssumptions([])
  }

  const updateAdditionalHole = (id: string, key: 'x' | 'y' | 'diameter', value: string) => {
    setPart((current) => ({
      ...current,
      additionalHoles: (current.additionalHoles ?? []).map((hole) =>
        hole.id === id ? { ...hole, [key]: Number(value) } : hole),
    }))
    setInspection(null)
    setError(null)
    setAssumptions([])
  }

  const updateUpright = (key: 'height' | 'thickness', value: string) => {
    setPart((current) => current.upright ? { ...current, upright: { ...current.upright, [key]: Number(value) } } : current)
    setInspection(null)
    setError(null)
    setAssumptions([])
  }

  const updateUprightHole = (id: string, key: 'x' | 'z' | 'diameter', value: string) => {
    setPart((current) => current.upright ? { ...current, upright: {
      ...current.upright,
      holes: current.upright.holes.map((hole) => hole.id === id ? { ...hole, [key]: Number(value) } : hole),
    } } : current)
    setInspection(null)
    setError(null)
    setAssumptions([])
  }

  const addUprightHole = () => {
    setPart((current) => {
      if (!current.upright) return current
      const used = new Set(current.upright.holes.map((hole) => hole.id))
      let number = 1
      while (used.has(`wall_hole_${number}`)) number += 1
      return { ...current, upright: { ...current.upright, holes: [
        ...current.upright.holes, { id: `wall_hole_${number}`, x: 0, z: current.upright.height / 2, diameter: 8 },
      ] } }
    })
    setInspection(null)
    setAssumptions([])
  }

  const removeUprightHole = (id: string) => {
    setPart((current) => current.upright ? { ...current, upright: {
      ...current.upright, holes: current.upright.holes.filter((hole) => hole.id !== id),
    } } : current)
    setInspection(null)
    setAssumptions([])
  }

  const addHole = () => {
    const used = new Set(['hole_1', ...(part.additionalHoles ?? []).map((hole) => hole.id), ...(part.upright?.holes ?? []).map((hole) => hole.id)])
    let number = 2
    while (used.has(`hole_${number}`)) number += 1
    setPart((current) => ({
      ...current,
      additionalHoles: [...(current.additionalHoles ?? []), { id: `hole_${number}`, x: 0, y: 0, diameter: 8 }],
    }))
    setInspection(null)
    setAssumptions([])
  }

  const removeHole = (id: string) => {
    setPart((current) => ({ ...current, additionalHoles: (current.additionalHoles ?? []).filter((hole) => hole.id !== id) }))
    setInspection(null)
    setAssumptions([])
  }

  const updateBoss = (id: string, key: 'x' | 'y' | 'diameter' | 'height', value: string) => {
    setPart((current) => ({ ...current, bosses: current.bosses?.map((boss) =>
      boss.id === id ? { ...boss, [key]: Number(value) } : boss) }))
    setInspection(null)
    setError(null)
    setAssumptions([])
  }

  const addBoss = () => {
    setPart((current) => {
      if (!current.bosses || current.bosses.length >= 4) return current
      const used = new Set(current.bosses.map((boss) => boss.id))
      let number = 1
      while (used.has(`boss_${number}`)) number += 1
      const placements = [[current.width / 3, 0], [-current.width / 3, 0], [0, current.depth / 2 - 9]]
      const [x, y] = placements[Math.min(current.bosses.length - 1, placements.length - 1)]
      return { ...current, bosses: [...current.bosses, { id: `boss_${number}`, x, y, diameter: 16, height: 12 }] }
    })
    setInspection(null)
    setAssumptions([])
  }

  const removeBoss = (id: string) => {
    setPart((current) => ({ ...current, bosses: current.bosses?.filter((boss) => boss.id !== id) }))
    setInspection(null)
    setAssumptions([])
  }

  const savedPart = project ? inputFromSpec(project.spec) : null
  const unsavedChanges = savedPart !== null && JSON.stringify(part) !== JSON.stringify(savedPart)
  const switchProject = async (projectId: string) => {
    if (unsavedChanges && !window.confirm('Discard unsaved CAD parameter changes?')) return
    setError(null)
    if (!projectId) {
      clearActiveCadProject()
      setProject(null)
      setPart(initialCadPart(partKind))
      setSelectedRevision(0)
      setInspection(null)
      setReply(null)
      setCreationReply(null)
      setAssumptions([])
      return
    }
    setBusy(true)
    try {
      const opened = await openCadProject(projectId)
      setProject(opened)
      setPart(inputFromSpec(opened.spec))
      setPartKind(shapeFromCadPart(inputFromSpec(opened.spec)))
      setSelectedRevision(opened.revision)
      setInspection(opened.inspection)
      setReply(null)
      setCreationReply(null)
      setAssumptions([])
      setRecent(recentCadProjects())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const run = async (action: 'inspect' | 'save' | 'download' | 'chat' | 'create') => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'create' && !project) {
        const requestedShape = cadShapeForRequest(createRequest, partKind)
        if (requestedShape !== partKind) {
          setPartKind(requestedShape)
          setPart(initialCadPart(requestedShape))
        }
        const outcome = await planCreate(createRequest, requestedShape)
        if (outcome.kind === 'clarify') {
          setCreationReply(outcome.question)
        } else {
          const saved = await createCadProject(inputFromSpec(outcome.spec))
          setProject(saved)
          setPart(inputFromSpec(saved.spec))
          setPartKind(shapeFromCadPart(inputFromSpec(saved.spec)))
          setRecent(recentCadProjects())
          setSelectedRevision(saved.revision)
          setInspection(saved.inspection)
          setAssumptions(outcome.assumptions)
          setCreationReply(`Created CAD project ${saved.projectId}.`)
          setCreateRequest('')
        }
      }
      if (action === 'inspect') setInspection(await inspectCadPlate(part))
      if (action === 'save') {
        const saved = project ? await applyCadEdit(project, part) : await createCadProject(part)
        setProject(saved)
        setRecent(recentCadProjects())
        setSelectedRevision(saved.revision)
        setInspection(saved.inspection)
      }
      if (action === 'download' && project) await downloadCadRevisionStep(project, selectedRevision)
      if (action === 'chat' && project) {
        if (unsavedChanges) throw new Error('Save the current parameter fields before using CAD chat.')
        const outcome = await planEdit(command, project.spec)
        if (outcome.kind === 'clarify') {
          setReply(outcome.question)
        } else {
          const saved = await applyCadPlan(project, outcome.plan)
          setProject(saved)
          setPart(inputFromSpec(saved.spec))
          setSelectedRevision(saved.revision)
          setInspection(saved.inspection)
          setReply(`Saved CAD revision ${saved.revision}.`)
          setAssumptions([])
          setCommand('')
        }
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const numericFields: { key: 'width' | 'depth' | 'thickness' | 'holeX' | 'holeY' | 'holeDiameter'; label: string }[] = [
    { key: 'width', label: 'Width (mm)' },
    { key: 'depth', label: 'Depth (mm)' },
    { key: 'thickness', label: 'Thickness (mm)' },
    { key: 'holeX', label: 'Hole X (mm)' },
    { key: 'holeY', label: 'Hole Y (mm)' },
    { key: 'holeDiameter', label: 'Hole diameter (mm)' },
  ]

  return (
    <section className="cad-plate-panel" aria-label="CAD plate editor">
      <div className="cad-plate-panel__heading">
        <strong>{part.bosses ? 'CAD composite part' : part.upright ? 'CAD L bracket' : part.baseKind === 'extruded_disc' ? 'CAD circular flange' : part.cornerRadius !== undefined ? 'CAD rounded plate' : 'CAD mounting plate'}</strong>
        <button type="button" onClick={onClose} aria-label="Hide CAD options">×</button>
      </div>
      <p>Mechanical CAD part. Saved revisions include a validated STEP solid.</p>
      <label>
        CAD project
        <select value={project?.projectId ?? ''} disabled={busy} onChange={(event) => { void switchProject(event.target.value) }}>
          <option value="">New CAD part</option>
          {recent.map((item) => <option key={item.projectId} value={item.projectId}>{item.partId} · {item.projectId.slice(-6)}</option>)}
        </select>
      </label>
      {!project && <label>
        Part type
        <select value={partKind} disabled={busy} onChange={(event) => {
          const kind = event.target.value as CadPartShape
          setPartKind(kind)
          setPart(initialCadPart(kind))
          setInspection(null)
          setError(null)
          setCreationReply(null)
          setAssumptions([])
        }}>
          <option value="plate">Mounting plate</option>
          <option value="bracket">L bracket (base + upright)</option>
          <option value="rounded_plate">Rounded plate</option>
          <option value="flange">Circular flange</option>
          <option value="composite">Composite: base + fused cylinders</option>
        </select>
      </label>}
      {!project && <form className="cad-plate-panel__chat" onSubmit={(event) => { event.preventDefault(); void run('create') }}>
        <label>
          Create a CAD part by description
          <input value={createRequest} maxLength={1000} disabled={busy || !agentReady} placeholder={partKind === 'composite' ? 'Create a rounded plate with a raised cylindrical boss and a through bore' : partKind === 'bracket' ? 'Create an L bracket with holes in the base and upright' : partKind === 'flange' ? 'Create a circular flange with a center bore and mounting holes' : partKind === 'rounded_plate' ? 'Create a plate with 12 mm rounded corners and two holes' : 'Create a 120 × 80 mm plate with four 8 mm holes'} onChange={(event) => setCreateRequest(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !agentReady || !createRequest.trim()}>Generate and validate CAD part</button>
        {!agentReady && <button type="button" onClick={onOpenProviderSettings}>Configure AI provider</button>}
        <p>Missing dimensions may be inferred; the chosen values appear below after validation.</p>
        {creationReply && <p role="status">{creationReply}</p>}
      </form>}
      <label>
        Part ID
        <input value={part.partId} maxLength={64} disabled={!!project || busy} onChange={(event) => update('partId', event.target.value)} />
      </label>
      {part.bosses && <label>
        Composite base profile
        <select value={part.baseKind ?? 'extruded_rectangle'} disabled={busy} onChange={(event) => {
          const kind = event.target.value as 'extruded_rectangle' | 'extruded_disc'
          setPart((current) => ({ ...current, baseKind: kind,
            depth: kind === 'extruded_disc' ? current.width : current.depth,
            cornerRadius: kind === 'extruded_disc' ? 0 : Math.min(12, current.width / 4, current.depth / 4) }))
          setInspection(null)
          setError(null)
        }}>
          <option value="extruded_rectangle">Rectangular or rounded plate</option>
          <option value="extruded_disc">Circular disc</option>
        </select>
      </label>}
      <div className="cad-plate-panel__fields">
        {numericFields.filter(({ key }) => !(key === 'depth' && part.baseKind === 'extruded_disc')).map(({ key, label }) => (
          <label key={key}>
            {key === 'width' && part.baseKind === 'extruded_disc' ? 'Outside diameter (mm)' : label}
            <input type="number" step="any" value={part[key]} disabled={busy} onChange={(event) => update(key, event.target.value)} />
          </label>
        ))}
        {part.cornerRadius !== undefined && part.baseKind === 'extruded_rectangle' && <label>
          Corner radius (mm)
          <input type="number" min={part.bosses ? '0' : '0.1'} step="any" value={part.cornerRadius} disabled={busy} onChange={(event) => update('cornerRadius', event.target.value)} />
        </label>}
        {!part.upright && part.cornerRadius === undefined && <label>
          Corner chamfer (mm)
          <input type="number" min="0" step="any" value={part.cornerChamfer ?? 0} disabled={busy} onChange={(event) => update('cornerChamfer', event.target.value)} />
        </label>}
      </div>
      {part.upright && <div className="cad-plate-panel__upright">
        <strong>Upright wall at rear edge</strong>
        <div className="cad-plate-panel__fields">
          <label>Height from base bottom (mm)
            <input type="number" step="any" value={part.upright.height} disabled={busy} onChange={(event) => updateUpright('height', event.target.value)} />
          </label>
          <label>Wall thickness (mm)
            <input type="number" step="any" value={part.upright.thickness} disabled={busy} onChange={(event) => updateUpright('thickness', event.target.value)} />
          </label>
        </div>
        <strong>Upright through holes</strong>
        {part.upright.holes.map((hole) => <div key={hole.id} className="cad-plate-panel__fields">
          <span>{hole.id}</span>
          {(['x', 'z', 'diameter'] as const).map((key) => <label key={key}>
            {key === 'diameter' ? 'Diameter (mm)' : `${key.toUpperCase()} (mm)`}
            <input type="number" step="any" value={hole[key]} disabled={busy} onChange={(event) => updateUprightHole(hole.id, key, event.target.value)} />
          </label>)}
          <button type="button" disabled={busy} onClick={() => removeUprightHole(hole.id)}>Remove {hole.id}</button>
        </div>)}
        <button type="button" disabled={busy || part.upright.holes.length >= 8 || 1 + (part.additionalHoles?.length ?? 0) + part.upright.holes.length >= 16} onClick={addUprightHole}>Add upright hole</button>
      </div>}
      {part.bosses && <div className="cad-plate-panel__upright">
        <strong>Fused cylindrical bosses</strong>
        <p>Each cylinder rises from the base top. Through holes cut any boss they lie fully inside.</p>
        {part.bosses.map((boss) => <div key={boss.id} className="cad-plate-panel__fields">
          <span>{boss.id}</span>
          {(['x', 'y', 'diameter', 'height'] as const).map((key) => <label key={key}>
            {key === 'diameter' ? 'Diameter (mm)' : key === 'height' ? 'Height above base (mm)' : `${key.toUpperCase()} (mm)`}
            <input type="number" step="any" value={boss[key]} disabled={busy} onChange={(event) => updateBoss(boss.id, key, event.target.value)} />
          </label>)}
          <button type="button" disabled={busy || part.bosses!.length <= 1} onClick={() => removeBoss(boss.id)}>Remove {boss.id}</button>
        </div>)}
        <button type="button" disabled={busy || part.bosses.length >= 4} onClick={addBoss}>Add fused cylinder</button>
      </div>}
      <div className="cad-plate-panel__holes">
        <strong>Additional base through holes</strong>
        {(part.additionalHoles ?? []).map((hole) => <div key={hole.id} className="cad-plate-panel__fields">
          <span>{hole.id}</span>
          {(['x', 'y', 'diameter'] as const).map((key) => <label key={key}>
            {key === 'diameter' ? 'Diameter (mm)' : `${key.toUpperCase()} (mm)`}
            <input type="number" step="any" value={hole[key]} disabled={busy} onChange={(event) => updateAdditionalHole(hole.id, key, event.target.value)} />
          </label>)}
          <button type="button" disabled={busy} onClick={() => removeHole(hole.id)}>Remove {hole.id}</button>
        </div>)}
        <button type="button" disabled={busy || 1 + (part.additionalHoles?.length ?? 0) + (part.upright?.holes.length ?? 0) >= 16} onClick={addHole}>Add base hole</button>
      </div>
      <div className="cad-plate-panel__actions">
        <button type="button" disabled={busy} onClick={() => { void run('inspect') }}>Inspect solid</button>
        <button type="button" disabled={busy} onClick={() => { void run('save') }}>{project ? 'Save revision' : 'Create CAD project'}</button>
      </div>
      {project && <div className="cad-plate-panel__history">
        <p>Saved revision {project.revision} · Project {project.projectId}</p>
        <label>
          STEP revision
          <select value={selectedRevision} disabled={busy} onChange={(event) => setSelectedRevision(Number(event.target.value))}>
            {Array.from({ length: project.revision + 1 }, (_, revision) => (
              <option key={revision} value={revision}>Revision {revision}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => { void run('download') }}>Download saved STEP</button>
      </div>}
      {assumptions.length > 0 && <div className="cad-plate-panel__assumptions" role="status">
        <strong>Values inferred by the agent</strong>
        <ul>{assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
      </div>}
      {project && creationReply && <p role="status">{creationReply}</p>}
      {project && <form className="cad-plate-panel__chat" onSubmit={(event) => { event.preventDefault(); void run('chat') }}>
        <label>
          Edit this CAD part by chat
          <input value={command} maxLength={1000} disabled={busy || !agentReady} placeholder="Set the hole diameter to 16 mm" onChange={(event) => setCommand(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !agentReady || !command.trim() || unsavedChanges}>Apply CAD request</button>
        {unsavedChanges && <p>Save the fields above before using CAD chat.</p>}
        {!agentReady && <button type="button" onClick={onOpenProviderSettings}>Configure AI provider</button>}
        {reply && <p role="status">{reply}</p>}
      </form>}
      {inspection && <p role="status">{inspection.solidCount} valid solid · {inspection.volumeMm3.toFixed(2)} mm³ · {inspection.stepBytes} STEP bytes</p>}
      {error && <p role="alert" className="cad-plate-panel__error">{error}</p>}
    </section>
  )
}

export default CadPlatePanel
