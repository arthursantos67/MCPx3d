import { readFileSync } from 'node:fs'
import { cylindricalFitStrategy } from '../../packages/agent/src/assembly-fits.ts'

const { spec, collision } = JSON.parse(readFileSync(0, 'utf8'))
const candidate = await cylindricalFitStrategy.propose(spec, '', async () => null, async () => null, collision)
process.stdout.write(JSON.stringify(candidate))
