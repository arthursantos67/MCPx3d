import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { unzipSync } from 'three/addons/libs/fflate.module.js'
import { searchCatalog, type ModelCatalog } from '../../src/three/sceneModelCatalog.ts'

const root=new URL('../../public/models/catalog/',import.meta.url),catalog=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as ModelCatalog
test('the catalogue contains thousands of distinct, licensed and importable models, not unavailable links',()=>{
  assert.ok(catalog.models.length>=3000)
  assert.equal(new Set(catalog.models.map(model=>model.id)).size,catalog.models.length)
  assert.ok(catalog.packs.length>=30)
  let models=0,totalBytes=0,thumbnails=0
  for(const pack of catalog.packs){
    const bytes=readFileSync(new URL(pack.file,root)),files=unzipSync(bytes)
    assert.equal(bytes.byteLength,pack.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pack.sha256)
    assert.match(new TextDecoder().decode(files['LICENSE.txt']),/CC0/)
    const entries=catalog.models.filter(model=>model.pack===pack.id)
    assert.equal(entries.length,pack.models)
    for(const model of entries){
      const data=Buffer.from(files[model.entry]);assert.equal(data.length,model.bytes)
      assert.equal(createHash('sha256').update(data).digest('hex'),model.sha256)
      const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString())
      assert.ok(!json.skins?.length&&!json.animations?.length,model.id)
      assert.ok([...json.buffers??[],...json.images??[]].every(value=>!value.uri||value.uri.startsWith('data:')),model.id)
      if(model.thumbnail){assert.ok(files[model.thumbnail]?.length);thumbnails++}
      models++
    }
    totalBytes+=bytes.length
  }
  assert.equal(models,catalog.models.length)
  assert.ok(thumbnails>models*.95,'almost all cards must have an individual original preview')
  assert.ok(totalBytes<70*1024*1024,'archives must remain economical and load on demand')
})
test('Portuguese search and pack/category filters return real matching models',()=>{
  const trees=searchCatalog(catalog,'árvore','nature-kit')
  assert.ok(trees.length>10);assert.ok(trees.every(model=>model.entry.toLowerCase().includes('tree')))
  const walls=searchCatalog(catalog,'parede','modular-dungeon-kit','Masmorras')
  assert.ok(walls.length>0);assert.ok(walls.every(model=>model.entry.includes('wall')))
  assert.equal(searchCatalog(catalog,'','nature-kit','Veículos').length,0)
})
