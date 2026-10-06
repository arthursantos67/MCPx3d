export const CAD_FEATURES = {
  box: { label: 'Bloco', fields: ['width', 'depth', 'height'], schema: 'BoxStep', mode: 'primitive' },
  cylinder: { label: 'Cilindro', fields: ['diameter', 'height'], schema: 'CylinderStep', mode: 'primitive' },
  sphere: { label: 'Esfera', fields: ['diameter'], schema: 'SphereStep', mode: 'primitive' },
  cone: { label: 'Cone', fields: ['bottomDiameter', 'topDiameter', 'height'], schema: 'ConeStep', mode: 'primitive' },
  polygon_prism: { label: 'Perfil extrudado', fields: ['points', 'height'], schema: 'PolygonStep', mode: 'primitive' },
  revolve_profile: { label: 'Perfil de revolução', fields: ['points'], schema: 'RevolveStep', mode: 'primitive' },
  tube: { label: 'Tubo', fields: ['diameter', 'innerDiameter', 'height'], schema: 'TubeStep', mode: 'primitive' },
  torus: { label: 'Toro / anel', fields: ['majorRadius', 'minorRadius'], schema: 'TorusStep', mode: 'primitive' },
  slot: { label: 'Rasgo arredondado', fields: ['length', 'width', 'height'], schema: 'SlotStep', mode: 'primitive' },
  hole: { label: 'Furo com acabamento', fields: ['diameter', 'height', 'holeType', 'headDiameter', 'headDepth'], schema: 'HoleStep', mode: 'cut' },
  thread: { label: 'Rosca helicoidal', fields: ['diameter', 'pitch', 'height', 'profile', 'handedness', 'clearance', 'starts'], schema: 'ThreadStep', mode: 'primitive' },
  loft: { label: 'Transição por seções', fields: ['sections', 'ruled'], schema: 'LoftStep', mode: 'primitive' },
  fillet: { label: 'Arredondamento', fields: ['selector', 'radius'], schema: 'FilletStep', mode: 'modifier' },
  chamfer: { label: 'Chanfro', fields: ['selector', 'distance'], schema: 'ChamferStep', mode: 'modifier' },
  shell: { label: 'Casca / parede', fields: ['selector', 'thickness'], schema: 'ShellStep', mode: 'modifier' },
} as const

export const CAD_EDGE_SELECTORS = {
  all: 'Todas as arestas', parallel_x: 'Arestas paralelas a X', parallel_y: 'Arestas paralelas a Y',
  parallel_z: 'Arestas paralelas a Z', circular: 'Arestas circulares', top: 'Topo (+Z)', bottom: 'Fundo (−Z)',
  positive_x: 'Lado +X', negative_x: 'Lado −X', positive_y: 'Lado +Y', negative_y: 'Lado −Y',
} as const

export type CadShape = keyof typeof CAD_FEATURES
export type CadEdgeSelector = keyof typeof CAD_EDGE_SELECTORS
export type CadFaceSelector = Extract<CadEdgeSelector, 'top' | 'bottom' | 'positive_x' | 'negative_x' | 'positive_y' | 'negative_y'>

export const CAD_FEATURE_GUIDANCE = [
  'tube: concentric diameter/innerDiameter and centered height; torus: majorRadius is axis-to-tube-center, minorRadius is tube radius; slot: capsule along local X, total length includes its round ends, width is end diameter, height is centered.',
  'hole: cut only. position is the ENTRY surface center, axis initially Z, cutter extends DOWN local Z by height. holeType plain uses headDiameter=0,headDepth=0; counterbore or countersink uses headDiameter>diameter, 0<headDepth<height. A 90 degree countersink has headDepth=(headDiameter-diameter)/2. Rotate the entry direction for side holes. Through height exceeds wall thickness.',
  'thread: one connected real helicoidal threaded cylinder, centered height along local Z. position is the MIDPOINT, including internal cuts; hole ENTRY positioning does not apply. base/union creates an external thread; cut creates an INTERNAL threaded hole without a prior smooth bore. Use diameter (nominal major diameter), pitch (axial spacing), height, profile metric (60 degree truncated flanks) or trapezoidal (30 degree flanks), handedness right/left, clearance=0 externally or radial clearance e.g.0.1 internally, starts=1..4. Lead=pitch*starts. Internal clearance<=pitch/4. Through internal cuts extend beyond both receiver faces (e.g.1 mm per face), centered on the receiver. Matching male/female threads need identical diameter,pitch,profile,handedness,starts and global helical phase. Roll the complete XYZ rotation frame about its actual thread axis; rotation.z alone sets phase only when the axis is global Z. Compensate an initial axial offset by +360*offset/lead for right-hand threads or -360*offset/lead for left-hand threads, including current male rotation. An external thread already includes its core. Root diameter=diameter-2*pitch*(0.613434654 for metric or 0.5 for trapezoidal). A smooth cylinder larger than this root fills the helical valleys when unioned: reduce its core only within the threaded span before adding the real thread, with a small positive Boolean overlap, preserving larger journals outside that span. These are geometric profiles without certified ISO fit classes or rounded roots. Never replace a requested real thread with a smooth cylinder or repeated torus rings. Keep height/pitch between 1 and 80; total patterned thread pitches<=160 per program.',
  'loft: 2..8 concentric XY sections in strictly ascending local z, each {kind:"circle",z,diameter} or {kind:"rectangle",z,width,depth}. Set ruled=true for straight transitions or false for smooth ones; section z values are local coordinates, not centered automatically. Omit dimensions unrelated to section kind.',
  'fillet/chamfer/shell: op=modify, position and rotation all zero, NO pattern; changes the already built solid in its component coordinates. fillet uses radius; chamfer uses distance; shell uses positive thickness for inward walls and removes selected opening faces. selector is one of all,parallel_x,parallel_y,parallel_z,circular,top,bottom,positive_x,negative_x,positive_y,negative_y; shell only accepts the six face directions. Directional edge selectors use extrema of edge centers; finish early before complex thread edges, then add holes/threads as needed. Never silently drop a failed finish; use the motor diagnostic to revise selection or an unspecified size.',
].join(' ')
