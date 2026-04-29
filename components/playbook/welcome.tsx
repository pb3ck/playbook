'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ENGAGEMENTS,
  type Engagement,
  type EngagementMeta,
} from '@/lib/engagements';
import {
  TARGET_OSES,
  type TargetOSChoice,
  type TargetOSMeta,
} from '@/lib/target-os';
import { DEMO_SESSION } from '@/lib/playbook/demo';
import { STORAGE_KEYS, safeWrite } from '@/lib/playbook/persistence';
import { Overlay } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import type { PlaybookState } from './types';

/**
 * Per-visit intro — full-screen takeover that asks for the engagement
 * type AND the target OS before the user enters the walkthrough. Both
 * shape what surfaces downstream:
 *   - Engagement gates pre-checks, warnings, certain steps (e.g. AD
 *     mapping is hidden for bug-bounty).
 *   - Target OS gates OS-specific commands and tools (LinPEAS for
 *     Linux, mimikatz for Windows). "Mixed / unsure" disables OS
 *     filtering entirely.
 *
 * Behavior:
 *   - Opens on every fresh mount of /playbook.
 *   - Non-dismissable. The user MUST pick BOTH before proceeding.
 *   - Cards immediately set their respective value. Once both are set
 *     the welcome auto-dismisses on the next click.
 *   - Persisted across visits — returning users keep both choices.
 *     Clicking the engagement chip in the shell re-opens this picker
 *     to change either.
 *   - Picked values render with a "current" indicator so returning
 *     users know what state they're in.
 */
export function PlaybookWelcome({ state }: { state: PlaybookState }) {
  /* Both axes must be set before dismissal. We dismiss inside the
     setters when the OTHER axis is already set, so a click that
     completes the pair (engagement-then-OS or OS-then-engagement)
     auto-closes. Returning users with both set just click any card
     and it dismisses immediately (since the other is already set). */
  const pickEngagement = (eng: Engagement) => {
    state.setEngagement(eng);
    if (state.targetOS) state.dismissWelcome();
  };
  const pickOS = (os: TargetOSChoice) => {
    state.setTargetOS(os);
    if (state.engagement) state.dismissWelcome();
  };

  const engPicked = !!state.engagement;
  const osPicked = !!state.targetOS;

  return (
    <Overlay
      open={!state.welcomed}
      onClose={state.dismissWelcome}
      ariaLabel="Pick your engagement type and target OS"
      backdrop="solid"
      motionPreset="splash"
      dismissable={false}
      className="max-w-3xl"
    >
      {/* Identity */}
      <div className="text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bone-3">
          playbook
        </div>
        <h2
          className="mt-3 font-medium tracking-tight text-bone-0"
          style={{ fontSize: 'clamp(1.75rem, 5.5vw, 2.75rem)', lineHeight: 1.05 }}
        >
          Set the frame.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-bone-2 sm:text-base">
          Two questions shape what the walkthrough surfaces: the legal
          frame you&rsquo;re operating under, and what kind of box
          you&rsquo;re attacking.
        </p>
      </div>

      {/* Alpha disclaimer — every user sees this on first load and
          again whenever they reopen the picker. Honesty over
          marketing: the catalog is uneven, gaps are real, and we
          don't want to waste anyone's engagement time pretending
          otherwise. Mirrored by the `alpha` chip in the shell so
          the notice persists past dismissal. */}
      <AlphaNotice />

      {/* First-run micro-tour — three cards explaining what the
          three top-level surfaces do. Shown once per browser
          (`tourSeen` flag); skippable via the dismiss link. */}
      <FirstRunTour />


      {/* Engagement section */}
      <div className="mt-8">
        <SectionHeading
          number="01"
          label="Engagement"
          done={engPicked}
        />
        <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ENGAGEMENTS.map((eng) => (
            <li key={eng.id}>
              <PickerCard
                short={eng.short}
                label={eng.label}
                blurb={eng.blurb}
                isCurrent={state.engagement === eng.id}
                onPick={() => pickEngagement(eng.id)}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* Target OS section */}
      <div className="mt-6">
        <SectionHeading
          number="02"
          label="Target OS"
          done={osPicked}
        />
        <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TARGET_OSES.map((os) => (
            <li key={os.id}>
              <PickerCard
                short={os.short}
                label={os.label}
                blurb={os.blurb}
                isCurrent={state.targetOS === os.id}
                onPick={() => pickOS(os.id)}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* Hint when only one is picked */}
      {(engPicked !== osPicked) && (
        <div className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-bone-3">
          {engPicked ? 'pick a target os to continue →' : 'pick an engagement to continue →'}
        </div>
      )}

      {/* "Load example engagement" — the first-impression unlock.
          Lets a fresh visitor populate the entire app (axes, tags,
          versions, scratch, ticked commands, demonstrated ATT&CK
          techniques, infra graph) with one click instead of having
          to imagine the value from an empty walkthrough. */}
      {!engPicked && !osPicked && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => state.loadSnapshot(DEMO_SESSION)}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border border-bone-1 btn-sheen elev-2 px-5 font-mono text-[11px] uppercase tracking-wider text-ink-0 transition-all hover:-translate-y-0.5',
            )}
            title="Skip the picker and load a worked Windows AD engagement so you can explore the playbook + map fully populated"
          >
            ★ load example engagement
          </button>
          <p className="max-w-md text-center font-mono text-[10.5px] leading-relaxed text-bone-3">
            Internal Windows AD walkthrough — Zerologon / NoPac /
            Certifried triaged, kerberoast + DCSync + ESC1 demonstrated.
            Lights up every part of the app so you can see what it does.
          </p>
        </div>
      )}

      {/* Reset-all affordance — only when there's something to reset */}
      {(engPicked || osPicked) && (
        <div className="mt-8 flex justify-center">
          <ResetAllLink onConfirm={state.resetAllPlaybookData} />
        </div>
      )}
    </Overlay>
  );
}

/* =================================================== Alpha notice */

/** Honest "the catalog is uneven" disclaimer. Shown above the
 *  picker on every welcome render — first visit, returning visit,
 *  manual reopen via the shell chip — so the expectation is set
 *  before anyone sinks time into a real engagement.
 *
 *  Wording avoids both extremes: not "broken" (it isn't — the
 *  covered slice is genuinely useful) and not "comprehensive
 *  framework" (it isn't that either). The user reads this and
 *  knows whether to bother. */
function AlphaNotice() {
  return (
    <section
      aria-label="Alpha notice — limited catalog coverage"
      className="mt-6 rounded-xl border border-dashed border-warn/50 bg-warn/[0.06] p-4"
    >
      <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-warn">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-warn"
        />
        Alpha &middot; limited coverage
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-bone-2">
        Under construction. The catalog goes deep on a focused slice
        &mdash; Active Directory, common web stacks, a handful of
        cloud and CVE entries &mdash; and most other technologies
        are shallow or empty. Treat this as a starting frame to
        iterate on, not a comprehensive replacement for established
        methodology references. Many engagements will hit gaps fast.
      </p>
    </section>
  );
}

/* =================================================== First-run tour */

/** Three-card mini-tour that explains Playbook / Map / Export.
 *  Reads/writes a single boolean flag in localStorage so it shows
 *  exactly once per browser. Returning users never see it again
 *  unless they wipe storage. */
function FirstRunTour() {
  const [show, setShow] = useState(false);
  /* Defer the read until after mount so SSR + first client render
     match (otherwise a returning user briefly sees the tour). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.tourSeen);
      if (raw !== 'true') setShow(true);
    } catch {
      /* storage unavailable — fall back to "show once per session" */
      setShow(true);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    safeWrite(STORAGE_KEYS.tourSeen, true);
  };

  if (!show) return null;

  return (
    <section
      aria-label="What this tool does"
      className="mt-8 rounded-xl border border-dashed border-ink-5/60 bg-ink-1/40 p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          What this tool does
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="font-mono text-[10px] uppercase tracking-wider text-bone-4 transition-colors hover:text-bone-1"
          title="Hide this tour for future visits"
        >
          got it · skip
        </button>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TourCard
          number="01"
          title="Playbook"
          body="Five phases — recon → vuln → exploit → post-ex → defense. Filtered to your engagement, OS, and tech stack. Tick commands as you run them."
        />
        <TourCard
          number="02"
          title="Map"
          body="Auto-built attack graph. Hosts, services, vulns, creds — derived from what you've ticked. ATT&CK techniques pinned to the right node."
        />
        <TourCard
          number="03"
          title="Export"
          body="Markdown cheat-sheet · SVG / PNG of the map · JSON snapshot of your whole session, re-importable anywhere."
        />
      </ul>
    </section>
  );
}

function TourCard({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-md border border-ink-5/60 surface-gradient elev-1 p-3">
      <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
        <span className="text-bone-4">{number}</span>
        <span className="text-bone-1">{title}</span>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-bone-2">
        {body}
      </p>
    </li>
  );
}

/* =================================================== sub-components */

function SectionHeading({
  number,
  label,
  done,
}: {
  number: string;
  label: string;
  done: boolean;
}) {
  const reduce = useReducedMotion();
  /* When the section is unfilled, the whole heading row breathes
     between 60% and 100% opacity (~2.4s). Subtle enough to not
     distract while you're reading; obvious enough to telegraph
     "you haven't answered me yet." Honors prefers-reduced-motion. */
  return (
    <motion.div
      initial={false}
      animate={
        !done && !reduce
          ? { opacity: [0.6, 1, 0.6] }
          : { opacity: 1 }
      }
      transition={{
        duration: 2.4,
        repeat: !done && !reduce ? Infinity : 0,
        ease: 'easeInOut',
      }}
      className="flex items-baseline justify-between gap-3"
    >
      <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
        <span className="text-bone-4">{number}</span>
        <span className={done ? 'text-bone-3' : 'text-bone-1'}>{label}</span>
      </div>
      <span
        className={cn(
          'font-mono text-[10px] uppercase tracking-wider',
          done ? 'text-bone-3' : 'text-bone-2',
        )}
      >
        {done ? 'set' : 'needs answer'}
      </span>
    </motion.div>
  );
}

function PickerCard({
  short,
  label,
  blurb,
  isCurrent,
  onPick,
}: {
  short: string;
  label: string;
  blurb: string;
  isCurrent: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'group flex h-full w-full flex-col items-start rounded-xl border p-4 text-left surface-gradient',
        'transition-all duration-200 hover:-translate-y-0.5',
        isCurrent
          ? 'border-bone-1 elev-2 hover:border-bone-0'
          : 'border-ink-5 elev-1 hover:border-bone-4 hover:elev-2',
      )}
    >
      <div className="flex w-full items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
        <span className={isCurrent ? 'text-bone-1' : 'text-bone-3 group-hover:text-bone-1'}>
          {short}
        </span>
        {isCurrent && <span className="text-bone-3">current</span>}
      </div>
      <div className="mt-2 text-base font-medium text-bone-0">{label}</div>
      <div className="mt-1 text-[12px] text-bone-2">{blurb}</div>
    </button>
  );
}

function ResetAllLink({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-bone-4 underline-offset-4 transition-colors hover:text-bone-2 hover:underline"
      >
        reset all data
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]">
      <span className="text-bone-3">
        wipes everything (engagement, OS, targets, progress, recents).
      </span>
      <button
        type="button"
        onClick={onConfirm}
        className="text-bone-0 underline-offset-4 hover:underline"
      >
        confirm
      </button>
      <span aria-hidden className="text-bone-4">·</span>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-bone-4 hover:text-bone-2"
      >
        cancel
      </button>
    </div>
  );
}

/* Re-export the legacy meta type so any external callers don't break.
   `EngagementMeta` was already exported by `lib/engagements`; this alias
   exists for symmetry with `TargetOSMeta` if ever needed. */
export type { EngagementMeta, TargetOSMeta };
