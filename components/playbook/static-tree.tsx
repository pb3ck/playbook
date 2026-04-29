import { faviconUrl } from '@/lib/favicon';
import { PHASES, type Phase } from '@/lib/methodology';
import { type FlatTool } from '@/lib/playbook/constants';
import { toolsForPhase } from '@/lib/playbook/matching';

/**
 * Server-rendered, fully-static fallback for the playbook. Wrapped in
 * <noscript> by the parent so it only ships to clients with JavaScript
 * disabled (or crawlers that don't execute it).
 *
 * Mirrors the live app's structure: phase-grouped, no folder tree.
 * Crawlers see the same intent as JS-on visitors — five phases, each
 * listing the tools that fall within it. Tools that match multiple
 * phases (e.g. CVE references in both vuln-discovery and exploit) appear
 * under each phase they qualify for.
 */
export function StaticTree() {
  return (
    <div className="font-mono text-sm">
      <div className="mb-3 text-[11px] text-bone-3">
        Static fallback — interactive search and navigation require JavaScript.
      </div>
      <div className="space-y-6">
        {PHASES.map((phase) => (
          <PhaseSection key={phase.slug} phase={phase} />
        ))}
      </div>
    </div>
  );
}

function PhaseSection({ phase }: { phase: Phase }) {
  const tools = toolsForPhase(phase);
  return (
    <section id={phase.slug} className="scroll-mt-24">
      <header className="mb-2 flex items-baseline gap-3 border-b border-ink-5 pb-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-bone-4">
          {String(phase.index).padStart(2, '0')}
        </span>
        <h2 className="text-base text-bone-0">{phase.name}</h2>
        <span className="hidden text-[11px] text-bone-3 sm:inline">
          — {phase.blurb}
        </span>
        <span className="ml-auto text-[11px] text-bone-3">{tools.length}</span>
      </header>
      <ul className="divide-y divide-ink-5/60 border-y border-ink-5">
        {tools.map((t) => (
          <li key={`${phase.slug}:${t.url}`}>
            <StaticTool tool={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StaticTool({ tool }: { tool: FlatTool }) {
  const fav = faviconUrl(tool.url);
  return (
    <a
      href={tool.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-2.5 px-2 py-1.5 text-bone-2 hover:bg-ink-2"
    >
      {fav && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={fav}
          alt=""
          aria-hidden
          width={16}
          height={16}
          className="h-4 w-4 shrink-0 rounded-sm bg-ink-2/60 ring-1 ring-inset ring-ink-5"
        />
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-bone-0">{tool.name}</span>
        <span className="text-bone-4"> · {tool.category}</span>
        <span className="text-bone-3"> — {tool.description}</span>
      </span>
    </a>
  );
}

