import { CAD_EDGE_SELECTORS, CAD_FEATURES, type CadEdgeSelector } from '../../../../packages/domain/ts/src/cad-features.ts'
import type { CadLoftSection, CadProgramStep } from '../../../../packages/domain/ts/src/cad-program.ts'
import { CAD_SOCKET_SCREWS, socketScrewRecess } from '../../../../packages/domain/ts/src/cad-fasteners.ts'

const labels: Record<string, string> = { width: 'Largura', depth: 'Profundidade', height: 'Comprimento Z', diameter: 'Diâmetro',
  innerDiameter: 'Diâmetro interno', majorRadius: 'Raio central', minorRadius: 'Raio da seção', length: 'Comprimento total',
  pitch: 'Passo', clearance: 'Folga radial', starts: 'Entradas', headDiameter: 'Diâmetro do alojamento da cabeça', headDepth: 'Profundidade do alojamento da cabeça',
  radius: 'Raio', distance: 'Distância', thickness: 'Espessura', minBottomThickness: 'Fundo mínimo do furo cego',
  sides: 'Lados', acrossFlats: 'Distância entre faces', module: 'Módulo', teeth: 'Dentes', pressureAngle: 'Ângulo de pressão',
  backlash: 'Redução da espessura do dente', baseThickness: 'Espessura da base',
  meanDiameter: 'Diâmetro médio da mola', wireDiameter: 'Diâmetro do arame', turns: 'Voltas',
  bendRadius: 'Raio da linha central', bendAngle: 'Ângulo da curva' }
const nonNumeric = new Set(['points', 'sections', 'ruled', 'profile', 'handedness', 'selector', 'holeType', 'termination', 'path', 'selectionBox'])

export default function CadFeatureFields({ step, onChange }: { readonly step: CadProgramStep; readonly onChange: (patch: Partial<CadProgramStep>) => void }) {
  const values = step as unknown as Record<string, unknown>
  const sectionChange = (index: number, patch: Record<string, number>) => {
    if (step.shape === 'loft') onChange({ sections: step.sections.map((section, i) => i === index ? { ...section, ...patch } : section) })
  }
  return <>
    {CAD_FEATURES[step.shape].fields.filter((field) => !nonNumeric.has(field) && (field !== 'minBottomThickness' ||
      (step.shape === 'hole' || step.shape === 'thread') && step.termination === 'blind')).map((field) => <label className="cad-program__field" key={field}>
      {labels[field] ?? field}{['starts', 'sides', 'teeth', 'turns'].includes(field) ? '' : ['pressureAngle', 'bendAngle'].includes(field) ? ' (°)' : ' (mm)'}
      <input type="number" step={['starts', 'sides', 'teeth'].includes(field) ? 1 : 'any'} value={Number(values[field] ?? (field === 'starts' || field === 'minBottomThickness' ? 1 : field === 'pressureAngle' ? 20 : 0))}
        disabled={step.shape === 'hole' && step.holeType === 'plain' && (field === 'headDiameter' || field === 'headDepth')}
        onChange={(event) => onChange({ [field]: Number(event.target.value) } as Partial<CadProgramStep>)} />
    </label>)}
    {(step.shape === 'hole' || step.shape === 'thread' && step.op === 'cut') && <>
      <label className="cad-program__field">Terminação do furo <select value={step.termination ?? 'unspecified'}
        onChange={(event) => onChange({ termination: event.target.value as 'unspecified' | 'blind' | 'through' })}>
        <option value="unspecified">Conforme profundidade (legado)</option><option value="blind">Cego · conservar fundo</option>
        <option value="through">Passante · abertura nas duas faces</option></select></label>
      <small>A profundidade é explícita. A inspeção verifica a abertura e o fundo na geometria final.</small>
    </>}
    {step.shape === 'thread' && <>
      <label className="cad-program__field">Perfil <select value={step.profile} onChange={(event) => onChange({ profile: event.target.value as 'metric' | 'trapezoidal' })}>
        <option value="metric">Métrico 60°</option><option value="trapezoidal">Trapezoidal 30°</option></select></label>
    </>}
    {(step.shape === 'thread' || step.shape === 'helical_spring') && <>
      <label className="cad-program__field">Sentido <select value={step.handedness ?? 'right'} onChange={(event) => onChange({ handedness: event.target.value as 'right' | 'left' })}>
        <option value="right">Direita</option><option value="left">Esquerda</option></select></label>
    </>}
    {step.shape === 'sweep' && <div>
      {step.path.map((point, index) => <div className="cad-program__grid" key={index}>
        {(['x', 'y', 'z'] as const).map((axis) => <label className="cad-program__field" key={axis}>Ponto {index + 1} · {axis.toUpperCase()} (mm)
          <input type="number" step="any" value={point[axis]} onChange={(event) => onChange({
            path: step.path.map((old, i) => i === index ? { ...old, [axis]: Number(event.target.value) } : old) })} />
        </label>)}
        <button type="button" disabled={step.path.length <= 2} onClick={() => onChange({ path: step.path.filter((_, i) => i !== index) })}>Remover ponto</button>
      </div>)}
      <button type="button" disabled={step.path.length >= 16} onClick={() => onChange({ path: [...step.path, { ...step.path.at(-1)!, z: step.path.at(-1)!.z + 10 }] })}>Adicionar ponto</button>
      <small>Coordenadas locais da trajetória. Curvas apertadas e auto-interseções exigem revisão da geometria.</small>
    </div>}
    {step.shape === 'hole' && <><label className="cad-program__field">Alojamento da cabeça <select value={step.holeType} onChange={(event) => {
      const holeType = event.target.value as typeof step.holeType
      onChange({ holeType, headDiameter: holeType === 'plain' ? 0 : step.headDiameter || step.diameter * 1.8,
        headDepth: holeType === 'plain' ? 0 : holeType === 'countersink' ? ((step.headDiameter || step.diameter * 1.8) - step.diameter) / 2 : step.headDepth || step.height / 4 })
    }}><option value="plain">Sem alojamento</option><option value="counterbore">Rebaixo cilíndrico</option><option value="countersink">Escareado</option></select></label>
      <label className="cad-program__field">Preset para cabeça cilíndrica <select value="" onChange={(event) => {
        if (!event.target.value) return
        const preset = socketScrewRecess(Number(event.target.value))
        onChange({ ...preset, height: Math.max(step.height, preset.headDepth + 1) })
      }}><option value="">Personalizado</option>{CAD_SOCKET_SCREWS.map((screw) => <option key={screw.nominal} value={screw.nominal}>M{screw.nominal} · cabeça cilíndrica</option>)}</select></label>
      <small>O rebaixo é geometria real na face de entrada. Escolha o lado acessível à cabeça e conserve material abaixo do alojamento.</small>
    </>}
    {(step.shape === 'fillet' || step.shape === 'chamfer' || step.shape === 'shell') && <label className="cad-program__field">Seleção <select value={step.selector}
      onChange={(event) => onChange({ selector: event.target.value as CadEdgeSelector } as Partial<CadProgramStep>)}>
      {Object.entries(CAD_EDGE_SELECTORS).filter(([key]) => step.shape !== 'shell' || ['top', 'bottom', 'positive_x', 'negative_x', 'positive_y', 'negative_y'].includes(key))
        .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>}
    {(step.shape === 'fillet' || step.shape === 'chamfer') && <div>
      <label><input type="checkbox" checked={Boolean(step.selectionBox)} onChange={(event) => onChange({
        selectionBox: event.target.checked ? { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } } : undefined })} /> Limitar seleção por região</label>
      {step.selectionBox && <>
        {(['min', 'max'] as const).map((bound) => <div className="cad-program__grid" key={bound}>
          {(['x', 'y', 'z'] as const).map((axis) => <label className="cad-program__field" key={axis}>{bound === 'min' ? 'Mínimo' : 'Máximo'} {axis.toUpperCase()} (mm)
            <input type="number" step="any" value={step.selectionBox![bound][axis]} onChange={(event) => onChange({ selectionBox: {
              ...step.selectionBox!, [bound]: { ...step.selectionBox![bound], [axis]: Number(event.target.value) } } })} />
          </label>)}
        </div>)}
        <small>Filtra os centros das arestas selecionadas nas coordenadas da peça. Uma região sem arestas é recusada.</small>
      </>}
    </div>}
    {step.shape === 'loft' && <div>
      <label className="cad-program__field">Transição <select value={step.ruled ? 'ruled' : 'smooth'} onChange={(event) => onChange({ ruled: event.target.value === 'ruled' })}>
        <option value="ruled">Reta</option><option value="smooth">Suave</option></select></label>
      {step.sections.map((section, index) => <div key={index} className="cad-program__grid">
        <label className="cad-program__field">Seção {index + 1} <select value={section.kind} onChange={(event) => {
          const replacement: CadLoftSection = event.target.value === 'circle' ? { kind: 'circle', z: section.z, diameter: 20 }
            : { kind: 'rectangle', z: section.z, width: 20, depth: 20 }
          onChange({ sections: step.sections.map((old, i) => i === index ? replacement : old) })
        }}><option value="circle">Círculo</option><option value="rectangle">Retângulo</option></select></label>
        {(section.kind === 'circle' ? ['z', 'diameter'] : ['z', 'width', 'depth']).map((field) => <label key={field} className="cad-program__field">{labels[field] ?? 'Z local'} (mm)
          <input type="number" step="any" value={Number((section as unknown as Record<string, number>)[field])} onChange={(event) => sectionChange(index, { [field]: Number(event.target.value) })} />
        </label>)}
        <button type="button" disabled={step.sections.length <= 2} onClick={() => onChange({ sections: step.sections.filter((_, i) => i !== index) })}>Remover seção</button>
      </div>)}
      <button type="button" disabled={step.sections.length >= 8} onClick={() => onChange({ sections: [...step.sections, { kind: 'circle', z: step.sections.at(-1)!.z + 10, diameter: 20 }] })}>Adicionar seção</button>
    </div>}
  </>
}
