import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cadShapeForRequest } from '../../src/workspace/cadPlateDraft.ts'

test('explicit L bracket requests select the fused bracket generator', () => {
  assert.equal(cadShapeForRequest('Crie um suporte em L com quatro furos', 'plate'), 'bracket')
  assert.equal(cadShapeForRequest('Faça uma cantoneira com dois furos na base', 'plate'), 'bracket')
  assert.equal(cadShapeForRequest('Create an L bracket with an upright wall', 'plate'), 'bracket')
  assert.equal(cadShapeForRequest('Crie uma placa com quatro furos', 'plate'), 'plate')
  assert.equal(cadShapeForRequest('Crie um suporte em L', 'bracket'), 'bracket')
})

test('round part requests select the curved CAD generators', () => {
  assert.equal(cadShapeForRequest('Crie um flange circular com furo central', 'plate'), 'flange')
  assert.equal(cadShapeForRequest('Faça uma placa com cantos arredondados', 'plate'), 'rounded_plate')
  assert.equal(cadShapeForRequest('Faça uma peça circular', 'plate'), 'flange')
  assert.equal(cadShapeForRequest('Crie um anel com furo central', 'plate'), 'flange')
  assert.equal(cadShapeForRequest('Crie uma peça cilíndrica', 'plate'), 'flange')
  assert.equal(cadShapeForRequest('Crie uma peça composta com ressalto e furo central', 'plate'), 'composite')
  assert.equal(cadShapeForRequest('Faça uma placa arredondada com flange sobre ela', 'plate'), 'composite')
  assert.equal(cadShapeForRequest('Crie uma placa normal', 'rounded_plate'), 'rounded_plate')
})
