import type { Engagement } from '@/lib/engagements';
import type { TargetOSChoice } from '@/lib/target-os';
import type { TechTag } from '@/lib/tech-tags';
import {
  EMPTY_INFRA_MAP,
  normalizeInfraMap,
  type InfraMap,
} from '@/lib/playbook/infra';

/**
 * Portable snapshot of the user\'s entire playbook session — every
 * piece of state the UI persists to localStorage, packaged as a
 * single JSON document the user can download, share, restore, or
 * compare. The static-site constraint means the API can\'t hold
 * per-user state, so this is the bridge: the frontend emits its
 * session as a snapshot, and the same parser can reload one.
 *
 * Distinct from the Markdown cheatsheet (which is a human-facing
 * "what to run" artifact) — this is the machine-facing "what was
 * configured + done" record. Pair with `/api/methodology.json` for
 * the full picture: catalog (server-side, static) + session
 * (client-side, this file).
 *
 * Schema versioned independently from the catalog. Bump
 * `SESSION_SCHEMA_VERSION` on any breaking field rename or removal;
 * the parser refuses anything newer than it knows how to handle and
 * silently drops fields it doesn\'t recognise from older snapshots.
 */

export const SESSION_SCHEMA_VERSION = '1';

/** The on-disk shape. Fields use the same names as `PlaybookState` so
 *  consumers eyeballing the JSON map directly to what the UI shows. */
export type SessionSnapshot = {
  /** Snapshot schema version. Bump on breaking changes. */
  schema_version: string;
  /** ISO-8601 timestamp of when the snapshot was generated. */
  generated: string;
  /** Catalog version the session was made against — pulled from the
   *  matching field on `/api/methodology.json`. Lets a future
   *  consumer flag "this session was captured against catalog v0,
   *  but you\'re looking at v2; some step ids may no longer exist." */
  catalog_version: string | null;
  /** The three filter axes. */
  engagement: Engagement | null;
  target_os: TargetOSChoice | null;
  tech_tags: TechTag[];
  /** User-supplied input. */
  target: string;
  versions: Record<string, string>;
  scratch_values: Record<string, string>;
  /** Per-item completion split by kind. Step-level "done" was
   *  removed in v1.x — pentesting isn\'t linear, "complete"
   *  was a fiction. The honest signal is now per-command "ran"
   *  attribution + per-step "visited" history (below). For
   *  back-compat we still parse `progress.steps` from older
   *  snapshots and fold them into `visited_steps` on import. */
  progress: {
    /** Now always emitted as `[]` — kept in the shape for
     *  schema_version=1 backwards compat. New writers don\'t
     *  populate it; new readers ignore it. */
    steps: string[];
    commands: string[];
    prechecks: string[];
  };
  /** Step ids the user has navigated to at least once.
   *  Auto-tracked client-side; replaces the step-completion
   *  fiction. Older snapshots can lack this field; the parser
   *  recovers it from the legacy `progress.steps` array. */
  visited_steps: string[];
  /** User-built infrastructure attack graph. See infra.ts. */
  infra_map: InfraMap;
  /** On-demand AI generations made during this session, newest
   *  first. Optional in older snapshots (added 2026-04-29);
   *  parser tolerates absence. Sharing a snapshot with
   *  generations carries the AI output to the receiver — this
   *  is by design (the receiver gets the same engagement state,
   *  including any "we generated this for tomcat" content). The
   *  snapshot does NOT include BYOK profile keys, so generations
   *  travel with their text but the receiver still needs their
   *  own AI key to make new ones. */
  ai_generations?: import('./ai-generate').GeneratedAssistance[];
};

/** Build a snapshot from the live PlaybookState. Does NOT touch the
 *  state — pure read. */
export function buildSessionSnapshot(args: {
  catalogVersion: string | null;
  engagement: Engagement | null;
  targetOS: TargetOSChoice | null;
  techTags: TechTag[];
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  progress: Set<string>;
  visitedSteps: Set<string>;
  infraMap: InfraMap;
  /** Optional — AI-generated assistance entries to bundle into
   *  the snapshot. Caller passes `state.aiGenerations`; if empty
   *  / undefined the field is omitted from the output JSON. */
  aiGenerations?: import('./ai-generate').GeneratedAssistance[];
}): SessionSnapshot {
  const commands: string[] = [];
  const prechecks: string[] = [];
  for (const id of args.progress) {
    /* commandItemId / precheck formats:
       - "${slug}:precheck:${i}"
       - "${slug}:cmd:${stepIdx}:${cmdIdx}" */
    const parts = id.split(':');
    if (parts.length < 3) continue;
    switch (parts[1]) {
      case 'cmd':
        commands.push(id);
        break;
      case 'precheck':
        prechecks.push(id);
        break;
      default:
        /* Unknown kind (or legacy "step") — drop. */
        break;
    }
  }
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    generated: new Date().toISOString(),
    catalog_version: args.catalogVersion,
    engagement: args.engagement,
    target_os: args.targetOS,
    tech_tags: args.techTags,
    target: args.target,
    versions: args.versions,
    scratch_values: args.scratchValues,
    /* `steps: []` retained for schema_version=1 back-compat —
       older readers expect the field to exist. New consumers
       should look at `visited_steps` instead. */
    progress: { steps: [], commands: commands.sort(), prechecks: prechecks.sort() },
    visited_steps: [...args.visitedSteps].sort(),
    infra_map: args.infraMap,
    /* Omit when empty/undefined to keep older snapshots
       byte-identical and minimize payload for sessions that
       didn\'t use AI generation. */
    ...(args.aiGenerations && args.aiGenerations.length > 0
      ? { ai_generations: args.aiGenerations }
      : {}),
  };
}

/* =================================================== Share-via-URL */

/**
 * Encode a snapshot as a URL-safe base64 string suitable for the
 * `#s=...` URL fragment. Pairs with `decodeSnapshotFromUrl` for
 * the round-trip — paste a URL into a browser, the playbook
 * loads the snapshot. Compression isn\'t needed: a typical
 * snapshot is 3–5 KB JSON; URL-fragment limits are 32+ KB on
 * every modern browser; base64 inflates ~33%.
 *
 * Why URL fragment (not query string): fragments don\'t go to
 * the server, don\'t hit the static-export build, don\'t leak in
 * server logs. Pure client-side share affordance.
 */
export function encodeSnapshotForUrl(snapshot: SessionSnapshot): string {
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Inverse of `encodeSnapshotForUrl`. Returns the parsed snapshot
 *  or `null` on any failure (bad encoding, invalid JSON, schema
 *  mismatch). The caller can then surface a toast / silently
 *  ignore. */
export function decodeSnapshotFromUrl(
  encoded: string,
): SessionSnapshot | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (padded.length % 4)) % 4);
    const bin = atob(padded + padding);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const result = parseSessionSnapshot(json);
    return result.ok ? result.snapshot : null;
  } catch {
    return null;
  }
}

/** Default download filename for an exported session snapshot.
 *  `engagement-os-YYYYMMDDhhmm.json` so a folder of snapshots sorts
 *  by capture time. */
export function defaultSessionFilename(args: {
  engagement: Engagement | null;
  targetOS: TargetOSChoice | null;
}): string {
  const e = args.engagement ?? 'session';
  const o = args.targetOS ?? 'any';
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `playbook-session-${e}-${o}-${yyyy}${mm}${dd}${hh}${mi}.json`;
}

/** Parsed-and-validated import result. `errors` is non-fatal — the
 *  parser always returns a snapshot if any subset of the JSON looks
 *  valid. The errors list documents what was dropped so the UI can
 *  surface a soft warning. */
export type SessionImportResult =
  | { ok: false; reason: string }
  | { ok: true; snapshot: SessionSnapshot; warnings: string[] };

/** Validate and normalise a JSON string into a SessionSnapshot. The
 *  parser is intentionally lenient with extra fields (forward-
 *  compat) but strict on the schema-version handshake (refuses
 *  anything newer than it knows). */
export function parseSessionSnapshot(raw: string): SessionImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'Top-level value must be an object.' };
  }
  const obj = parsed as Record<string, unknown>;

  const declaredVersion = typeof obj.schema_version === 'string'
    ? obj.schema_version
    : null;
  if (!declaredVersion) {
    return { ok: false, reason: 'Missing `schema_version` field.' };
  }
  if (declaredVersion !== SESSION_SCHEMA_VERSION) {
    /* Future-proofing: today there\'s only "1". When we bump, this
       becomes "if newer, refuse; if older, attempt graceful upgrade." */
    return {
      ok: false,
      reason: `Snapshot is schema_version "${declaredVersion}" but this build only knows "${SESSION_SCHEMA_VERSION}".`,
    };
  }

  const warnings: string[] = [];

  const engagement = stringOrNull(obj.engagement) as Engagement | null;
  const targetOS = stringOrNull(obj.target_os) as TargetOSChoice | null;
  const target = typeof obj.target === 'string' ? obj.target : '';
  const techTags = arrayOfStrings(obj.tech_tags) as TechTag[];
  const versions = recordOfStrings(obj.versions, warnings, 'versions');
  const scratchValues = recordOfStrings(
    obj.scratch_values,
    warnings,
    'scratch_values',
  );
  const progressObj =
    obj.progress && typeof obj.progress === 'object' && !Array.isArray(obj.progress)
      ? (obj.progress as Record<string, unknown>)
      : null;
  if (!progressObj) {
    warnings.push('progress: missing or wrong shape — empty progress assumed');
  }
  const legacySteps = progressObj ? arrayOfStrings(progressObj.steps) : [];
  const commands = progressObj ? arrayOfStrings(progressObj.commands) : [];
  const prechecks = progressObj ? arrayOfStrings(progressObj.prechecks) : [];
  /* Visited-steps may be present (new snapshots) or absent
     (legacy ones — we recover from `progress.steps` in that case
     so the user\'s "I\'ve been here" history isn\'t lost across
     the model change). */
  const explicitVisited = arrayOfStrings(obj.visited_steps);
  const visitedSet = new Set([...explicitVisited, ...legacySteps]);
  const visitedSteps = [...visitedSet].sort();

  const infraMap =
    obj.infra_map !== undefined
      ? normalizeInfraMap(obj.infra_map)
      : EMPTY_INFRA_MAP;

  const snapshot: SessionSnapshot = {
    schema_version: SESSION_SCHEMA_VERSION,
    generated:
      typeof obj.generated === 'string'
        ? obj.generated
        : new Date().toISOString(),
    catalog_version: stringOrNull(obj.catalog_version),
    engagement,
    target_os: targetOS,
    tech_tags: techTags,
    target,
    versions,
    scratch_values: scratchValues,
    /* progress.steps written as `[]` going forward — visited
       lives in its own field. Legacy values were folded into
       visited_steps above. */
    progress: { steps: [], commands, prechecks },
    visited_steps: visitedSteps,
    infra_map: infraMap,
  };
  return { ok: true, snapshot, warnings };
}

/** Flatten a snapshot\'s `progress` object back into the single
 *  `Set<string>` shape that PlaybookState uses internally. */
export function progressFromSnapshot(snapshot: SessionSnapshot): Set<string> {
  const out = new Set<string>();
  for (const id of snapshot.progress.steps) out.add(id);
  for (const id of snapshot.progress.commands) out.add(id);
  for (const id of snapshot.progress.prechecks) out.add(id);
  return out;
}

/* =================================================== validators */

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function arrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function recordOfStrings(
  v: unknown,
  warnings: string[],
  fieldName: string,
): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    if (v !== undefined) {
      warnings.push(`${fieldName}: wrong shape, ignored`);
    }
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}
