import { readFileSync } from 'node:fs'
import { threadedFitStrategy } from '../../packages/agent/src/assembly-thread-fits.ts'

const { spec, collision } = JSON.parse(readFileSync(0, 'utf8'))
const candidate = await threadedFitStrategy.propose(spec, '', async () => null, async () => null, collision)
process.stdout.write(JSON.stringify(candidate))
