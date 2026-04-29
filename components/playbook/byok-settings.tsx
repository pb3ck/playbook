'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Overlay } from '@/components/ui/overlay';
import {
  type ByokKind,
  type ByokProfile,
  type CveDetails,
  type FetchResult,
  isAiKind,
  kindLabel,
  kindNeedsKey,
  kindPolicyNote,
  kindSupportsBrowserCors,
  newProfileSeed,
  profileCategory,
  testProfile,
} from '@/lib/playbook/byok';

/**
 * BYOK settings drawer — manage CVE / threat-intel profiles
 * (NVD, OSV, EPSS, VulnCheck, custom). Open + close via the gear
 * chip in the shell.
 *
 * Uses the same Overlay primitive as the welcome modal, so the
 * scroll fix from earlier means the drawer scrolls naturally on
 * shorter viewports.
 *
 * Privacy banner is intentionally non-dismissable — every render
 * surfaces it so a user adding a key is reminded of where it
 * goes (their device only) and where it doesn\'t (this app has
 * no backend; static export means there\'s nothing on the server
 * side to forward, log, or store keys).
 */
export function ByokSettings({
  open,
  onClose,
  profiles,
  setProfiles,
}: {
  open: boolean;
  onClose: () => void;
  profiles: ByokProfile[];
  setProfiles: (
    next: ByokProfile[] | ((prev: ByokProfile[]) => ByokProfile[]),
  ) => void;
}) {
  return (
    <Overlay
      open={open}
      onClose={onClose}
      ariaLabel="BYOK profile settings"
      backdrop="translucent"
      motionPreset="pop"
      align="top"
      className="max-w-3xl"
    >
      <div className="rounded-xl border border-ink-5 surface-gradient-deep elev-3 p-5">
        {/* Header */}
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bone-3">
              playbook <span className="text-bone-4">/</span> byok
            </div>
            <h2 className="mt-1 text-xl font-medium tracking-tight text-bone-0">
              CVE provider profiles
            </h2>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-bone-2">
              Add API keys for CVE / threat-intel sources. Finding
              nodes in the Map then enrich with live data — CVSS,
              EPSS, summary, references &mdash; from every enabled
              profile in parallel.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-5 chip px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-bone-2 hover:text-bone-0"
          >
            close
          </button>
        </div>

        {/* Privacy banner — non-dismissable, every render */}
        <section className="mt-4 rounded-lg border border-dashed border-bone-4/40 bg-ink-1/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bone-1">
            Where keys live
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-bone-2">
            On this device, in your browser&rsquo;s localStorage. They
            are sent only to the endpoint configured for each
            profile. This app is a static export &mdash; there is no
            backend to forward, log, or store your keys. Wipe them
            by deleting the profile or using &ldquo;reset all
            data&rdquo; in the welcome modal.
          </p>
        </section>

        {/* Profile list — split into CVE-enrichment + AI-generation
            sections so the user can find each at a glance. Each
            section has its own "+ add" row matching the kinds that
            belong to it. */}
        {profiles.length === 0 && <EmptyHint />}

        <ProfileSection
          heading="CVE enrichment"
          subhead="Power the per-finding lookup popover in the Map. Recommended starter: NVD 2.0 — no key required."
          profiles={profiles.filter((p) => profileCategory(p) === 'cve')}
          setProfiles={setProfiles}
          kinds={['nvd-2.0', 'epss', 'osv', 'vulncheck', 'custom']}
        />

        <ProfileSection
          heading="On-demand AI assistance"
          subhead='Power the "describe a situation" generator. Recommended starter: Ollama running locally (no data leaves your device). Anthropic / OpenAI / OpenAI-compatible work too — see policy notes below.'
          profiles={profiles.filter((p) => profileCategory(p) === 'ai')}
          setProfiles={setProfiles}
          kinds={['ollama', 'anthropic', 'openai', 'openai-compatible']}
        />
      </div>
    </Overlay>
  );
}

/** A header + filtered profile list + add-row triple, used twice
 *  in the drawer (once for CVE kinds, once for AI kinds). Keeps
 *  the two families visually + functionally separated without
 *  duplicating glue. */
function ProfileSection({
  heading,
  subhead,
  profiles,
  setProfiles,
  kinds,
}: {
  heading: string;
  subhead: string;
  profiles: ByokProfile[];
  setProfiles: (
    next: ByokProfile[] | ((prev: ByokProfile[]) => ByokProfile[]),
  ) => void;
  kinds: ByokKind[];
}) {
  return (
    <section className="mt-6">
      <div className="mb-3 border-b border-ink-5/60 pb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-bone-1">
          {heading}
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-bone-3">
          {subhead}
        </p>
      </div>
      {profiles.length > 0 && (
        <ul className="flex flex-col gap-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <ProfileRow
                profile={p}
                onChange={(next) =>
                  setProfiles((prev) =>
                    prev.map((x) => (x.id === p.id ? next : x)),
                  )
                }
                onDelete={() =>
                  setProfiles((prev) => prev.filter((x) => x.id !== p.id))
                }
              />
            </li>
          ))}
        </ul>
      )}
      <AddRow
        kinds={kinds}
        onAdd={(kind) =>
          setProfiles((prev) => [...prev, newProfileSeed(kind)])
        }
      />
    </section>
  );
}

/* =================================================== empty hint */

function EmptyHint() {
  return (
    <div className="rounded-lg border border-dashed border-ink-5 p-4 text-[12px] text-bone-3">
      No profiles yet. Add one below to start enriching CVE findings.
      The simplest, most useful starter is{' '}
      <span className="font-mono text-bone-1">NVD 2.0</span>
      &mdash;
      no key required (but adding one raises your rate limit from
      5 / 30s to 50 / 30s).
    </div>
  );
}

/* =================================================== profile row */

function ProfileRow({
  profile,
  onChange,
  onDelete,
}: {
  profile: ByokProfile;
  onChange: (next: ByokProfile) => void;
  onDelete: () => void;
}) {
  /* Per-row test result. Cleared on any field change so users
     see the staleness rather than acting on an outdated test. */
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FetchResult<CveDetails> | null>(
    null,
  );
  const [confirmDel, setConfirmDel] = useState(false);
  const update = (patch: Partial<ByokProfile>) => {
    setTestResult(null);
    onChange({ ...profile, ...patch });
  };
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await testProfile(profile);
    setTestResult(r);
    setTesting(false);
  };
  return (
    <div
      className={cn(
        'rounded-lg border p-3 surface-gradient',
        profile.enabled ? 'border-ink-5 elev-1' : 'border-ink-5/60 opacity-60',
      )}
    >
      {/* Header line: name + kind chip + enable toggle + delete */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={profile.name}
          onChange={(e) => update({ name: e.target.value })}
          aria-label="Profile name"
          className="min-w-[10rem] flex-1 rounded-md border border-ink-5 bg-ink-0 inset-input px-2 py-1 font-mono text-[12px] text-bone-0 focus:border-bone-4 focus:outline-none"
        />
        <span className="rounded-full border border-ink-5 chip px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-bone-2">
          {kindLabel(profile.kind)}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-bone-3">
          <input
            type="checkbox"
            checked={profile.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="accent-bone-1"
          />
          enabled
        </label>
        {confirmDel ? (
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
            <button
              type="button"
              onClick={onDelete}
              className="text-accent hover:underline"
            >
              confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="text-bone-4 hover:text-bone-2"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="font-mono text-[10px] uppercase tracking-wider text-bone-4 hover:text-bone-2"
          >
            delete
          </button>
        )}
      </div>

      {/* Per-kind URL fields. Each AI / custom kind that needs a
          base URL surfaces here with a kind-appropriate label. */}
      {(profile.kind === 'custom' ||
        profile.kind === 'ollama' ||
        profile.kind === 'openai-compatible') && (
        <div className="mt-2">
          <label className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-bone-3">
            {profile.kind === 'custom' && (
              <>base URL (use {'{id}'} for the CVE id)</>
            )}
            {profile.kind === 'ollama' && <>ollama base URL</>}
            {profile.kind === 'openai-compatible' && (
              <>base URL (chat-completions endpoint or its parent)</>
            )}
          </label>
          <input
            type="text"
            value={profile.baseUrl ?? ''}
            onChange={(e) => update({ baseUrl: e.target.value })}
            placeholder={
              profile.kind === 'custom'
                ? 'https://internal.example.com/cve/{id}'
                : profile.kind === 'ollama'
                  ? 'http://localhost:11434'
                  : 'https://example.com/v1'
            }
            className="w-full rounded-md border border-ink-5 bg-ink-0 inset-input px-2 py-1 font-mono text-[12px] text-bone-0 focus:border-bone-4 focus:outline-none"
          />
        </div>
      )}

      {/* Custom-CVE-only header name field. AI kinds use a fixed
          auth header (Authorization Bearer / x-api-key) so this
          field doesn\'t apply to them. */}
      {profile.kind === 'custom' && (
        <div className="mt-2">
          <label className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-bone-3">
            auth header name (default Authorization)
          </label>
          <input
            type="text"
            value={profile.headerName ?? ''}
            onChange={(e) => update({ headerName: e.target.value })}
            placeholder="Authorization"
            className="w-full rounded-md border border-ink-5 bg-ink-0 inset-input px-2 py-1 font-mono text-[12px] text-bone-0 focus:border-bone-4 focus:outline-none"
          />
        </div>
      )}

      {/* AI-kinds-only model field. */}
      {isAiKind(profile.kind) && (
        <div className="mt-2">
          <label className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-bone-3">
            model id
          </label>
          <input
            type="text"
            value={profile.model ?? ''}
            onChange={(e) => update({ model: e.target.value })}
            placeholder={
              profile.kind === 'anthropic'
                ? 'claude-sonnet-4-5'
                : profile.kind === 'openai'
                  ? 'gpt-4o'
                  : profile.kind === 'ollama'
                    ? 'whiterabbitneo'
                    : 'model-id'
            }
            className="w-full rounded-md border border-ink-5 bg-ink-0 inset-input px-2 py-1 font-mono text-[12px] text-bone-0 focus:border-bone-4 focus:outline-none"
          />
        </div>
      )}

      {/* API key — hidden for kinds that don\'t accept one. */}
      {kindNeedsKey(profile.kind) && (
        <div className="mt-2">
          <label className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-bone-3">
            api key {profile.kind === 'nvd-2.0' && '(optional, raises rate limit)'}
          </label>
          <input
            type="password"
            value={profile.apiKey ?? ''}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="paste key"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-ink-5 bg-ink-0 inset-input px-2 py-1 font-mono text-[12px] text-bone-0 focus:border-bone-4 focus:outline-none"
          />
        </div>
      )}

      {/* AI-kinds-only content-policy note — surface honestly so
          users aren\'t surprised when a pentest prompt gets refused. */}
      {isAiKind(profile.kind) && kindPolicyNote(profile.kind) && (
        <div className="mt-2 rounded-md border border-bone-4/30 bg-ink-0/40 p-2 font-mono text-[10.5px] leading-relaxed text-bone-3">
          ⓘ {kindPolicyNote(profile.kind)}
        </div>
      )}

      {/* CORS warning for kinds known to block it. */}
      {!kindSupportsBrowserCors(profile.kind) && profile.kind !== 'custom' && profile.kind !== 'openai-compatible' && (
        <div className="mt-2 rounded-md border border-bone-4/30 bg-ink-0/40 p-2 font-mono text-[10.5px] leading-relaxed text-bone-3">
          ⚠ {kindLabel(profile.kind)} typically blocks browser CORS.
          Point a{' '}
          <span className="text-bone-1">custom</span> /{' '}
          <span className="text-bone-1">openai-compatible</span> profile
          at your own proxy if the test below fails with a CORS error.
        </div>
      )}

      {/* Test row — only for CVE kinds (where we have a known
          test CVE to look up). AI kinds skip the test button;
          users exercise them via the actual generate flow. */}
      {!isAiKind(profile.kind) && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="rounded-md border border-ink-5 chip px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bone-1 hover:text-bone-0 disabled:opacity-50"
          >
            {testing ? 'testing…' : 'test (CVE-2014-0160)'}
          </button>
          {testResult && <TestResultBadge result={testResult} />}
        </div>
      )}
    </div>
  );
}

function TestResultBadge({ result }: { result: FetchResult<CveDetails> }) {
  if (!result.ok) {
    return (
      <span
        className="font-mono text-[10.5px] text-accent"
        title={result.error}
      >
        ✗ {result.error.slice(0, 60)}
        {result.error.length > 60 ? '…' : ''}
      </span>
    );
  }
  const d = result.data;
  const pieces: string[] = [];
  if (d.summary) pieces.push('summary');
  if (d.cvssV3) pieces.push(`cvss ${d.cvssV3.score || '?'}`);
  if (d.epss) pieces.push(`epss ${d.epss.score.toFixed(3)}`);
  if (d.references && d.references.length > 0)
    pieces.push(`${d.references.length} refs`);
  return (
    <span className="font-mono text-[10.5px] text-bone-2">
      ✓ {pieces.length > 0 ? pieces.join(' · ') : 'response received'}
    </span>
  );
}

/* =================================================== add row */

function AddRow({
  kinds,
  onAdd,
}: {
  kinds: ByokKind[];
  onAdd: (kind: ByokKind) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-5/60 pt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-bone-3">
        add
      </span>
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onAdd(k)}
          className="rounded-full border border-ink-5 chip px-2.5 py-1 font-mono text-[10.5px] tracking-wider text-bone-1 hover:text-bone-0"
        >
          + {kindLabel(k)}
        </button>
      ))}
    </div>
  );
}
