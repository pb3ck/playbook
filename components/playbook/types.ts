import type { Engagement } from '@/lib/engagements';
import type { TargetOSChoice } from '@/lib/target-os';
import type { TechTag } from '@/lib/tech-tags';

/**
 * Playbook state shape — engagement + phase-driven, with per-session
 * input the user can record (target, notes, skip reasons).
 *
 * The app is a single-step focus view with two top-level sections —
 * Playbook (the walkthrough) and Search (tool catalog lookup). All
 * navigation is click-driven; there are no keyboard shortcuts.
 *
 * Persisted axes:
 *   - `engagement`   — legal/contractual context (bug-bounty, private,
 *                      lab). Picked at the welcome.
 *   - `currentPhase` — where the user is in the 5-phase walk.
 *   - `progress`     — per-item completion (id strings).
 *   - `target`       — per-engagement asset string, interpolated into
 *                      command snippets.
 *   - `recents`      — recently opened tools, surfaced in the Search
 *                      section's "Recent" list.
 *
 * In-memory only:
 *   - `query`            — Search section input (URL-mirrored so a
 *                          shared link applies its query).
 *   - `focusedStepIdx`   — which step is showing in the focus view;
 *                          null = follow auto-spotlight.
 *   - `welcomed`         — intro overlay flag, re-shown on every mount.
 *   - `contentMounted`   — monotonic guard for first-paint of the body.
 */
export type PlaybookState = {
  /** SSR-hydration guard. False on the initial server render and the very
   *  first client render; true after `useEffect` mounts. Consumers render
   *  a placeholder while false to avoid hydration mismatches from
   *  localStorage-derived state. */
  mounted: boolean;

  /** Engagement type — `null` until the user picks one at the welcome.
   *  Persisted to localStorage so returning visitors keep their context. */
  engagement: Engagement | null;
  setEngagement: (e: Engagement) => void;

  /** Target OS — second filter axis alongside engagement. Picker shows
   *  in the welcome modal. `null` = not picked (welcome won't dismiss).
   *  `'mixed'` = no filter (show everything). `'linux'` / `'windows'` =
   *  hide items tagged with the other OS. */
  targetOS: TargetOSChoice | null;
  setTargetOS: (os: TargetOSChoice) => void;

  /** Tech-stack tags — third filter axis. Multi-select via the
   *  context panel inside the focus view. Empty = no filter applied
   *  (everything visible). Persisted globally. */
  selectedTechTags: TechTag[];
  toggleTechTag: (tag: TechTag) => void;
  clearTechTags: () => void;

  /** Per-item completion. Holds command ids
   *  (`${phaseSlug}:cmd:${stepIdx}:${cmdIdx}`) and precheck ids
   *  (`${phaseSlug}:precheck:${i}`). Step "completion" is gone —
   *  pentesting isn\'t linear, "done" was a fiction; the visited
   *  set below carries the honest "I\'ve been here" signal
   *  instead. */
  progress: Set<string>;
  toggleProgress: (id: string) => void;
  /** Nuclear reset — wipe every persisted + in-memory playbook bit
   *  (progress, visited, targets, recents, engagement, current
   *  phase, query, focused step). Engagement becomes `null`, so the
   *  welcome modal stays open until the user re-picks. */
  resetAllPlaybookData: () => void;
  isComplete: (id: string) => boolean;

  /** Set of step ids the user has navigated to at least once.
   *  Auto-populated when the focus view renders a step. Drives
   *  the step-strip dot styling (visited vs unvisited) + the
   *  per-phase activity counts. Persisted. */
  visitedSteps: Set<string>;
  markVisited: (stepId: string) => void;
  isVisited: (stepId: string) => boolean;

  /** Search query for the Search section. URL-mirrored. */
  query: string;
  setQuery: (q: string) => void;

  /** Current phase index (0..PHASES.length-1). Persisted + URL. */
  currentPhase: number;
  setPhase: (i: number) => void;

  /** Target context — the asset the user is working against. Persisted
   *  per-engagement. Interpolated into command snippets via `{target}`. */
  target: string;
  setTarget: (value: string) => void;

  /** Per-tag discovered versions — e.g. `{ apache: "2.4.49",
   *  wordpress: "6.3", mysql: "8.0" }`. A target running a real
   *  stack has a version per layer, not one global "the version".
   *  Commands interpolate `{version}` against the version for their
   *  own `techApplies` tag (a wordpress-tagged command resolves to
   *  the wordpress version, not the apache one). Tags with no entry
   *  fall back to the `<version>` placeholder. Persisted globally
   *  so versions survive phase changes. */
  versions: Record<string, string>;
  setVersion: (tag: string, value: string) => void;
  clearVersions: () => void;

  /** Free-form scratch values — keyed by interpolation token name
   *  (e.g. `cve`, `exploit_id`, `path`). The focus view auto-detects
   *  tokens used in the active step's commands via `extractTokens`
   *  and renders an editor; values flow into `interpolate(...)` as
   *  the third arg, so commands thread state between steps (find an
   *  exploit ID once, mirror it everywhere). Persisted globally —
   *  values survive phase changes so a value entered in recon can be
   *  used in exploitation. */
  scratchValues: Record<string, string>;
  setScratchValue: (key: string, value: string) => void;
  clearScratchValues: () => void;

  /** User-built infrastructure attack graph — hosts, services,
   *  findings, credentials with positions + ATT&CK pins. See
   *  `lib/playbook/infra.ts` for shape. Entirely user-driven. */
  infraMap: import('@/lib/playbook/infra').InfraMap;
  /** Replace the entire infra map atomically — used by canvas for
   *  drag-finalise + add/delete operations that touch many fields
   *  at once. Functional update form like setState. */
  setInfraMap: (
    next:
      | import('@/lib/playbook/infra').InfraMap
      | ((
          prev: import('@/lib/playbook/infra').InfraMap,
        ) => import('@/lib/playbook/infra').InfraMap),
  ) => void;

  /** Load a parsed session snapshot in a single atomic operation —
   *  every persisted field replaced, every in-memory mutator
   *  fired exactly once. Used by the session-import affordance.
   *  Anything not present in the snapshot resets to its default
   *  (so a partial snapshot doesn\'t leave stale state behind). */
  loadSnapshot: (snapshot: import('@/lib/playbook/session').SessionSnapshot) => void;

  /** Currently focused step index (visible position in current phase).
   *  null = auto-spotlight (next-uncompleted). Phase changes reset to
   *  null. Mutated by clicking step strip dots or step navigator. */
  focusedStepIdx: number | null;
  setFocusedStepIdx: (idx: number | null) => void;

  /** Per-session intro/welcome state. Default `false` (intro is open) on
   *  every fresh mount of /playbook — the intro replays on every page
   *  load. Dismissal is in-memory only. */
  welcomed: boolean;
  dismissWelcome: () => void;
  /** Re-open the intro from the engagement chip in the shell. */
  replayWelcome: () => void;
  /** Monotonic "user has dismissed the intro at least once this mount."
   *  Drives whether the playbook body mounts at all. */
  contentMounted: boolean;

  /** Recently opened tools (most recent first). Persisted. Surfaced in
   *  the Search section when the query is empty. */
  recents: string[];
  commitOpen: (url: string) => void;

  /** BYOK provider profiles — user-configured connections to
   *  external APIs. Two families share this storage:
   *    - CVE enrichment: NVD / EPSS / OSV / VulnCheck / custom
   *    - AI generation: Anthropic / OpenAI / Ollama / openai-compatible
   *  Keys live ONLY in this device\'s localStorage; the static-
   *  export server sees nothing. See `lib/playbook/byok.ts`. */
  byokProfiles: import('@/lib/playbook/byok').ByokProfile[];
  /** Replace the entire profile list. Settings UI uses functional
   *  form to add / edit / delete without races against rapid
   *  edits. */
  setByokProfiles: (
    next:
      | import('@/lib/playbook/byok').ByokProfile[]
      | ((
          prev: import('@/lib/playbook/byok').ByokProfile[],
        ) => import('@/lib/playbook/byok').ByokProfile[]),
  ) => void;

  /** On-demand AI generations created by the user via the
   *  "describe a situation" surface. Stored newest-first, capped
   *  at MAX_GENERATIONS. Each entry includes the prompt, the
   *  generated commands, and provenance metadata. Generated
   *  content is NEVER auto-merged into lib/methodology.ts — it
   *  lives only here, marked clearly in the UI as "AI-generated,
   *  not catalog material." */
  aiGenerations: import('@/lib/playbook/ai-generate').GeneratedAssistance[];
  /** Insert a fresh generation at the front of the list (and trim
   *  the tail to MAX_GENERATIONS). Replaces any earlier generation
   *  with the same id. */
  addAiGeneration: (
    g: import('@/lib/playbook/ai-generate').GeneratedAssistance,
  ) => void;
  /** Drop a single generation by id (the small × on each card). */
  removeAiGeneration: (id: string) => void;
  /** Wipe all generations (the welcome modal\'s reset-all-data
   *  link consults this). */
  clearAiGenerations: () => void;
};
