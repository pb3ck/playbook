'use client';

import {
  useEffect,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

/**
 * Modal overlay primitive used by the palette, welcome, and shortcuts
 * surfaces. Owns the boring shared bits — portal, backdrop, body
 * scroll-lock, optional Esc-to-close, motion enter/exit — so each
 * consumer is just its own body content + a few props.
 *
 * Two presets:
 *   - `pop` (default): small lift + scale, ~0.22s. Used for transient
 *     palettes/dialogs the user opens and closes a lot. Backdrop fades
 *     in gently — page bleed-through during the fade is intentional
 *     ("you can see what you're returning to").
 *   - `splash`: bigger lift, no scale, ~0.36s, **no backdrop fade**.
 *     The backdrop is opaque from the moment the overlay mounts so the
 *     underlying page doesn't bleed through during the dialog's slide-in
 *     — this matters for the welcome, where seeing the methodology view
 *     ghost behind a "splash" reads as a glitch.
 *
 * Two backdrops:
 *   - `translucent` (default): black/70 + blur. The page shows through.
 *   - `solid`: pure ink-0. Full takeover.
 *
 * `dismissable` (default `true`):
 *   - true:  backdrop click closes; window-level Esc closes (unless a
 *            consumer's onKeyDown preventDefaulted).
 *   - false: backdrop is inert (a div, not a button); Esc is ignored.
 *            Used for the welcome/intro, which the user must engage with
 *            via its own buttons rather than dismiss.
 *
 * Esc handling, when dismissable: a window-level listener calls
 * `onClose` unless the keydown was already `preventDefault()`ed by a
 * consumer's `onKeyDown` (e.g. the palette intercepts Esc to clear-
 * then-close). Both event systems fire on the same physical keypress;
 * React's synthetic handler runs first, so by the time the native
 * window listener checks `e.defaultPrevented`, the React-side
 * preventDefault has propagated.
 *
 * SSR safety: this file is `'use client'`, but it still gets rendered
 * during Next's RSC pre-pass — calling `createPortal(_, document.body)`
 * during SSR would throw because `document` is undefined. We rely on
 * the parent to guard rendering until client mount (Playbook does this
 * via its `state.mounted` check). All current consumers are downstream
 * of that guard, so no mount-guard is needed here.
 */

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  /** Vertical anchor inside the viewport. */
  align?: 'top' | 'center';
  /** Backdrop style. `solid` is for full-takeover surfaces. */
  backdrop?: 'translucent' | 'solid';
  /** Motion preset for the dialog enter/exit. */
  motionPreset?: 'pop' | 'splash';
  /** When false, the user can't dismiss via backdrop or Esc. The dialog
   *  body must provide its own dismissal path. */
  dismissable?: boolean;
  /** Tailwind classes applied to the dialog wrapper (e.g. `max-w-2xl`). */
  className?: string;
  /** Forwarded to the dialog motion.div. Use to intercept keys before
   *  the window-level Esc handler fires. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
};

const POSITION = {
  top: 'items-start',
  center: 'items-center',
} as const;

const BACKDROP = {
  translucent: 'bg-black/70 backdrop-blur-sm',
  solid: 'bg-ink-0',
} as const;

export function Overlay({
  open,
  onClose,
  ariaLabel,
  align = 'center',
  backdrop = 'translucent',
  motionPreset = 'pop',
  dismissable = true,
  className,
  onKeyDown,
  children,
}: OverlayProps) {
  const reduce = useReducedMotion();

  /* Body scroll lock + window-level Esc → onClose (when dismissable).
     We compensate for the disappearing scrollbar by padding the body
     by its width — this is more reliable than `scrollbar-gutter`
     because the actual scrollbar is on `html`, and `scrollbar-gutter`
     on html doesn't reserve space when html itself isn't a scroll
     container at the moment the body locks. The padding swap is the
     classic, browser-agnostic fix. */
  useEffect(() => {
    if (!open) return;
    const body = document.body;

    // Measure scrollbar width before locking. `clientWidth` excludes
    // the scrollbar gutter; `innerWidth` includes it. Difference =
    // scrollbar width (0 on overlay-scrollbar systems like macOS
    // trackpad-only setups).
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    let removeKey: (() => void) | undefined;
    if (dismissable) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', onKey);
      removeKey = () => window.removeEventListener('keydown', onKey);
    }

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      removeKey?.();
    };
  }, [open, onClose, dismissable]);

  // No mount-guard. Parent components (e.g. Playbook) already guard
  // rendering until client mount, so createPortal is never called on
  // the server. See SSR-safety note in the doc block above.

  const splash = motionPreset === 'splash';

  return createPortal(
    /*
     * `initial={false}` suppresses the entry animation on the very first
     * render of this AnimatePresence — the welcome appears at its final
     * state (no slide) on initial /playbook load. Without this, React's
     * Strict Mode dev-time double-mount caused the entry animation to
     * play, restart, then play again ("bounce"). Subsequent enters/exits
     * (re-opening via back-arrow, opening palette/shortcuts) still
     * animate normally because they're past the AnimatePresence's first
     * render.
     */
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="overlay"
          /* Outer wrapper is pinned to the viewport and does NOT scroll
             itself — the scroll happens on the inner viewport below.
             Why two layers: an earlier single-layer attempt put the
             backdrop as `absolute inset-0` inside a scrolling parent,
             which made the backdrop scroll WITH the content. On longer
             dialogs, scrolling down lifted the backdrop off-screen and
             exposed the page underneath (the site footer became
             visible at the bottom of the welcome). Splitting into a
             non-scrolling outer + scroll-viewport keeps the backdrop
             pinned no matter how far the dialog has been scrolled. */
          className="fixed inset-0 z-50"
          /* Splash skips the outer fade so the backdrop is opaque from
             the moment of mount — no methodology bleed-through during
             the dialog's slide-in. Pop keeps the gentle outer fade. */
          initial={splash ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: splash ? 0.2 : 0.18,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {/* Backdrop — purely visual, pinned to the viewport. Click
              dismissal lives on the scroll viewport's flex wrapper
              below (since the scroll viewport sits on top in DOM
              order, the backdrop button never receives pointer
              events). When dismissable we still expose a screen-
              reader-friendly close button via aria-keyshortcut on the
              window-level Esc handler; mouse users dismiss by
              clicking the wrapper around the dialog. */}
          <div
            aria-hidden
            className={cn('absolute inset-0', BACKDROP[backdrop])}
          />

          {/* Scroll viewport — sits over the backdrop, owns the
              vertical scroll for tall dialogs. `overscroll-contain`
              stops scroll chaining through to the body (which is
              itself overflow:hidden via the lock effect above, but
              defense in depth). */}
          <div className="absolute inset-0 overflow-y-auto overscroll-contain">
            {/* Centering / alignment wrapper. `min-h-full` makes it at
                least viewport-tall so `items-center` actually centers
                when the dialog is short. When the dialog is taller,
                the wrapper grows past min-h-full and the scroll
                viewport handles the overflow. `py-` gives top/bottom
                breathing room so the dialog edges aren't flush with
                the viewport at either scroll extreme. The `onClick`
                with target===currentTarget guard implements
                click-outside-to-dismiss for dismissable overlays
                (palette, shortcuts) — clicks on the dialog itself
                bubble through with target!==currentTarget, so they
                don't dismiss. */}
            <div
              className={cn(
                'flex min-h-full justify-center px-4 py-[10vh] sm:py-[14vh]',
                POSITION[align],
              )}
              onClick={
                dismissable
                  ? (e) => {
                      if (e.target === e.currentTarget) onClose();
                    }
                  : undefined
              }
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                initial={
                  reduce
                    ? { opacity: 0 }
                    : splash
                      ? { opacity: 0, y: 16 }
                      : { opacity: 0, y: 8, scale: 0.985 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reduce
                    ? { opacity: 0 }
                    : splash
                      ? { opacity: 0, y: -8 }
                      : { opacity: 0, y: 4, scale: 0.99 }
                }
                transition={{
                  duration: splash ? 0.36 : 0.22,
                  ease: [0.16, 1, 0.3, 1],
                }}
                onKeyDown={onKeyDown}
                className={cn('relative z-10 w-full', className)}
              >
                {children}
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
