import assert from 'node:assert/strict'
import { test } from 'node:test'

import { artifactFilename, normalizeProjectName } from '../../src/workspace/projectName.ts'

test('normalizes project names for safe download filenames', () => {
  assert.equal(normalizeProjectName('  Mesa de João / final  '), 'mesa-de-joao-final')
  assert.equal(artifactFilename('Mesa de João / final', 7, 'x3d'), 'mesa-de-joao-final-r0007.x3d')
})

test('uses a stable fallback when a name has no filename-safe characters', () => {
  assert.equal(normalizeProjectName('---'), 'model')
})
