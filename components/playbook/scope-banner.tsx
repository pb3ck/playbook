'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { engagementOf } from '@/lib/engagements';
import { cn } from '@/lib/cn';
import type { PlaybookState } from './types';

/**
 * One-line collapsible scope reminder, surfaced between the shell
 * chip and the playbook body. Closed by default so it doesn't hog
 * vertical real estate after the user has read it once; openable for
 * the moments when you need to double-check what is/isn't allowed.
 *
 * Content comes from `engagement.scopeNote` — the legal/RoE caveat
 * that previously lived only in the data file and was never rendered.
 * For bug-bounty: program-scope reminder. For private: signed RoE
 * reminder. For lab: callback-into-VPN reminder.
 *
 * Quiet visual treatment: small mono header, dashed border, subdued
 * body. Reads as metadata, not as an alert. The user opens it when
 * they want it; it doesn't shout.
 */
export function ScopeBanner({ state }: { state: PlaybookState }) {
  const [open, setOpen] = useState(false);
  const eng = engagementOf(state.engagement);
  if (!eng) return null;

  return (
    <section aria-label="Engagement scope reminder" className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-md border border-dashed px-3 py-1.5 text-left transition-colors',
          open
            ? 'border-bone-4 bg-ink-2/40'
            : 'border-ink-5 bg-ink-2/20 hover:border-bone-4',
        )}
      >
        <span className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="text-bone-3">scope</span>
          <span className="text-bone-1">{eng.label}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            'shrink-0 font-mono text-[11px] transition-transform',
            open ? 'rotate-180 text-bone-2' : 'text-bone-3',
          )}
        >
          ▾
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="scope-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-bone-2">
              {eng.scopeNote}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
