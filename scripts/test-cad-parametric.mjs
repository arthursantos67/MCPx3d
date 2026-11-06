import { resolve } from 'node:path'
import { root, runUv } from './runtime.mjs'

runUv(['run', 'python', '../../scripts/run-cad-tests.py', '--memory-mb', '2048', '--timeout', '240',
  'apps/api/tests/test_cad_parametric.py', 'apps/api/tests/test_cad_small_features.py', '-q'], { cwd: resolve(root, 'apps/api') })
