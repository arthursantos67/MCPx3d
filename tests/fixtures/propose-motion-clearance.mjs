import { readFileSync } from 'node:fs'
import { motionClearanceStrategy } from '../../packages/agent/src/assembly-motion-clearance.ts'

const { spec, collision } = JSON.parse(readFileSync(0, 'utf8'))
const candidate = await motionClearanceStrategy.propose(spec, '', async () => null, async () => null, collision)
process.stdout.write(JSON.stringify(candidate))
