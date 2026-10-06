import { Ajv2020 } from 'ajv/dist/2020.js'
import programSchema from '../../schemas/cad-program.v3.schema.json' with { type: 'json' }
import assemblySchema from '../../schemas/cad-assembly.v4.schema.json' with { type: 'json' }

const ajv = new Ajv2020()
const validators = { program: ajv.compile(programSchema), assembly: ajv.compile(assemblySchema) }

export function validateCadStructure(kind: keyof typeof validators, value: unknown): void {
  const validate = validators[kind]
  if (!validate(value)) {
    const error = validate.errors?.[0]
    throw new Error(`Invalid CAD ${kind} structure: ${error?.instancePath || '/'} ${error?.message ?? 'does not match the shared schema'}`)
  }
}
