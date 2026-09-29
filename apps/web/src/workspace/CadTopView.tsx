import type { CadPlateInput } from '../api/client.ts'

interface CadTopViewProps {
  readonly part: CadPlateInput
}

function CadTopView({ part }: CadTopViewProps) {
  const holes = [{ x: part.holeX, y: part.holeY, diameter: part.holeDiameter }, ...(part.additionalHoles ?? [])]
  const dimensions = [part.width, part.depth, part.thickness, part.cornerChamfer ?? 0, part.cornerRadius ?? 0,
    ...holes.flatMap((hole) => [hole.x, hole.y, hole.diameter]),
    ...(part.upright ? [part.upright.height, part.upright.thickness,
      ...part.upright.holes.flatMap((hole) => [hole.x, hole.z, hole.diameter])] : []),
    ...(part.bosses ?? []).flatMap((boss) => [boss.x, boss.y, boss.diameter, boss.height])]
  const available = dimensions.every(Number.isFinite) && part.width > 0 && part.depth > 0 && part.thickness > 0
    && holes.every((hole) => hole.diameter > 0) && (!part.upright || (part.upright.height > part.thickness
      && part.upright.thickness > 0 && part.upright.holes.every((hole) => hole.diameter > 0)))
    && (part.bosses ?? []).every((boss) => boss.diameter > 0 && boss.height > 0)

  if (!available) {
    return <p className="workspace-placeholder" role="status">Enter valid dimensions to see the CAD draft.</p>
  }

  const scale = Math.min(260 / part.width, 160 / part.depth)
  const halfWidth = part.width * scale / 2
  const halfDepth = part.depth * scale / 2
  const chamfer = Math.max(0, Math.min(part.cornerChamfer ?? 0, Math.min(part.width, part.depth) / 4)) * scale
  const outline = [
    [160 - halfWidth + chamfer, 110 - halfDepth], [160 + halfWidth - chamfer, 110 - halfDepth],
    [160 + halfWidth, 110 - halfDepth + chamfer], [160 + halfWidth, 110 + halfDepth - chamfer],
    [160 + halfWidth - chamfer, 110 + halfDepth], [160 - halfWidth + chamfer, 110 + halfDepth],
    [160 - halfWidth, 110 + halfDepth - chamfer], [160 - halfWidth, 110 - halfDepth + chamfer],
  ].map(([x, y]) => `${x},${y}`).join(' ')

  const wall = part.upright
  const bossHeight = Math.max(0, ...(part.bosses ?? []).map((boss) => boss.height))
  const compositeScale = Math.min(260 / part.width, 160 / (part.thickness + bossHeight))
  const frontScale = wall ? Math.min(260 / part.width, 160 / wall.height) : 0
  const sideScale = wall ? Math.min(260 / part.depth, 160 / wall.height) : 0
  const sideOutline = wall ? [
    [30, 190], [30 + part.depth * sideScale, 190],
    [30 + part.depth * sideScale, 190 - wall.height * sideScale],
    [30 + (part.depth - wall.thickness) * sideScale, 190 - wall.height * sideScale],
    [30 + (part.depth - wall.thickness) * sideScale, 190 - part.thickness * sideScale],
    [30, 190 - part.thickness * sideScale],
  ].map(([x, y]) => `${x},${y}`).join(' ') : ''

  return <div className="cad-orthographic">
    <figure>
      <figcaption>Top · X/Y</figcaption>
      <svg viewBox="0 0 320 220" role="img" aria-label="Top view of the CAD part and base through holes">
        {part.baseKind === 'extruded_disc'
          ? <circle cx="160" cy="110" r={halfWidth} fill="#d7e6ed" stroke="#315467" strokeWidth="2" />
          : part.cornerRadius !== undefined
            ? <rect x={160 - halfWidth} y={110 - halfDepth} width={part.width * scale} height={part.depth * scale}
              rx={part.cornerRadius * scale} fill="#d7e6ed" stroke="#315467" strokeWidth="2" />
            : <polygon points={outline} fill="#d7e6ed" stroke="#315467" strokeWidth="2" />}
        {wall && <rect x={160 - halfWidth} y={110 - halfDepth} width={part.width * scale} height={wall.thickness * scale} fill="#9bb9ca" stroke="#315467" strokeWidth="1" />}
        {(part.bosses ?? []).map((boss) => <circle key={boss.id} cx={160 + boss.x * scale} cy={110 - boss.y * scale}
          r={boss.diameter * scale / 2} fill="#9bb9ca" stroke="#315467" strokeWidth="2" />)}
        {holes.map((hole, index) => <circle
          key={index}
          cx={160 + hole.x * scale}
          cy={110 - hole.y * scale}
          r={hole.diameter * scale / 2}
          fill="white" stroke="#315467" strokeWidth="2"
        />)}
        <text x="160" y="210" textAnchor="middle" fill="currentColor">{part.baseKind === 'extruded_disc' ? `Ø${part.width} mm` : `${part.width} × ${part.depth} mm`}</text>
      </svg>
    </figure>
    {wall && <figure>
      <figcaption>Front · X/Z</figcaption>
      <svg viewBox="0 0 320 220" role="img" aria-label="Front view of the upright wall and its through holes">
        <rect x={160 - part.width * frontScale / 2} y={190 - wall.height * frontScale}
          width={part.width * frontScale} height={wall.height * frontScale}
          fill="#d7e6ed" stroke="#315467" strokeWidth="2" />
        <line x1={160 - part.width * frontScale / 2} x2={160 + part.width * frontScale / 2}
          y1={190 - part.thickness * frontScale} y2={190 - part.thickness * frontScale}
          stroke="#62899c" strokeDasharray="4 4" />
        {wall.holes.map((hole) => <circle key={hole.id}
          cx={160 + hole.x * frontScale} cy={190 - hole.z * frontScale}
          r={hole.diameter * frontScale / 2} fill="white" stroke="#315467" strokeWidth="2" />)}
        <text x="160" y="210" textAnchor="middle" fill="currentColor">{part.width} × {wall.height} mm</text>
      </svg>
    </figure>}
    {part.bosses && <figure>
      <figcaption>Front · fused heights</figcaption>
      <svg viewBox="0 0 320 220" role="img" aria-label="Front view showing the base and fused cylindrical bosses">
        <rect x={160 - part.width * compositeScale / 2} y={190 - part.thickness * compositeScale}
          width={part.width * compositeScale} height={part.thickness * compositeScale}
          fill="#d7e6ed" stroke="#315467" strokeWidth="2" />
        {part.bosses.map((boss) => <rect key={boss.id}
          x={160 + (boss.x - boss.diameter / 2) * compositeScale}
          y={190 - (part.thickness + boss.height) * compositeScale}
          width={boss.diameter * compositeScale} height={boss.height * compositeScale}
          fill="#9bb9ca" stroke="#315467" strokeWidth="2" />)}
        <text x="160" y="210" textAnchor="middle" fill="currentColor">Total height {part.thickness + bossHeight} mm</text>
      </svg>
    </figure>}
    {!wall && !part.bosses && part.cornerRadius !== undefined && <figure>
      <figcaption>Side · thickness</figcaption>
      <svg viewBox="0 0 320 220" role="img" aria-label="Side view of the curved CAD part thickness">
        <rect x="30" y={110 - Math.max(4, part.thickness * Math.min(160 / part.thickness, 200 / part.depth)) / 2}
          width="260" height={Math.max(4, part.thickness * Math.min(160 / part.thickness, 200 / part.depth))}
          fill="#d7e6ed" stroke="#315467" strokeWidth="2" />
        <text x="160" y="210" textAnchor="middle" fill="currentColor">Thickness {part.thickness} mm</text>
      </svg>
    </figure>}
    {wall && <figure>
      <figcaption>Side · Y/Z</figcaption>
      <svg viewBox="0 0 320 220" role="img" aria-label="Side view showing the fused L-shaped cross section">
        <polygon points={sideOutline} fill="#d7e6ed" stroke="#315467" strokeWidth="2" />
        <text x="160" y="210" textAnchor="middle" fill="currentColor">{part.depth} × {wall.height} mm</text>
      </svg>
    </figure>}
  </div>
}

export default CadTopView
