// Schema validation — Node-side only (build pipeline + harness gate).
// ajv lives here, NOT in the browser runtime: the browser ships static,
// already-valid variant JSON, so validation belongs at the generation gate
// (where AI produces new configs) — not on the player's device.

import Ajv from 'ajv';
import schema from './schema.json' with { type: 'json' };

const ajv = new Ajv({ useDefaults: true, allErrors: true });
const validateFn = ajv.compile(schema);

export function validate(config) {
  const ok = validateFn(config);
  return { ok, errors: validateFn.errors || [] };
}
