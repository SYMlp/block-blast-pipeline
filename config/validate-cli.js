// CLI wrapper around validate.js — the schema gate as a callable step.
// `node config/validate-cli.js <variant.json>` → exit 0 (ok) / 1 (invalid).
// Used by build_variants.py to gate AI-generated configs before the sim.
import { readFileSync } from 'node:fs';
import { validate } from './validate.js';

const path = process.argv[2];
if (!path) { console.error('usage: node config/validate-cli.js <variant.json>'); process.exit(2); }

let cfg;
try {
  cfg = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`not valid JSON: ${e.message}`);
  process.exit(1);
}

const { ok, errors } = validate(cfg);
if (!ok) {
  console.error('schema FAILED:\n' + JSON.stringify(errors, null, 2));
  process.exit(1);
}
console.log('schema OK');
process.exit(0);
