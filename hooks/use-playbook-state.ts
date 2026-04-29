'use client';

import { useCallback, useEffect, useState } from 'react';
import { PHASES } from '@/lib/methodology';
import { ENGAGEMENTS, type Engagement } from '@/lib/engagements';
import { TARGET_OSES, type TargetOSChoice } from '@/lib/target-os';
import { TECH_TAG_GROUPS, type TechTag } from '@/lib/tech-tags';
import {
  loadByokProfiles,
  loadEngagement,
  loadPhase,
  loadProgress,
  loadRecents,
  loadInfraMap,
  loadScratchValues,
  loadVisitedSteps,
  loadTargetOS,
  loadTargets,
  loadTechTags,
  loadVersions,
  RECENT_MAX,
  safeWrite,
  STORAGE_KEYS,
} from '@/lib/playbook/persistence';
import type { ByokProfile } from '@/lib/playbook/byok';
import { readStateFromURL, writeStateToURL } from '@/lib/playbook/url-state';
import { EMPTY_INFRA_MAP, type InfraMap } from '@/lib/playbook/infra';
import {
  progressFromSnapshot,
  type SessionSnapshot,
} from '@/lib/playbook/session';
import type { PlaybookState } from '@/components/playbook/types';

/**
 * The single state container for the playbook app.
 *
 * Owns:
 *   - engagement (persisted)
 *   - phase index (persisted + URL)
 *   - search query (URL)
 *   - per-item progress (persisted)
 *   - per-engagement target (persisted)
 *   - recently opened tools (persisted)
 *   - focused step index (in-memory)
 *   - welcome / contentMounted in-memory flags
 *
 * Does NOT own keyboard shortcuts — the playbook is click-driven; no
 * global keybind handler is registered.
 *
 * `mounted` is the SSR-hydration guard. Consumers render a placeholder
 * until then to avoid hydration mismatches from `localStorage` defaults.
 */
export function usePlaybookState(): PlaybookState {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [currentPhase, setCurrentPhaseState] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  /* Welcome opens on every mount. Default `false` so landing on
     /playbook always re-shows the intro. The mount-guard in <Playbook>
     keeps SSR rendering a placeholder so this default doesn't cause
     hydration mismatches or a flash. */
  const [welcomed, setWelcomed] = useState(false);
  /* Once true, stays true for the rest of this mount — re-opening the
     intro via the engagement chip doesn't reset it, so the focus view
     doesn't unmount/remount as the user toggles the intro. */
  const [contentMounted, setContentMounted] = useState(false);
  const [engagement, setEngagementState] = useState<Engagement | null>(null);
  const [targetOS, setTargetOSState] = useState<TargetOSChoice | null>(null);
  const [selectedTechTags, setSelectedTechTagsState] = useState<TechTag[]>(
    [],
  );
  const [progress, setProgress] = useState<Set<string>>(new Set());
  const [visitedSteps, setVisitedSteps] = useState<Set<string>>(new Set());

  const [targets, setTargets] = useState<Record<string, string>>({});
  const [versions, setVersionsState] = useState<Record<string, string>>({});
  const [scratchValues, setScratchValuesState] = useState<
    Record<string, string>
  >({});
  const [infraMap, setInfraMapState] = useState<InfraMap>(EMPTY_INFRA_MAP);
  const [byokProfiles, setByokProfilesState] = useState<ByokProfile[]>([]);

  const [focusedStepIdx, setFocusedStepIdxState] = useState<number | null>(
    null,
  );

  /* Mount: hydrate persisted state, read URL params, wire popstate.
     Welcome is intentionally NOT loaded from storage — see the
     `welcomed` declaration above; the intro shows on every mount. */
  useEffect(() => {
    setMounted(true);
    setRecents(loadRecents());

    const eRaw = loadEngagement();
    if (eRaw && ENGAGEMENTS.some((e) => e.id === eRaw)) {
      setEngagementState(eRaw as Engagement);
    }
    const osRaw = loadTargetOS();
    if (osRaw && TARGET_OSES.some((o) => o.id === osRaw)) {
      setTargetOSState(osRaw as TargetOSChoice);
    }
    /* Validate persisted tech tags against the known catalog so a
       schema rename doesn't leave stale ids in state. */
    const validTagIds = new Set(
      TECH_TAG_GROUPS.flatMap((g) => g.tags.map((t) => t.id as string)),
    );
    const tagsRaw = loadTechTags().filter((t) => validTagIds.has(t));
    if (tagsRaw.length > 0) {
      setSelectedTechTagsState(tagsRaw as TechTag[]);
    }

    setProgress(loadProgress());
    setVisitedSteps(loadVisitedSteps());
    setTargets(loadTargets());
    setVersionsState(loadVersions());
    setScratchValuesState(loadScratchValues());
    setInfraMapState(loadInfraMap());
    setByokProfilesState(loadByokProfiles());

    /* URL params take precedence over localStorage — a shared link
       applies its phase + query, not your previous one. */
    const urlState = readStateFromURL();
    const fromStorage = loadPhase();
    const initial = urlState.phase ?? fromStorage ?? 0;
    setCurrentPhaseState(Math.max(0, Math.min(initial, PHASES.length - 1)));
    if (urlState.query) setQuery(urlState.query);

    const onPop = () => {
      const next = readStateFromURL();
      setQuery(next.query ?? '');
      if (typeof next.phase === 'number') setCurrentPhaseState(next.phase);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* Sync state to URL search params (replaceState, no history pollution). */
  useEffect(() => {
    if (!mounted) return;
    writeStateToURL(query, currentPhase);
  }, [mounted, query, currentPhase]);

  const setPhase = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(i, PHASES.length - 1));
    setCurrentPhaseState(clamped);
    safeWrite(STORAGE_KEYS.phase, clamped);
    /* Reset manual step focus on phase change — otherwise the user
       lands in a new phase with stale focus on a step that may not
       exist there. */
    setFocusedStepIdxState(null);
  }, []);

  const setFocusedStepIdx = useCallback((idx: number | null) => {
    setFocusedStepIdxState(idx);
  }, []);

  const toggleProgress = useCallback((id: string) => {
    setProgress((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      safeWrite(STORAGE_KEYS.progress, Array.from(next));
      return next;
    });
  }, []);

  const commitOpen = useCallback((url: string) => {
    setRecents((prev) => {
      const next = [url, ...prev.filter((u) => u !== url)].slice(0, RECENT_MAX);
      safeWrite(STORAGE_KEYS.recents, next);
      return next;
    });
  }, []);

  /** In-memory only — the intro is session-scoped and re-shows on
   *  every mount of /playbook. Flips `contentMounted` on first
   *  dismissal so the rest of the playbook starts rendering. */
  const dismissWelcome = useCallback(() => {
    setWelcomed(true);
    setContentMounted(true);
  }, []);

  const replayWelcome = useCallback(() => {
    setWelcomed(false);
  }, []);

  const setEngagement = useCallback((e: Engagement) => {
    setEngagementState(e);
    safeWrite(STORAGE_KEYS.engagement, e);
  }, []);

  const setTargetOS = useCallback((os: TargetOSChoice) => {
    setTargetOSState(os);
    safeWrite(STORAGE_KEYS.targetOS, os);
  }, []);

  /** Toggle a tech tag in the selected set. Idempotent — adds if
   *  missing, removes if present. Persists immediately. */
  const toggleTechTag = useCallback((tag: TechTag) => {
    setSelectedTechTagsState((prev) => {
      const next = prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag];
      safeWrite(STORAGE_KEYS.techTags, next);
      return next;
    });
  }, []);

  /** Wipe all selected tech tags (returns to "no filter" state). */
  const clearTechTags = useCallback(() => {
    setSelectedTechTagsState([]);
    safeWrite(STORAGE_KEYS.techTags, []);
  }, []);

  /** Auto-tracked when StepCard mounts — records "I\'ve been to
   *  this step." Append-only via this mutator; no per-step
   *  un-visit gesture (the global reset wipes everything). */
  const markVisited = useCallback((stepId: string) => {
    setVisitedSteps((prev) => {
      if (prev.has(stepId)) return prev;
      const next = new Set(prev);
      next.add(stepId);
      safeWrite(STORAGE_KEYS.visitedSteps, Array.from(next));
      return next;
    });
  }, []);

  /** Nuclear reset — wipe every persisted + in-memory bit of playbook
   *  state. Used by the "reset all data" affordance in the welcome
   *  modal. After this runs, engagement is null, so the welcome stays
   *  open (non-dismissable until the user picks again). `welcomed` and
   *  `contentMounted` are session flags, not data — they aren't reset. */
  const resetAllPlaybookData = useCallback(() => {
    if (typeof window !== 'undefined') {
      for (const k of Object.values(STORAGE_KEYS)) {
        try {
          window.localStorage.removeItem(k);
        } catch {
          /* ignore — same SSR/quota safety as safeWrite */
        }
      }
    }
    setProgress(new Set());
    setVisitedSteps(new Set());
    setTargets({});
    setVersionsState({});
    setScratchValuesState({});
    setInfraMapState(EMPTY_INFRA_MAP);
    setByokProfilesState([]);
    setRecents([]);
    setEngagementState(null);
    setTargetOSState(null);
    setSelectedTechTagsState([]);
    setCurrentPhaseState(0);
    setQuery('');
    setFocusedStepIdxState(null);
  }, []);

  /** Atomically replace every persisted slice from a parsed
   *  snapshot. Anything not present in the snapshot resets to its
   *  default — partial snapshots don\'t leave stale state behind.
   *  The snapshot\'s `target` is treated as an engagement-scoped
   *  value (matches the rest of the persistence model). */
  const loadSnapshot = useCallback((snapshot: SessionSnapshot) => {
    setEngagementState(snapshot.engagement);
    setTargetOSState(snapshot.target_os);
    setSelectedTechTagsState(snapshot.tech_tags);
    setVersionsState(snapshot.versions);
    setScratchValuesState(snapshot.scratch_values);
    setInfraMapState(snapshot.infra_map);
    setProgress(progressFromSnapshot(snapshot));
    setVisitedSteps(new Set(snapshot.visited_steps));
    /* Target is keyed under the snapshot\'s engagement, mirroring
       the per-engagement target map. If no engagement is set we
       drop the target rather than orphan it. */
    if (snapshot.engagement && snapshot.target.length > 0) {
      setTargets({ [snapshot.engagement]: snapshot.target });
    } else {
      setTargets({});
    }
    /* Snapshot doesn\'t carry these in-memory-only signals, so
       reset to defaults. */
    setCurrentPhaseState(0);
    setFocusedStepIdxState(null);
    setQuery('');
    /* Persist everything the snapshot replaced. */
    safeWrite(STORAGE_KEYS.engagement, snapshot.engagement);
    safeWrite(STORAGE_KEYS.targetOS, snapshot.target_os);
    safeWrite(STORAGE_KEYS.techTags, snapshot.tech_tags);
    safeWrite(STORAGE_KEYS.versions, snapshot.versions);
    safeWrite(STORAGE_KEYS.scratchValues, snapshot.scratch_values);
    safeWrite(STORAGE_KEYS.infraMap, snapshot.infra_map);
    safeWrite(STORAGE_KEYS.visitedSteps, snapshot.visited_steps);
    safeWrite(
      STORAGE_KEYS.progress,
      Array.from(progressFromSnapshot(snapshot)),
    );
    if (snapshot.engagement && snapshot.target.length > 0) {
      safeWrite(STORAGE_KEYS.targets, {
        [snapshot.engagement]: snapshot.target,
      });
    } else {
      safeWrite(STORAGE_KEYS.targets, {});
    }
  }, []);

  const isComplete = useCallback(
    (id: string) => progress.has(id),
    [progress],
  );

  const isVisited = useCallback(
    (stepId: string) => visitedSteps.has(stepId),
    [visitedSteps],
  );

  /** Active target for the current engagement. Empty string when no
   *  engagement is set or no target has been entered yet. */
  const target = engagement ? targets[engagement] ?? '' : '';

  const setTarget = useCallback(
    (value: string) => {
      if (!engagement) return;
      setTargets((prev) => {
        const next = { ...prev, [engagement]: value };
        safeWrite(STORAGE_KEYS.targets, next);
        return next;
      });
    },
    [engagement],
  );

  /** Set + persist a single tag's discovered version. Empty value
   *  removes the entry entirely so commands fall back to the
   *  `<version>` placeholder rather than rendering an empty string. */
  const setVersion = useCallback((tag: string, value: string) => {
    setVersionsState((prev) => {
      const next = { ...prev };
      if (value.length === 0) {
        delete next[tag];
      } else {
        next[tag] = value;
      }
      safeWrite(STORAGE_KEYS.versions, next);
      return next;
    });
  }, []);

  /** Wipe every per-tag version. Useful when pivoting to a new
   *  target after a previous engagement filled in the map. */
  const clearVersions = useCallback(() => {
    setVersionsState({});
    safeWrite(STORAGE_KEYS.versions, {});
  }, []);

  /** Set + persist a single scratch value. Empty value removes the
   *  key entirely so unused tokens don't pile up in storage and
   *  fall back to their `{name}` verbatim render. */
  const setScratchValue = useCallback((key: string, value: string) => {
    setScratchValuesState((prev) => {
      const next = { ...prev };
      if (value.length === 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
      safeWrite(STORAGE_KEYS.scratchValues, next);
      return next;
    });
  }, []);

  /** Wipe every scratch value (returns to the `{name}` verbatim
   *  fallback for unknown tokens). */
  const clearScratchValues = useCallback(() => {
    setScratchValuesState({});
    safeWrite(STORAGE_KEYS.scratchValues, {});
  }, []);

  /** Replace the entire infra map atomically. Functional update
   *  form supported (mirrors React\'s setState contract) so the
   *  canvas can do `setInfraMap(prev => ({ ... }))` without
   *  stale-closure races during drag. Persists immediately. */
  const setInfraMap = useCallback(
    (next: InfraMap | ((prev: InfraMap) => InfraMap)) => {
      setInfraMapState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        safeWrite(STORAGE_KEYS.infraMap, value);
        return value;
      });
    },
    [],
  );

  /** Replace the entire BYOK profile list atomically. Functional
   *  update form for the same reason as setInfraMap — settings UI
   *  often does N transformations in one action (toggle + reorder
   *  + delete). Persists immediately. */
  const setByokProfiles = useCallback(
    (next: ByokProfile[] | ((prev: ByokProfile[]) => ByokProfile[])) => {
      setByokProfilesState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        safeWrite(STORAGE_KEYS.byokProfiles, value);
        return value;
      });
    },
    [],
  );

  return {
    mounted,
    engagement,
    setEngagement,
    targetOS,
    setTargetOS,
    selectedTechTags,
    toggleTechTag,
    clearTechTags,
    progress,
    toggleProgress,
    resetAllPlaybookData,
    isComplete,
    visitedSteps,
    markVisited,
    isVisited,
    query,
    setQuery,
    currentPhase,
    setPhase,
    target,
    setTarget,
    versions,
    setVersion,
    clearVersions,
    scratchValues,
    setScratchValue,
    clearScratchValues,
    infraMap,
    setInfraMap,
    loadSnapshot,
    focusedStepIdx,
    setFocusedStepIdx,
    welcomed,
    dismissWelcome,
    replayWelcome,
    contentMounted,
    recents,
    commitOpen,
    byokProfiles,
    setByokProfiles,
  };
}
