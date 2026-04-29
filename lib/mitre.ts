/**
 * MITRE ATT&CK lookup — reads the locally-bundled subset of the
 * STIX bundle written by `scripts/sync-mitre.ts`. Sourced from
 * MITRE\'s canonical CTI repo, filtered to just the techniques
 * referenced in our catalog.
 *
 * Used by:
 *   - Defense thread-back rendering (technique id → name + tactic)
 *   - The (forthcoming) AI generation orchestrator: gives the LLM
 *     a closed vocabulary of real ATT&CK ids + names so it picks
 *     from real techniques instead of inventing them
 *   - BYOK CVE popover (when CVE→technique mapping is shown)
 *
 * Why local bundle vs runtime fetch:
 *   - Static-export deploy: we don\'t have a server-side fetch
 *     budget at request time
 *   - The bundled JSON is ≤30 KB even with all our techniques —
 *     well below the threshold of "absurd"
 *   - Refresh cadence is low (techniques don\'t change often) so
 *     a build-time sync is plenty
 */

import data from '../data/mitre-techniques.json';

/* =================================================== Types */

export type MitreTechnique = {
  /** Canonical ATT&CK id, e.g. "T1558.003". Sub-techniques use
   *  the dot-notation; parent technique ids omit the suffix. */
  id: string;
  /** Human label, e.g. "Kerberoasting". */
  name: string;
  /** ATT&CK tactic phase names: "credential-access", "discovery",
   *  "lateral-movement", etc. A technique may belong to multiple
   *  tactics (rare but possible — e.g. a credential-discovery
   *  + persistence dual-use). */
  tactics: string[];
  /** First sentence of the STIX description, capped at 200
   *  characters. Just enough for a tooltip / chip subtitle. */
  shortDescription: string;
  /** Direct link to the technique\'s page on attack.mitre.org. */
  url: string;
  /** True when this is a sub-technique (e.g. T1558.003 vs the
   *  parent T1558). UI may render sub-techniques with a leading
   *  dot or other "child of" cue. */
  isSubtechnique: boolean;
};

type MitreData = {
  generated: string;
  source: string;
  referenced_count: number;
  matched_count: number;
  missing: string[];
  techniques: Record<string, MitreTechnique>;
};

const TYPED_DATA = data as MitreData;

/* =================================================== Lookups */

/** Look up a single technique by its canonical id. Returns null
 *  if the id isn\'t in the local bundle — common reasons: typo
 *  in the catalog, deprecated id, or sync hasn\'t been re-run
 *  since the catalog added a new id (run `npm run sync:mitre`). */
export function lookupTechnique(id: string): MitreTechnique | null {
  return TYPED_DATA.techniques[id.toUpperCase()] ?? null;
}

/** All bundled techniques as an array. Used by surfaces that need
 *  to enumerate (the AI generator passes this as a vocabulary;
 *  any "list techniques the catalog covers" UI). */
export function allTechniques(): MitreTechnique[] {
  return Object.values(TYPED_DATA.techniques);
}

/** Format a technique id with its name when the bundle has it
 *  ("T1558.003 — Kerberoasting"), otherwise just the id. Use
 *  this anywhere you\'d render a raw id and want the user to
 *  recognize what it means without hovering. */
export function formatTechnique(id: string): string {
  const t = lookupTechnique(id);
  return t ? `${t.id} — ${t.name}` : id;
}

/** Provenance metadata — when the local bundle was last synced,
 *  how many techniques are in it, and which catalog references
 *  the sync couldn\'t resolve (typos or deprecated ids). Surface
 *  somewhere in the dev UI eventually so we know when to re-sync. */
export function mitreSyncMetadata(): {
  generated: string;
  matchedCount: number;
  referencedCount: number;
  missing: string[];
} {
  return {
    generated: TYPED_DATA.generated,
    matchedCount: TYPED_DATA.matched_count,
    referencedCount: TYPED_DATA.referenced_count,
    missing: TYPED_DATA.missing,
  };
}
