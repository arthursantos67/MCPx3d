export function staticGlb(options: { animated?: boolean; external?: boolean } = {}): Buffer {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0, 0, 0, 0.5])
  const indices = new Uint16Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3])
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)])
  const source = { asset: { version: '2.0' }, buffers: [{ byteLength: binary.length, ...(options.external ? { uri: 'https://external.test/buffer.bin' } : {}) }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0.5] }, { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' }],
    materials: [{ alphaMode: 'BLEND', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.7, 0.4, 0.2, 0.65], metallicFactor: 0.8, roughnessFactor: 0.2 } }],
    meshes: [{ name: 'Cabine', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], nodes: [{ mesh: 0, name: 'Cabine', translation: [2, 1, 0] }], scenes: [{ nodes: [0] }], scene: 0,
    ...(options.animated ? { animations: [{ name: 'Unsupported' }] } : {}) }
  const json = Buffer.from(JSON.stringify(source)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32)
  json.copy(padded)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + binary.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, padded, binaryHeader, binary])
}
