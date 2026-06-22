// ConfigLoader — browser runtime loader. ZERO dependencies on purpose:
// the demo must open with no network beyond the static files (no CDN, no ajv).
// Schema validation is a Node-side pipeline gate (see config/validate.js +
// harness/unit), enforced where AI generates new configs — not at runtime.

// Browser entry: fetch ./config/variants/<id>.json, fall back to control.
export async function loadVariant(variantId) {
  const id = variantId || 'control';
  try {
    const res = await fetch(`./config/variants/${id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[ConfigLoader] failed to load "${id}" (${err.message}); falling back to control`);
    const res = await fetch('./config/variants/control.json');
    return await res.json();
  }

  // --- Production remote-config override hook (left commented on purpose) ---
  // In production the same engine would pull live overrides from Firebase
  // Remote Config (hash(expId+installId) bucketing) without shipping a new
  // build: fetch activated values, shallow-merge over the local JSON, start.
  //
  // import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
  // const remote = getRemoteConfig();
  // await fetchAndActivate(remote);
  // const override = JSON.parse(getValue(remote, `variant_${id}`).asString() || '{}');
  // config = { ...config, ...override };
}
