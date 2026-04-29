/**
 * MITRE ATT&CK sync — fetches the canonical STIX bundle from
 * mitre/cti, extracts only the techniques referenced in this
 * repo's catalog, and writes a small local JSON.
 *
 * Why bundle a subset rather than fetch at runtime:
 *   - Static-export deploy: no server-side fetch budget at request
 *     time. Build-time data is the right shape.
 *   - The full STIX bundle is ~32 MB; we typically reference ≤80
 *     techniques. Subsetting gets us 99%+ size reduction without
 *     losing accuracy for our use cases.
 *   - The result is committed (data/mitre-techniques.json) so the
 *     app's MITRE annotations are reproducible and don't depend on
 *     network at build time either.
 *
 * Re-run this script when:
 *   - You add a new mitreTechniques entry to lib/methodology.ts
 *     (the script's referenced-set changes; previously-skipped
 *     techniques now need to land in the local file)
 *   - Quarterly-ish, to pick up MITRE's edits to existing
 *     technique descriptions / tactics
 *
 * Usage:
 *   npm run sync:mitre
 *
 * If a referenced technique id isn't in the STIX bundle (typo,
 * deprecated id), the script warns + continues. You'll see the
 * warning and either fix the catalog id or accept that it's
 * deprecated.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES } from '../lib/methodology';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const STIX_URL =
  'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json';

/* =================================================== Types */

/** Minimal STIX shape we care about — the bundle has dozens of
 *  fields per object; we only read the ones that matter for
 *  technique attribution. */
type StixObject = {
  type: string;
  name?: string;
  description?: string;
  external_references?: { source_name: string; external_id?: string; url?: string }[];
  kill_chain_phases?: { kill_chain_name: string; phase_name: string }[];
  x_mitre_is_subtechnique?: boolean;
  x_mitre_deprecated?: boolean;
  revoked?: boolean;
};

type MitreEntry = {
  id: string; // "T1558.003"
  name: string; // "Kerberoasting"
  tactics: string[]; // ["credential-access"]
  shortDescription: string; // first sentence, ≤200 chars
  url: string; // "https://attack.mitre.org/techniques/T1558/003/"
  isSubtechnique: boolean;
};

/* =================================================== Main */

async function main() {
  /* 1. Collect every technique id referenced in the catalog so we
     know what to keep. Empty Set guard: if the catalog has no
     mitreTechniques anywhere, we still write an empty bundle so
     downstream consumers don't crash on import. */
  const referenced = new Set<string>();
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      for (const cmd of step.commands ?? []) {
        for (const t of cmd.mitreTechniques ?? []) {
          referenced.add(t.toUpperCase());
        }
      }
    }
  }
  console.log(`Catalog references ${referenced.size} unique technique IDs`);

  /* 2. Fetch MITRE STIX bundle. Single ~32 MB GET — we don't
     stream it; for our use case, holding it in memory once is
     fine and keeps the script simple. */
  console.log(`Fetching ${STIX_URL}...`);
  const t0 = Date.now();
  const res = await fetch(STIX_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch STIX bundle: HTTP ${res.status} ${res.statusText}`);
  }
  const bundle = (await res.json()) as { objects: StixObject[] };
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Got ${bundle.objects.length} STIX objects in ${elapsed}s`);

  /* 3. Filter to attack-pattern objects (techniques + sub-techniques),
     skip deprecated/revoked entries, keep only ones referenced in our
     catalog. Index by external_id ("T1558.003") for the output. */
  const techniques: Record<string, MitreEntry> = {};
  for (const obj of bundle.objects) {
    if (obj.type !== 'attack-pattern') continue;
    if (obj.revoked || obj.x_mitre_deprecated) continue;
    const ref = obj.external_references?.find((r) => r.source_name === 'mitre-attack');
    if (!ref?.external_id) continue;
    const id = ref.external_id.toUpperCase();
    if (!referenced.has(id)) continue;
    techniques[id] = {
      id,
      name: obj.name ?? '(unnamed)',
      tactics: (obj.kill_chain_phases ?? [])
        .filter((k) => k.kill_chain_name === 'mitre-attack')
        .map((k) => k.phase_name),
      shortDescription: extractShort(obj.description ?? ''),
      url: ref.url ?? `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`,
      isSubtechnique: obj.x_mitre_is_subtechnique === true,
    };
  }

  /* 4. Surface ids referenced in the catalog but missing from the
     bundle. Usually these are typos or deprecated ids the catalog
     author should fix; we don't fail the script on missing ids
     because the catalog is the source of truth and we don't want
     to block the sync on one bad reference. */
  const missing = [...referenced].filter((id) => !techniques[id]);
  if (missing.length > 0) {
    console.warn(`\n⚠ ${missing.length} referenced ids missing from MITRE STIX (typo or deprecated):`);
    for (const m of missing) console.warn(`  - ${m}`);
  }

  /* 5. Write output. Keep the schema flat + obvious — this gets
     imported as JSON by lib/mitre.ts at build time, so changes
     here ripple to UI surfaces. */
  const outPath = join(REPO_ROOT, 'data', 'mitre-techniques.json');
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    generated: new Date().toISOString(),
    source: STIX_URL,
    referenced_count: referenced.size,
    matched_count: Object.keys(techniques).length,
    missing,
    techniques,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

  const sizeKb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(
    `\nWrote ${Object.keys(techniques).length} techniques to ${outPath} (${sizeKb} KB)`,
  );
}

/** Pull the first sentence out of a STIX `description` field and
 *  cap it at 200 chars. STIX descriptions are typically multi-
 *  paragraph markdown; we only render a one-liner in the UI, so
 *  trimming early keeps the bundled JSON small and prevents the
 *  full prose from leaking into snippet-shaped surfaces. */
function extractShort(desc: string): string {
  if (!desc) return '';
  /* Strip markdown citations (the STIX descs have inline
     `(Citation: Foo)` style). */
  const cleaned = desc.replace(/\(Citation:[^)]+\)/g, '').replace(/\s+/g, ' ').trim();
  /* First sentence ≈ "ends with `. ` or `.`-EOL". */
  const firstSentenceMatch = cleaned.match(/^[^.]+\./);
  const first = firstSentenceMatch ? firstSentenceMatch[0] : cleaned;
  return first.length > 200 ? first.slice(0, 197).trimEnd() + '...' : first;
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
