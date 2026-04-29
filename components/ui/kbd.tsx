import { cn } from '@/lib/cn';

/**
 * Tiny `<kbd>` chip for surfacing keyboard shortcuts inline. One size
 * by design — keybind hints across the app should read at a consistent
 * weight; an earlier two-size system existed but the variants only
 * differed by 2px of horizontal padding and the inconsistency wasn't
 * worth the prop.
 *
 * Override styling via `className` if a specific call site needs a
 * non-default tone (e.g. `text-bone-3` for dim, `text-bone-1` for
 * emphatic).
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'rounded border border-ink-5 bg-ink-2 px-1 py-0.5 font-mono text-[10px] text-bone-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
