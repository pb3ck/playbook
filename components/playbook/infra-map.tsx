'use client';

import * as React from 'react';
import { useMemo, useState, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { PHASES } from '@/lib/methodology';
import { isOSVisible } from '@/lib/target-os';
import { isTechVisible, isTechVisibleStrict } from '@/lib/tech-tags';
import {
  applyPositions,
  descendantIdsOf,
  deriveNodes,
  type InfraNode,
  type InfraNodeKind,
} from '@/lib/playbook/infra';
import { cn } from '@/lib/cn';
import { ByokCvePopover } from './byok-cve-popover';
import type { PlaybookState } from './types';

/** Match a CVE id anywhere in a string (used to detect "this
 *  finding has a CVE id" → enable the lookup affordance). Same
 *  shape as the regex inside infra.ts; duplicated here so the UI
 *  layer doesn\'t need to import an internal lib helper. */
const CVE_RE = /CVE-\d{4}-\d{4,7}/i;
function findCveIn(meta: string | undefined): string | null {
  if (!meta) return null;
  const m = meta.match(CVE_RE);
  return m ? m[0].toUpperCase() : null;
}

/* =================================================== Service-color palette
   Eight CSS-token-backed colors, one per "service ancestor branch."
   See globals.css `--color-svc-*` for the actual hues. The palette
   is rotated through deterministically by hashing the service id,
   so re-loads always produce the same colors and the user can rely
   on muscle memory ("kerberos was cyan last time"). */
const SERVICE_COLORS = [
  'var(--color-svc-1)',
  'var(--color-svc-2)',
  'var(--color-svc-3)',
  'var(--color-svc-4)',
  'var(--color-svc-5)',
  'var(--color-svc-6)',
  'var(--color-svc-7)',
  'var(--color-svc-8)',
] as const;

/** Stable hash → palette index. Same input always maps to the
 *  same color across renders + sessions. Cheap djb2-ish loop, no
 *  crypto needed (this is purely visual). */
function colorForServiceId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return SERVICE_COLORS[Math.abs(h) % SERVICE_COLORS.length];
}

/** Walk parent pointers up from `node` until we hit a node of kind
 *  'service' (or run out of parents). Used by the edge / node
 *  colorers — every node in a service\'s sub-tree shares the
 *  service\'s color, so the user can trace a whole engagement
 *  branch by following one hue from finding all the way up to
 *  the discoverer tool. */
function serviceAncestor(node: InfraNode, all: InfraNode[]): InfraNode | null {
  let cur: InfraNode | null = node;
  while (cur) {
    if (cur.kind === 'service') return cur;
    if (!cur.parentId) return null;
    cur = all.find((n) => n.id === cur!.parentId) ?? null;
  }
  return null;
}

/** Edge stroke color for a given (child, parent) pair.
 *
 *  Provenance overrides taxonomy: if either endpoint is a
 *  generated node (derived from a ticked-ran AI command), the
 *  edge gets warn-amber regardless of service ancestry. The
 *  user-visible signal "this part of the graph came from AI,
 *  not the catalog" is more important than which service
 *  branch it belongs to.
 *
 *  Otherwise: service-ancestor color for branches; neutral
 *  ink-5 for trunk edges (host → recon-tool / context / cred). */
function edgeStrokeFor(
  child: InfraNode,
  parent: InfraNode,
  all: InfraNode[],
): string {
  if (child.generated || parent.generated) {
    return 'var(--color-warn)';
  }
  const svc = serviceAncestor(child, all);
  return svc ? colorForServiceId(svc.id) : 'var(--color-ink-5)';
}

/**
 * Read-only attack-graph canvas. Nodes are *derived* from the live
 * session state (target, OS, engagement, selected tags, versions,
 * scratch values, ticked commands, demonstrated ATT&CK techniques)
 * — the user never adds, edits, or deletes a node directly. They
 * only rearrange by dragging; positions persist as overrides on
 * top of the layout-computed defaults.
 *
 * Drag semantics:
 *   - Dragging any node moves the entire SUBTREE rooted at it
 *     (host → all services + findings + creds beneath; service →
 *     just its findings).
 *   - The dragged node tracks the cursor instantly; descendants
 *     animate toward their target via Motion spring so they
 *     "pull" along with a soft elastic feel rather than snapping
 *     in lockstep.
 *
 * Export is the only output side-channel — SVG download captures
 * the current layout (including user drags) for embedding in a
 * report.
 */
export function InfraMap({ state }: { state: PlaybookState }) {
  const { infraMap, setInfraMap } = state;
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  /* Re-derive on every relevant state change. The position
     overrides (`infraMap.positions`) layer on top of the layout
     defaults so a user-dragged node stays where the user put it. */
  const nodes = useMemo(() => {
    const derived = deriveNodes({
      engagement: state.engagement,
      targetOS: state.targetOS,
      techTags: state.selectedTechTags,
      target: state.target,
      versions: state.versions,
      scratchValues: state.scratchValues,
      progress: state.progress,
      aiGenerations: state.aiGenerations,
    });
    return applyPositions(derived, infraMap.positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.engagement,
    state.targetOS,
    state.selectedTechTags,
    state.target,
    state.versions,
    state.scratchValues,
    state.progress,
    state.aiGenerations,
    infraMap.positions,
  ]);

  const persistPositions = useCallback(
    (updates: Record<string, { x: number; y: number }>) => {
      setInfraMap((prev) => ({
        positions: { ...prev.positions, ...updates },
      }));
    },
    [setInfraMap],
  );

  /* CVE-id pending lookup. null = popover closed. Set by the
     finding node\'s lookup chip; consumed by the ByokCvePopover
     rendered at the bottom of this component. Lifted to this
     level so the popover can hit every BYOK profile (off
     `state.byokProfiles`) without each node needing access. */
  const [lookupCveId, setLookupCveId] = useState<string | null>(null);

  /* Fit-to-content + reset-pan signal — the actual fit math
     happens inside Canvas (it owns the pan state). We just bump
     a key the canvas listens to. */
  const [fitTick, setFitTick] = useState(0);
  const fitToContent = () => {
    setFitTick((t) => t + 1);
  };

  const resetPositions = () => {
    setInfraMap({ positions: {} });
  };

  /* Filename stem shared by both export formats — engagement +
     timestamp so a folder of exports sorts naturally. */
  const exportStem = () => {
    const eng = state.engagement ?? 'session';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return `playbook-infra-${eng}-${stamp}`;
  };

  const exportSvg = () => {
    if (typeof window === 'undefined') return;
    const svg = buildExportSvg(nodes);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, `${exportStem()}.svg`);
  };

  const exportPng = () => {
    if (typeof window === 'undefined') return;
    const svg = buildExportSvg(nodes);
    /* Rasterise the SVG via a hidden Image + Canvas. Scale up 2x
       for retina-friendly output — the source SVG is vector so the
       PNG just needs enough pixel density to look sharp at common
       embed sizes. Embed-into-a-report is the dominant use case. */
    const SCALE = 2;
    const dims = svgDimensions(svg);
    const w = Math.round(dims.width * SCALE);
    const h = Math.round(dims.height * SCALE);
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(svgUrl);
        return;
      }
      /* Pure-black background fill behind the SVG so PNGs have no
         transparent edges (matches the rest of the site\'s black
         aesthetic). The SVG itself draws its own black bg, but
         covering the canvas first guarantees clean edges if the
         drawImage scale leaves any sub-pixel gaps. */
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(svgUrl);
        if (!blob) return;
        triggerDownload(blob, `${exportStem()}.png`);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;
  };

  const hasUserDrags = Object.keys(infraMap.positions).length > 0;

  return (
    <section aria-label="Infrastructure attack graph">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
            Infrastructure ::{' '}
            <span className="text-bone-4">
              {nodes.length} node{nodes.length === 1 ? '' : 's'} ·
              auto-derived
            </span>
          </p>
          <p className="mt-1 max-w-2xl font-mono text-[10.5px] leading-relaxed text-bone-3">
            Built from your target, selected tags, versions, scratch
            values, and ticked commands. Drag any node to rearrange
            — its children come along.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ZoomControls zoom={zoom} setZoom={setZoom} onFit={fitToContent} />
          {hasUserDrags && (
            <button
              type="button"
              onClick={resetPositions}
              title="Reset all node positions to the auto-layout default"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-ink-5 chip px-2.5 font-mono text-[10px] uppercase tracking-wider text-bone-3 transition-colors hover:border-bone-4 hover:text-bone-0"
            >
              <span aria-hidden>↺</span>
              layout
            </button>
          )}
          {/* Export segmented control: shared "↓" affordance + two
              format buttons. SVG = vector, embeds anywhere, infinite
              zoom. PNG = raster, easier to drop into chat / Slack /
              whatever doesn\'t handle SVG inline. */}
          <div className="inline-flex items-center overflow-hidden rounded-full border border-ink-5 chip">
            <span
              aria-hidden
              className="select-none border-r border-ink-5 px-2 font-mono text-[10px] uppercase tracking-wider text-bone-4"
            >
              ↓
            </span>
            <button
              type="button"
              onClick={exportSvg}
              title="Download as SVG — vector, infinite zoom, embeds in reports"
              className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bone-3 transition-colors hover:text-bone-0"
            >
              svg
            </button>
            <span aria-hidden className="h-4 w-px bg-ink-5" />
            <button
              type="button"
              onClick={exportPng}
              title="Download as PNG — raster, 2x retina resolution, drops anywhere"
              className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bone-3 transition-colors hover:text-bone-0"
            >
              png
            </button>
          </div>
        </div>
      </header>

      <Canvas
        canvasRef={canvasRef}
        nodes={nodes}
        zoom={zoom}
        setZoom={setZoom}
        fitTick={fitTick}
        onCommitDrag={persistPositions}
        onLookupCve={setLookupCveId}
      />

      <CoverageBand state={state} nodes={nodes} />

      {/* CVE enrichment popover — opens when a user clicks the
          lookup chip on a finding node carrying a CVE id. Fans
          out across all enabled BYOK profiles. */}
      <ByokCvePopover
        cveId={lookupCveId}
        profiles={state.byokProfiles}
        onClose={() => setLookupCveId(null)}
      />
    </section>
  );
}

/* =================================================== Coverage band */

/** Per-phase activity rollup beneath the canvas. Comprehensive
 *  read of the engagement state at a glance: visited steps,
 *  ticked commands, derived findings, and unique ATT&CK
 *  techniques per phase. Filtered against the current axes so the
 *  numbers match what the user can actually see. */
function CoverageBand({
  state,
  nodes,
}: {
  state: PlaybookState;
  nodes: InfraNode[];
}) {
  const rows = useMemo(
    () => computeCoverage(state, nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.engagement,
      state.targetOS,
      state.selectedTechTags,
      state.progress,
      state.visitedSteps,
      nodes,
    ],
  );
  return (
    <section className="mt-4 rounded-xl border border-ink-5/60 surface-gradient elev-1">
      <header className="border-b border-ink-5/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
        Phase coverage
      </header>
      <ul className="divide-y divide-ink-5/40">
        {rows.map((r) => (
          <li
            key={r.slug}
            className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 font-mono text-[11px]"
          >
            <span className="font-medium uppercase tracking-[0.18em] text-bone-2">
              {r.short}
            </span>
            <div className="flex flex-wrap items-baseline gap-3 text-bone-3">
              <span>
                <span className="text-bone-1">{r.visited}</span>
                <span className="text-bone-4"> / {r.totalSteps} visited</span>
              </span>
              <span>
                <span className="text-bone-1">{r.ran}</span>
                <span className="text-bone-4"> ran</span>
              </span>
              <span>
                <span className="text-bone-1">{r.findings}</span>
                <span className="text-bone-4"> finding{r.findings === 1 ? '' : 's'}</span>
              </span>
              <span>
                <span className="text-bone-1">{r.techniques.length}</span>
                <span className="text-bone-4"> technique{r.techniques.length === 1 ? '' : 's'}</span>
              </span>
            </div>
            {r.techniques.length > 0 && (
              <div className="hidden max-w-md flex-wrap justify-end gap-1 text-[10px] sm:flex">
                {r.techniques.slice(0, 5).map((t) => (
                  <a
                    key={t}
                    href={`https://attack.mitre.org/techniques/${t.replace('.', '/')}/`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded border border-ink-5 chip px-1 text-bone-3 hover:text-bone-0"
                  >
                    {t}
                  </a>
                ))}
                {r.techniques.length > 5 && (
                  <span className="text-bone-4">
                    +{r.techniques.length - 5}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type CoverageRow = {
  slug: string;
  short: string;
  totalSteps: number;
  visited: number;
  ran: number;
  findings: number;
  techniques: string[];
};

function computeCoverage(
  state: PlaybookState,
  nodes: InfraNode[],
): CoverageRow[] {
  /* Findings on the canvas already carry the phase slug they
     came from — use that count instead of re-walking the
     catalog. */
  const findingsByPhase = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== 'finding' || !n.phase) continue;
    findingsByPhase.set(n.phase, (findingsByPhase.get(n.phase) ?? 0) + 1);
  }
  return PHASES.map((p) => {
    let totalSteps = 0;
    let visited = 0;
    let ran = 0;
    const techSet = new Set<string>();
    for (let i = 0; i < p.steps.length; i++) {
      const step = p.steps[i];
      const engOk =
        !step.appliesTo ||
        (state.engagement !== null &&
          step.appliesTo.includes(state.engagement));
      const osOk = isOSVisible(step.osApplies, state.targetOS);
      const techOk = isTechVisible(step.techApplies, state.selectedTechTags);
      if (!(engOk && osOk && techOk)) continue;
      totalSteps++;
      if (state.visitedSteps.has(`${p.slug}:step:${i}`)) visited++;
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!state.progress.has(`${p.slug}:cmd:${i}:${cIdx}`)) continue;
        const cmdEng =
          !cmd.appliesTo ||
          (state.engagement !== null &&
            cmd.appliesTo.includes(state.engagement));
        if (!cmdEng) continue;
        if (!isOSVisible(cmd.osApplies, state.targetOS)) continue;
        if (!techCheck(cmd.techApplies, state.selectedTechTags)) continue;
        ran++;
        for (const t of cmd.mitreTechniques ?? []) techSet.add(t);
      }
    }
    return {
      slug: p.slug,
      short: p.short,
      totalSteps,
      visited,
      ran,
      findings: findingsByPhase.get(p.slug) ?? 0,
      techniques: [...techSet].sort(),
    };
  });
}

/* =================================================== Canvas */

/* Approximate node-rect dimensions used for edge perimeter math.
   Real nodes vary by content (meta + techniques add height) but
   this is close enough that edges visually terminate at the
   border without measuring DOM. */
const NODE_W = 160;
const NODE_H = 48;

function Canvas({
  canvasRef,
  nodes,
  zoom,
  setZoom,
  fitTick,
  onCommitDrag,
  onLookupCve,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  nodes: InfraNode[];
  zoom: number;
  setZoom: (z: number) => void;
  /** Bumped by the parent when the user clicks `fit` — Canvas
   *  owns the pan state so it does the actual fit math. */
  fitTick: number;
  onCommitDrag: (updates: Record<string, { x: number; y: number }>) => void;
  /** Open the BYOK CVE popover for the given CVE id. Wired into
   *  finding nodes that carry a CVE in their meta. */
  onLookupCve: (id: string) => void;
}) {
  const { width, height, minX, minY } = useMemo(() => bbox(nodes), [nodes]);
  /* Shift coordinates so any negative-x credential nodes still
     render inside the canvas bounds. */
  const offsetX = Math.max(0, -minX) + 60;
  const offsetY = Math.max(0, -minY) + 60;
  const W = Math.max(width + offsetX + 60, 1400);
  const H = Math.max(height + offsetY + 60, 900);

  /* Pan offset for click-drag panning. Replaces the old native
     scroll bars: the wrapper is now `overflow-hidden` and the
     inner content translates by (panX, panY) on top of the zoom
     scale. Pointer-down on empty canvas (not on a node) starts
     a pan; node pointerdowns stop propagation so they don't pan
     by accident. */
  const [pan, setPan] = useState({ x: 0, y: 0 });

  /* Fit-to-content effect — runs when the parent bumps `fitTick`.
     Computes a zoom + pan that frames the content bbox inside the
     wrapper, with a small margin. Capped at 100% so we never
     enlarge past native scale. */
  React.useEffect(() => {
    if (fitTick === 0) return;
    if (!canvasRef.current || nodes.length === 0) return;
    const wrapperW = canvasRef.current.clientWidth;
    const wrapperH = canvasRef.current.clientHeight;
    const contentW = width;
    const contentH = height;
    if (contentW <= 0 || contentH <= 0) return;
    const margin = 60;
    const z = Math.min(
      (wrapperW - margin * 2) / contentW,
      (wrapperH - margin * 2) / contentH,
      1,
    );
    const clamped = Math.max(0.3, Math.min(2, z));
    setZoom(clamped);
    /* Centre the content inside the wrapper. */
    setPan({
      x: (wrapperW - contentW * clamped) / 2 - offsetX * clamped,
      y: (wrapperH - contentH * clamped) / 2 - offsetY * clamped,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);
  const [panDrag, setPanDrag] = useState<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  /* Active node drag. Followers are descendants of the dragged
     node — they render at (position + delta) with no transition,
     so edges + nodes stay visually in lockstep. */
  const [drag, setDrag] = useState<{
    id: string;
    descendantIds: Set<string>;
    dx: number;
    dy: number;
  } | null>(null);

  const startDrag = (id: string) => {
    setDrag({
      id,
      descendantIds: descendantIdsOf(nodes, id),
      dx: 0,
      dy: 0,
    });
  };
  const updateDrag = (dx: number, dy: number) => {
    setDrag((d) => (d ? { ...d, dx, dy } : null));
  };
  const endDrag = () => {
    if (!drag) return;
    if (drag.dx !== 0 || drag.dy !== 0) {
      const updates: Record<string, { x: number; y: number }> = {};
      const movedIds = new Set([drag.id, ...drag.descendantIds]);
      for (const n of nodes) {
        if (!movedIds.has(n.id)) continue;
        updates[n.id] = {
          x: Math.max(-400, n.x + drag.dx),
          y: Math.max(0, n.y + drag.dy),
        };
      }
      onCommitDrag(updates);
    }
    setDrag(null);
  };

  /* Mouse-wheel + trackpad pinch zoom. React's synthetic onWheel
     is passive (can't preventDefault), so we attach a native
     non-passive listener via useEffect. Refs carry the latest
     pan/zoom so the listener stays stable across renders.

     Math: zoom-to-cursor — the content point under the cursor
     stays anchored as zoom changes. Without this the graph drifts
     toward the top-left corner on every wheel tick. */
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  React.useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  React.useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      /* Stops the page from scrolling + stops Cmd/Ctrl-wheel
         from triggering native browser zoom. The wheel belongs
         to the canvas. */
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      /* Sensitivity tuned so a single mouse wheel notch zooms
         visibly but doesn't fly past 2x; trackpad pinches (which
         send many small deltas) feel smooth. */
      const SENSITIVITY = 0.0015;
      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const newZoom = Math.max(
        0.3,
        Math.min(2, curZoom * (1 - e.deltaY * SENSITIVITY)),
      );
      if (newZoom === curZoom) return;
      const contentX = (mouseX - curPan.x) / Math.max(curZoom, 0.01);
      const contentY = (mouseY - curPan.y) / Math.max(curZoom, 0.01);
      setZoom(newZoom);
      setPan({
        x: mouseX - contentX * newZoom,
        y: mouseY - contentY * newZoom,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Wrapper-level pointer handlers for panning. Only fires when
     the gesture didn\'t originate on a node (nodes call
     stopPropagation in their own handlers). */
  const onWrapperPointerDown = (e: React.PointerEvent) => {
    /* Ignore right-click + multi-touch; only handle primary
       button (or the first touch). */
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanDrag({
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    });
  };
  const onWrapperPointerMove = (e: React.PointerEvent) => {
    if (!panDrag) return;
    setPan({
      x: panDrag.startPanX + (e.clientX - panDrag.startMouseX),
      y: panDrag.startPanY + (e.clientY - panDrag.startMouseY),
    });
  };
  const onWrapperPointerUp = (e: React.PointerEvent) => {
    if (!panDrag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setPanDrag(null);
  };

  return (
    <div
      ref={canvasRef}
      className="relative overflow-hidden rounded-xl border border-ink-5/60 surface-gradient elev-1 min-h-[78vh] max-h-[88vh]"
      onPointerDown={onWrapperPointerDown}
      onPointerMove={onWrapperPointerMove}
      onPointerUp={onWrapperPointerUp}
      onPointerCancel={onWrapperPointerUp}
      style={{ cursor: panDrag ? 'grabbing' : 'grab', touchAction: 'none' }}
    >
      <div
        className="relative origin-top-left"
        style={{
          width: W,
          height: H,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        {/* SVG underlay: dot grid + parent-child edges. Edges
            terminate at node perimeters (computed via rect-line
            intersection, not at node centers) so they don\'t leak
            through node bodies. They re-render with the live drag
            delta so they track the moving subtree in real time. */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={W}
          height={H}
          aria-hidden
        >
          <defs>
            <pattern
              id="infra-grid"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx="1"
                cy="1"
                r="1"
                fill="var(--color-ink-5)"
                opacity="0.45"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#infra-grid)" />
          {nodes.map((n) => {
            if (!n.parentId) return null;
            const parent = nodes.find((p) => p.id === n.parentId);
            if (!parent) return null;
            const parentDelta =
              drag && (drag.id === parent.id || drag.descendantIds.has(parent.id))
                ? { x: drag.dx, y: drag.dy }
                : { x: 0, y: 0 };
            const childDelta =
              drag && (drag.id === n.id || drag.descendantIds.has(n.id))
                ? { x: drag.dx, y: drag.dy }
                : { x: 0, y: 0 };
            const parentRect = {
              x: parent.x + offsetX + parentDelta.x,
              y: parent.y + offsetY + parentDelta.y,
              w: NODE_W,
              h: NODE_H,
            };
            const childRect = {
              x: n.x + offsetX + childDelta.x,
              y: n.y + offsetY + childDelta.y,
              w: NODE_W,
              h: NODE_H,
            };
            return (
              <Edge
                key={`edge-${n.id}`}
                fromRect={parentRect}
                toRect={childRect}
                stroke={edgeStrokeFor(n, parent, nodes)}
              />
            );
          })}
        </svg>

        {/* Nodes — instant tracking during drag (no Motion
            spring) so edges and nodes stay visually in
            lockstep. */}
        {nodes.map((node) => {
          const isDragged = drag?.id === node.id;
          const isFollower = !!drag && drag.descendantIds.has(node.id);
          const delta =
            isDragged || isFollower
              ? { x: drag!.dx, y: drag!.dy }
              : { x: 0, y: 0 };
          return (
            <CanvasNode
              key={node.id}
              node={node}
              offsetX={offsetX}
              offsetY={offsetY}
              zoom={zoom}
              isDragged={isDragged}
              delta={delta}
              onStartDrag={() => startDrag(node.id)}
              onUpdateDrag={updateDrag}
              onEndDrag={endDrag}
              onLookupCve={onLookupCve}
            />
          );
        })}
      </div>
    </div>
  );
}

function Edge({
  fromRect,
  toRect,
  stroke,
}: {
  fromRect: { x: number; y: number; w: number; h: number };
  toRect: { x: number; y: number; w: number; h: number };
  /** Edge color — defaults to neutral ink-5 for "trunk" edges,
   *  overridden by the service-ancestor palette color for any
   *  edge inside a service\'s sub-tree (so branches off a shared
   *  hub like Nmap each get their own distinct hue). */
  stroke?: string;
}) {
  /* Compute endpoints at each rectangle\'s perimeter on the line
     connecting the two centres, so the edge stops at the visible
     node border instead of leaking through. */
  const fromCenter = {
    x: fromRect.x + fromRect.w / 2,
    y: fromRect.y + fromRect.h / 2,
  };
  const toCenter = {
    x: toRect.x + toRect.w / 2,
    y: toRect.y + toRect.h / 2,
  };
  const start = perimeterPoint(fromRect, toCenter);
  const end = perimeterPoint(toRect, fromCenter);
  /* Soft S-curve with horizontal control points — gives a clean
     parent → child arc when the layout is mostly horizontal. */
  const cx1 = start.x + (end.x - start.x) * 0.5;
  const cx2 = start.x + (end.x - start.x) * 0.5;
  /* Solid stroke for service-tinted edges (so the color reads
     clearly), dashed for the neutral trunk lines (matches the
     "this is structural, not branch-flow" reading of the
     original design). */
  const isStructural = !stroke || stroke === 'var(--color-ink-5)';
  return (
    <path
      d={`M ${start.x} ${start.y} C ${cx1} ${start.y}, ${cx2} ${end.y}, ${end.x} ${end.y}`}
      fill="none"
      stroke={stroke ?? 'var(--color-ink-5)'}
      strokeWidth={isStructural ? '1' : '1.25'}
      strokeDasharray={isStructural ? '3 3' : undefined}
      strokeOpacity={isStructural ? 1 : 0.85}
    />
  );
}

/** Intersect the ray from rect's centre toward `target` with the
 *  rect's perimeter — returns the perimeter point. Used so edges
 *  terminate at the visible border of each node rather than its
 *  centre. */
function perimeterPoint(
  rect: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function CanvasNode({
  node,
  offsetX,
  offsetY,
  zoom,
  isDragged,
  delta,
  onStartDrag,
  onUpdateDrag,
  onEndDrag,
  onLookupCve,
}: {
  node: InfraNode;
  offsetX: number;
  offsetY: number;
  zoom: number;
  isDragged: boolean;
  delta: { x: number; y: number };
  onStartDrag: () => void;
  onUpdateDrag: (dx: number, dy: number) => void;
  onEndDrag: () => void;
  /** Trigger the CVE enrichment popover for this CVE id. Only the
   *  finding nodes whose meta carries a CVE id render a lookup
   *  chip that calls this. */
  onLookupCve: (id: string) => void;
}) {
  /* If this is a finding node carrying a CVE id, the lookup chip
     fires the BYOK enrichment popover. We compute it here so the
     chip can sit inside the node markup without leaking the regex
     into JSX. */
  const cveInMeta = node.kind === 'finding' ? findCveIn(node.meta) : null;
  /* Local pointer-tracking state — live during a drag, used to
     compute delta on every move. Storing the start coords as a
     ref instead of state so updates don't re-render the node. */
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    onStartDrag();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragged || !start.current) return;
    const dx = (e.clientX - start.current.x) / Math.max(zoom, 0.01);
    const dy = (e.clientY - start.current.y) / Math.max(zoom, 0.01);
    onUpdateDrag(dx, dy);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!isDragged) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    start.current = null;
    onEndDrag();
  };

  /* No transition during drag — followers track the dragged node
     1:1 so the edges (which re-render on every drag tick) stay
     visually attached. The previous spring-lag made the edges
     visually fly ahead of the lagging followers; instant movement
     keeps everything in lockstep. */
  const transition = { duration: 0 };

  /* Service nodes carry the palette color of their own
     branch as a thin top-border accent — implicit legend so
     the user can see "this kerberos service owns the cyan
     edges fanning out from it" without a separate color key
     elsewhere on the canvas. Other node kinds skip the accent
     (their edge color comes from their service ancestor, which
     is already implicitly attributed to the service node).
     Generated nodes override with the warn-amber accent —
     provenance signal beats taxonomy here. */
  const serviceAccent = node.generated
    ? 'var(--color-warn)'
    : node.kind === 'service'
      ? colorForServiceId(node.id)
      : null;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        left: node.x + offsetX,
        top: node.y + offsetY,
        touchAction: 'none',
        ...(node.generated
          ? {
              /* Full warn-amber border tint on generated nodes —
                 unmistakable in a sea of catalog-derived nodes. */
              borderColor: 'var(--color-warn)',
              borderWidth: '1px',
              boxShadow: '0 0 0 1px rgba(255, 178, 36, 0.15)',
            }
          : {}),
        ...(serviceAccent && !node.generated
          ? {
              borderTopColor: serviceAccent,
              borderTopWidth: '2px',
            }
          : {}),
      }}
      animate={{ x: delta.x, y: delta.y }}
      transition={transition}
      className={cn(
        'select-none rounded-md border bg-ink-1 px-2.5 py-1.5',
        nodeKindStyles(node.kind),
        isDragged && 'glow-active cursor-grabbing',
        !isDragged && 'cursor-grab',
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <NodeKindBadge kind={node.kind} />
        {node.generated && (
          <span
            className="rounded border border-warn/50 bg-warn/[0.08] px-1 font-mono text-[8.5px] uppercase tracking-[0.18em] text-warn"
            title="Derived from an AI-generated command (ticked-ran in the AI Assist surface). Not curated catalog material."
          >
            ai
          </span>
        )}
        {node.url ? (
          <a
            href={node.url}
            target="_blank"
            rel="noreferrer noopener"
            onPointerDown={(e) => e.stopPropagation()}
            title={`${node.label} — open`}
            className="max-w-[14rem] truncate font-mono text-[12px] text-bone-0 underline-offset-2 hover:underline"
          >
            {node.label || `(unnamed ${node.kind})`}
          </a>
        ) : (
          <span className="max-w-[14rem] truncate font-mono text-[12px] text-bone-0">
            {node.label || `(unnamed ${node.kind})`}
          </span>
        )}
        {node.phase && (
          <span
            className="ml-auto rounded bg-ink-0/60 px-1 font-mono text-[8.5px] uppercase tracking-[0.18em] text-bone-3"
            title={`Discovered in the ${node.phase} phase`}
          >
            {node.phase}
          </span>
        )}
      </div>
      {node.meta && (
        <div className="mt-0.5 flex max-w-[14rem] items-center gap-1.5">
          <span className="truncate font-mono text-[10.5px] text-bone-3">
            {node.meta}
          </span>
          {cveInMeta && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onLookupCve(cveInMeta);
              }}
              title={`Enrich ${cveInMeta} via configured BYOK profiles`}
              className="ml-auto rounded border border-ink-5 bg-ink-0/60 px-1 font-mono text-[9px] uppercase tracking-wider text-bone-2 transition-colors hover:border-bone-4 hover:text-bone-0"
            >
              lookup
            </button>
          )}
        </div>
      )}
      {node.techniques.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {node.techniques.slice(0, 4).map((t) => (
            <a
              key={t}
              href={`https://attack.mitre.org/techniques/${t.replace('.', '/')}/`}
              target="_blank"
              rel="noreferrer noopener"
              onPointerDown={(e) => e.stopPropagation()}
              title={`${t} — open MITRE write-up`}
              className="rounded bg-ink-0/60 px-1 font-mono text-[9px] text-bone-2 transition-colors hover:text-bone-0"
            >
              {t}
            </a>
          ))}
          {node.techniques.length > 4 && (
            <span className="font-mono text-[9px] text-bone-3">
              +{node.techniques.length - 4}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

function nodeKindStyles(kind: InfraNodeKind): string {
  /* Elevation ramps with semantic weight: host (root context,
     heaviest) > finding (attention-getting, KEV/EPSS-shaped) >
     service / tool (structural middle) > cred / context (wispy
     "captured state" — dashed borders so they read as
     accumulated rather than discovered). */
  switch (kind) {
    case 'host':
      return 'border-bone-1 surface-gradient elev-2';
    case 'service':
      return 'border-ink-5 surface-gradient elev-1';
    case 'finding':
      return 'border-bone-1/60 surface-gradient elev-1';
    case 'credential':
      return 'border-dashed border-bone-1/60 elev-1';
    case 'tool':
      return 'border-ink-5 surface-gradient elev-1';
    case 'context':
      return 'border-dashed border-ink-5 elev-1';
  }
}

function NodeKindBadge({ kind }: { kind: InfraNodeKind }) {
  const labels: Record<InfraNodeKind, string> = {
    host: 'host',
    service: 'svc',
    finding: 'vuln',
    credential: 'cred',
    tool: 'tool',
    context: 'ctx',
  };
  return (
    <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-bone-3">
      {labels[kind]}
    </span>
  );
}

function ZoomControls({
  zoom,
  setZoom,
  onFit,
}: {
  zoom: number;
  setZoom: (z: number) => void;
  onFit: () => void;
}) {
  const step = 0.15;
  const clamp = (v: number) => Math.max(0.3, Math.min(2, v));
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-ink-5 chip p-0.5">
      <button
        type="button"
        onClick={() => setZoom(clamp(zoom - step))}
        title="Zoom out"
        className="h-6 w-6 rounded-full font-mono text-[12px] text-bone-3 transition-colors hover:text-bone-0"
      >
        −
      </button>
      <span
        className="select-none px-1 font-mono text-[10px] uppercase tracking-wider text-bone-3"
        title="Current zoom"
      >
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={() => setZoom(clamp(zoom + step))}
        title="Zoom in"
        className="h-6 w-6 rounded-full font-mono text-[12px] text-bone-3 transition-colors hover:text-bone-0"
      >
        +
      </button>
      <button
        type="button"
        onClick={onFit}
        title="Fit graph to view"
        className="h-6 px-1.5 font-mono text-[10px] uppercase tracking-wider text-bone-3 transition-colors hover:text-bone-0"
      >
        fit
      </button>
      <button
        type="button"
        onClick={() => setZoom(1)}
        title="Reset zoom to 100%"
        className="h-6 px-1.5 font-mono text-[10px] uppercase tracking-wider text-bone-3 transition-colors hover:text-bone-0"
      >
        1:1
      </button>
    </div>
  );
}

/* =================================================== Helpers */

function bbox(nodes: InfraNode[]): {
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (nodes.length === 0)
    return { width: 0, height: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 240,
    height: maxY - minY + 100,
  };
}

/* =================================================== SVG export */

/* Hex mirror of SERVICE_COLORS — the SVG export inlines hex
   literals (no access to the document\'s CSS custom properties),
   so we keep a parallel array. Indices must match SERVICE_COLORS
   so a service hashes to the same color in both the live canvas
   and the downloaded artifact. */
const SERVICE_COLORS_HEX = [
  '#7eb8c9', // cyan
  '#8fb89a', // mint
  '#c08a99', // rose
  '#a597c0', // lavender
  '#c4a18a', // peach
  '#c4a76a', // gold
  '#9eb087', // sage
  '#8aa3b8', // slate
] as const;

function colorForServiceIdHex(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return SERVICE_COLORS_HEX[Math.abs(h) % SERVICE_COLORS_HEX.length];
}

/** Hex equivalent of --color-warn, used for AI-generated edge
 *  + node treatment in the SVG export. */
const WARN_HEX = '#ffb224';

function edgeStrokeForHex(
  child: InfraNode,
  parent: InfraNode,
  all: InfraNode[],
): {
  color: string;
  isStructural: boolean;
} {
  if (child.generated || parent.generated) {
    return { color: WARN_HEX, isStructural: false };
  }
  const svc = serviceAncestor(child, all);
  return svc
    ? { color: colorForServiceIdHex(svc.id), isStructural: false }
    : { color: '#3a3a3a', isStructural: true };
}

function buildExportSvg(nodes: InfraNode[]): string {
  const { width, height, minX, minY } = bbox(nodes);
  const offsetX = Math.max(0, -minX) + 60;
  const offsetY = Math.max(0, -minY) + 60;
  const W = Math.max(width + offsetX + 60, 800);
  const H = Math.max(height + offsetY + 60, 480);

  const edges: string[] = [];
  for (const n of nodes) {
    if (!n.parentId) continue;
    const parent = nodes.find((p) => p.id === n.parentId);
    if (!parent) continue;
    /* Same perimeter-endpoint geometry as the live canvas so the
       exported SVG matches the on-screen render. */
    const parentRect = {
      x: parent.x + offsetX,
      y: parent.y + offsetY,
      w: NODE_W,
      h: NODE_H,
    };
    const childRect = {
      x: n.x + offsetX,
      y: n.y + offsetY,
      w: NODE_W,
      h: NODE_H,
    };
    const start = perimeterPoint(parentRect, {
      x: childRect.x + childRect.w / 2,
      y: childRect.y + childRect.h / 2,
    });
    const end = perimeterPoint(childRect, {
      x: parentRect.x + parentRect.w / 2,
      y: parentRect.y + parentRect.h / 2,
    });
    const cx1 = start.x + (end.x - start.x) * 0.5;
    const cx2 = start.x + (end.x - start.x) * 0.5;
    /* Per-edge color via service-ancestor lookup, with the same
       generated-overrides-taxonomy rule as the live canvas:
       if either endpoint is AI-derived, the edge is amber. */
    const { color, isStructural } = edgeStrokeForHex(n, parent, nodes);
    const dash = isStructural ? ' stroke-dasharray="3 3"' : '';
    const sw = isStructural ? '1' : '1.25';
    const op = isStructural ? '' : ' stroke-opacity="0.85"';
    edges.push(
      `<path d="M ${start.x} ${start.y} C ${cx1} ${start.y}, ${cx2} ${end.y}, ${end.x} ${end.y}" fill="none" stroke="${color}" stroke-width="${sw}"${dash}${op} />`,
    );
  }

  const nodeRects = nodes
    .map((n) => {
      const x = n.x + offsetX;
      const y = n.y + offsetY;
      const fill = '#0e0e0e';
      let stroke = '#3a3a3a';
      let strokeDash = '';
      if (n.kind === 'host') stroke = '#f5f5f5';
      else if (n.kind === 'finding') stroke = '#a3a3a3';
      else if (n.kind === 'credential') {
        stroke = '#a3a3a3';
        strokeDash = ' stroke-dasharray="4 3"';
      } else if (n.kind === 'context') {
        strokeDash = ' stroke-dasharray="4 3"';
      }
      /* Generated nodes override stroke color — provenance trumps
         kind. Mirrors the live canvas\'s warn-amber border on
         AI-derived nodes so downloaded reports preserve the
         "this came from AI" signal. */
      if (n.generated) stroke = WARN_HEX;
      const labelText = escapeXml(n.label || `(unnamed ${n.kind})`);
      const metaText = n.meta ? escapeXml(n.meta) : '';
      const techs = n.techniques.slice(0, 4).map(escapeXml).join('  ');
      const techMore =
        n.techniques.length > 4 ? `  +${n.techniques.length - 4}` : '';
      const nodeH = metaText ? 56 : 38;
      /* Service nodes get a 2px-tall colored bar across the top
         edge as their palette accent — mirrors the borderTop in
         the live canvas, makes the legend implicit in the export
         without needing a separate color key. Generated nodes use
         warn-amber for the same accent (overriding the service
         color since provenance is the dominant signal). */
      const accentColor = n.generated
        ? WARN_HEX
        : n.kind === 'service'
          ? colorForServiceIdHex(n.id)
          : null;
      const accent = accentColor
        ? `<rect x="0" y="0" width="160" height="2" fill="${accentColor}" />`
        : '';
      /* Tiny "AI" glyph in the top-right corner of generated
         nodes — same role as the AI badge in the live canvas. */
      const aiGlyph = n.generated
        ? `<text x="152" y="14" font-family="monospace" font-size="8" fill="${WARN_HEX}" text-anchor="end" letter-spacing="1">AI</text>`
        : '';
      return `
        <g transform="translate(${x} ${y})">
          <rect width="160" height="${nodeH}" rx="6" ry="6" fill="${fill}" stroke="${stroke}"${strokeDash} />
          ${accent}
          ${aiGlyph}
          <text x="8" y="14" font-family="monospace" font-size="8" fill="#a3a3a3" letter-spacing="1">${kindLabel(n.kind).toUpperCase()}</text>
          <text x="40" y="14" font-family="monospace" font-size="11" fill="#f5f5f5">${truncateForSvg(labelText, 18)}</text>
          ${metaText ? `<text x="8" y="32" font-family="monospace" font-size="10" fill="#a3a3a3">${truncateForSvg(metaText, 22)}</text>` : ''}
          ${
            n.techniques.length > 0
              ? `<text x="8" y="${metaText ? 50 : 32}" font-family="monospace" font-size="9" fill="#d4d4d4">${techs}${techMore}</text>`
              : ''
          }
        </g>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="#000000" />
  <defs>
    <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="#3a3a3a" opacity="0.45" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)" />
  ${edges.join('\n  ')}
  ${nodeRects}
  <text x="12" y="${H - 12}" font-family="monospace" font-size="9" fill="#737373" letter-spacing="1">PLAYBOOK · INFRASTRUCTURE MAP · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</text>
</svg>`;
}

function kindLabel(kind: InfraNodeKind): string {
  switch (kind) {
    case 'host':
      return 'host';
    case 'service':
      return 'svc';
    case 'finding':
      return 'vuln';
    case 'credential':
      return 'cred';
    case 'tool':
      return 'tool';
    case 'context':
      return 'ctx';
  }
}

function truncateForSvg(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Pull the width + height attributes off an exported SVG string.
 *  We need them ahead of rasterising so the canvas matches the
 *  source dimensions. The export SVG always sets explicit
 *  attributes (not just viewBox), so a regex is enough — no need
 *  for a full DOM parse. */
function svgDimensions(svg: string): { width: number; height: number } {
  const w = svg.match(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/);
  const h = svg.match(/<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/);
  return {
    width: w ? parseFloat(w[1]) : 800,
    height: h ? parseFloat(h[1]) : 480,
  };
}

/** Common download trigger: blob → object URL → `<a download>` →
 *  click → cleanup. Used by both SVG and PNG exports. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
