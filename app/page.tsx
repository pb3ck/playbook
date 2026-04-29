import { Playbook } from '@/components/playbook';
import { StaticTree } from '@/components/playbook/static-tree';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'playbook',
  description:
    'A phase-driven walkthrough of offensive security — five stages, scoped to engagement type, target OS, and tech stack. Auto-derived attack graph, ATT&CK thread-back, BYOK CVE enrichment.',
};

export default function PlaybookPage() {
  /* Wide constraint so the Map tab's infra canvas has real room.
     Other tabs cap their own content with internal max-widths so
     they aren't affected. */
  return (
    <div className="mx-auto max-w-[100rem] px-5 pt-8 pb-16 md:px-10 md:pt-12 md:pb-24">
      {/* The Playbook shell provides identity (wordmark + chips).
          No page-level <h1> — the shell owns the typographic
          hierarchy via its sr-friendly wordmark. */}
      <Playbook />

      {/* No-JS / crawler fallback. Browsers with JS hide this
          entirely; crawlers and JS-off visitors get the full
          phase-grouped catalog. */}
      <noscript>
        <div className="mt-6">
          <h1 className="mb-4 text-2xl font-medium text-bone-0">
            playbook
          </h1>
          <StaticTree />
        </div>
      </noscript>
    </div>
  );
}
