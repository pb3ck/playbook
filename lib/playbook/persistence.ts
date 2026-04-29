/**
 * localStorage I/O for the playbook. All reads validate the parsed JSON
 * shape before returning — anything weird gets discarded in favor of the
 * fallback. All writes are silent on quota / disabled-storage errors so
 * the rest of the app keeps working even when storage is unavailable
 * (private mode, blocked by extension, etc).
 *
 * Functions here are SSR-safe: read returns the fallback when `window` is
 * undefined; write is a no-op.
 */
import {
  EMPTY_INFRA_MAP,
  normalizeInfraMap,
  type InfraMap,
} from './infra';
import { normalizeByokProfiles, type ByokProfile } from './byok';
import {
  normalizeGenerations,
  type GeneratedAssistance,
} from './ai-generate';

/* Storage keys — the source of truth for what we persist. Centralized so
   bumping a schema version (e.g. invalidating old entries) is a single
   edit.

   The welcome/intro is intentionally NOT persisted — it opens on every
   mount of /playbook and is non-dismissable (no Esc, no backdrop click;
   the user advances by picking a phase). Re-opens via the back-arrow
   chip in the shell. See `PlaybookWelcome` and the `welcomed`/
   `dismissWelcome`/`replayWelcome` triple in `usePlaybookState`. */
export const STORAGE_KEYS = {
  recents: 'playbook-recents',
  phase: 'playbook-phase',
  engagement: 'playbook-engagement',
  progress: 'playbook-progress',
  /** Per-engagement target context (string keyed by engagement id).
   *  Stored as `{ "bug-bounty": "tesla.com", "lab": "10.10.5.x", ... }`
   *  so a user can keep distinct targets per engagement type. */
  targets: 'playbook-targets',
  /** Target OS choice — 'linux' | 'windows' | 'mixed'. Single global
   *  value (a session is targeting one kind of box at a time). */
  targetOS: 'playbook-target-os',
  /** Selected tech-stack tags (TechTag[]). Empty list = no filter. */
  techTags: 'playbook-tech-tags',
  /** Per-tag discovered versions — `Record<TechTag, string>`. A real
   *  target stack has a version per layer (apache, wordpress, mysql,
   *  …); commands resolve `{version}` against their own techApplies
   *  tag. Empty entries fall back to the `<version>` placeholder. */
  versions: 'playbook-versions',
  /** Free-form scratch values for ad-hoc interpolation tokens. Keyed
   *  by token name (e.g. `cve`, `exploit_id`, `path`); value is the
   *  user-supplied substitution. Allows commands to thread state
   *  between steps (find an exploit ID in one step, mirror it in the
   *  next). Persisted globally. */
  scratchValues: 'playbook-scratch',
  /** User-built infrastructure attack graph — hosts / services /
   *  findings / credentials with positions + ATT&CK pins. See
   *  `lib/playbook/infra.ts` for the shape. */
  infraMap: 'playbook-infra-map',
  /** "First-run tour seen" flag. Single boolean; once flipped to
   *  `true` the welcome modal stops showing the 3-card mini-tour.
   *  Distinct from the per-mount welcome flag (which always
   *  re-shows the modal itself). */
  tourSeen: 'playbook-tour-seen',
  /** Set of step ids the user has navigated to at least once.
   *  Auto-tracked when StepCard mounts. Replaces the old
   *  per-step completion flag in `progress` — pentesting isn\'t
   *  linear, "done" was a fiction; "I have / haven\'t looked at
   *  this" is the honest signal. */
  visitedSteps: 'playbook-visited-steps',
  /** BYOK profiles — array of { id, name, kind, apiKey?, baseUrl?,
   *  headerName?, model?, enabled }. Two families share storage:
   *  CVE-enrichment kinds (NVD/EPSS/OSV/VulnCheck/custom) feed
   *  the BYOK CVE popover; AI-generation kinds (anthropic/openai/
   *  ollama/openai-compatible) feed the on-demand AI assistance
   *  flow. Keys live ONLY here on the user\'s device — the
   *  static-export server has no backend to forward them to. */
  byokProfiles: 'playbook-byok-profiles',
  /** Recent on-demand AI generations (capped at MAX_GENERATIONS,
   *  newest first). Each entry contains the user\'s prompt, the
   *  resulting commands + cautions, and provenance metadata
   *  (provider, model, timestamps, token counts). Persisted so a
   *  generation made earlier in the session is still there after
   *  reload — explicit "regenerate" affordance replaces; never
   *  auto-mutates. */
  aiGenerations: 'playbook-ai-generations',
} as const;

/** Cap on how many recent tool URLs we remember in the palette. */
export const RECENT_MAX = 6;

/* =============================================== generic helpers */

function safeRead<T>(key: string, fallback: T, validate: (v: unknown) => T | null): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeWrite(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / disabled */
  }
}

/* =============================================== typed loaders */

export function loadRecents(): string[] {
  return safeRead<string[]>(STORAGE_KEYS.recents, [], (v) =>
    Array.isArray(v) ? (v.filter((s): s is string => typeof s === 'string') as string[]) : null,
  );
}

/**
 * Returns the persisted phase index, or `null` if nothing valid is
 * stored. The hook clamps the result against `PHASES.length` at
 * call-site since the lib layer doesn't import the phases catalog.
 */
export function loadPhase(): number | null {
  return safeRead<number | null>(STORAGE_KEYS.phase, null, (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null,
  );
}

/**
 * Returns the persisted engagement id, or `null` if nothing valid is
 * stored. Validation is by string membership; the hook can further
 * narrow against the `Engagement` type at call-site.
 */
export function loadEngagement(): string | null {
  return safeRead<string | null>(STORAGE_KEYS.engagement, null, (v) =>
    typeof v === 'string' && v.length > 0 ? v : null,
  );
}

/** Returns the persisted target OS choice, or `null` if nothing
 *  valid is stored. Same string-membership validation pattern as the
 *  engagement loader; the hook narrows against `TargetOSChoice`. */
export function loadTargetOS(): string | null {
  return safeRead<string | null>(STORAGE_KEYS.targetOS, null, (v) =>
    typeof v === 'string' && v.length > 0 ? v : null,
  );
}

/** Returns the persisted tech-tag selection as a string array (the
 *  hook narrows the elements against `TechTag` at call-site). Empty
 *  array = no filter applied. */
export function loadTechTags(): string[] {
  return safeRead<string[]>(STORAGE_KEYS.techTags, [], (v) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : null,
  );
}

/** Returns the persisted per-tag versions map. Same validation
 *  shape as targets / scratch — string-keyed strings only. Tags
 *  whose value isn't a string are dropped, not validated against
 *  the catalog (the hook can prune stale tag ids if it wants). */
export function loadVersions(): Record<string, string> {
  return safeRead<Record<string, string>>(STORAGE_KEYS.versions, {}, (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
    }
    return out;
  });
}

/** Returns the persisted scratch-values map. Same validation shape
 *  as targets/notes — string-keyed strings only. */
export function loadScratchValues(): Record<string, string> {
  return safeRead<Record<string, string>>(STORAGE_KEYS.scratchValues, {}, (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
    }
    return out;
  });
}

/** Returns the persisted infrastructure attack graph or an empty
 *  shell. Validation goes through `normalizeInfraMap` so a corrupt
 *  storage entry can\'t crash the canvas. */
export function loadInfraMap(): InfraMap {
  return safeRead<InfraMap>(STORAGE_KEYS.infraMap, EMPTY_INFRA_MAP, (v) =>
    normalizeInfraMap(v),
  );
}

/** Returns the persisted BYOK profile list or empty array.
 *  Validation goes through `normalizeByokProfiles` so a corrupt
 *  blob can\'t crash the settings UI. Keys live ONLY in
 *  localStorage and are sent only to the configured endpoint. */
export function loadByokProfiles(): ByokProfile[] {
  return safeRead<ByokProfile[]>(STORAGE_KEYS.byokProfiles, [], (v) =>
    normalizeByokProfiles(v),
  );
}

/** Returns the persisted on-demand AI generations or empty array.
 *  Capped + tolerant via normalizeGenerations — partial older
 *  shapes drop, total list trimmed to MAX_GENERATIONS. */
export function loadAiGenerations(): GeneratedAssistance[] {
  return safeRead<GeneratedAssistance[]>(
    STORAGE_KEYS.aiGenerations,
    [],
    (v) => normalizeGenerations(v),
  );
}


/**
 * Returns the persisted progress set as a `Set<string>` (or empty if
 * nothing is stored). Stored on disk as a JSON array of item-id
 * strings — only command (`${slug}:cmd:${stepIdx}:${cmdIdx}`) and
 * precheck (`${slug}:precheck:${i}`) ids. Step ids no longer go
 * here; they live in `visitedSteps`.
 *
 * Migration: any legacy `${slug}:step:${i}` entries from older
 * builds are silently dropped here and recovered as `visitedSteps`
 * by the consumer (it loads both and merges step ids into the
 * visited set).
 */
export function loadProgress(): Set<string> {
  return safeRead<Set<string>>(STORAGE_KEYS.progress, new Set(), (v) => {
    if (!Array.isArray(v)) return null;
    const out = new Set<string>();
    for (const id of v) {
      if (typeof id !== 'string') continue;
      /* Drop legacy step ids — they don\'t belong in progress
         anymore. The hook also reads them on first load and
         folds them into visitedSteps so the user\'s history
         isn\'t lost. */
      if (id.includes(':step:')) continue;
      out.add(id);
    }
    return out;
  });
}

/** Returns the persisted visited-step set. Plus, as a one-time
 *  migration, fold in any legacy `:step:` ids that were stored
 *  in the old progress array — that\'s where step "completion"
 *  used to live, and the user\'s "where I\'ve been" history is
 *  worth preserving even after the model change. */
export function loadVisitedSteps(): Set<string> {
  const fresh = safeRead<Set<string>>(
    STORAGE_KEYS.visitedSteps,
    new Set(),
    (v) =>
      Array.isArray(v)
        ? new Set(v.filter((s): s is string => typeof s === 'string'))
        : null,
  );
  /* Salvage legacy step ids from the old progress array. */
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.progress);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id !== 'string') continue;
            if (id.includes(':step:')) fresh.add(id);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return fresh;
}

/** Returns the per-engagement target map. Validates that every entry
 *  is a string-keyed-string before accepting; empties become an empty
 *  object. */
export function loadTargets(): Record<string, string> {
  return safeRead<Record<string, string>>(STORAGE_KEYS.targets, {}, (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
    }
    return out;
  });
}

