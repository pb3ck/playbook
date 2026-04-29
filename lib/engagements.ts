/**
 * Engagement types — the legal/contractual axis that frames the entire
 * playbook walkthrough. The user picks one at the welcome screen; the
 * choice persists across visits and shapes which pre-checks render in
 * each phase, which warnings surface, and which steps may be skipped.
 *
 * Three to start; this is deliberately small. Don't add a new
 * engagement until there's content authored to differentiate it from
 * the existing three — otherwise it's just a label without behavior.
 */
export type Engagement = 'bug-bounty' | 'private' | 'lab';

export type EngagementMeta = {
  id: Engagement;
  /** Display label (proper-cased per the copy-tone rule). */
  label: string;
  /** 4-char short code for compact badges (shell chip, etc.). */
  short: string;
  /** One-line description for the welcome picker. */
  blurb: string;
  /** Longer note rendered as part of every phase's pre-checks block —
   *  the legal/scope context the user should keep in mind throughout. */
  scopeNote: string;
};

export const ENGAGEMENTS: EngagementMeta[] = [
  {
    id: 'bug-bounty',
    label: 'Bug bounty',
    short: 'BB',
    blurb: 'Public or private bounty program with a written scope page.',
    scopeNote:
      "Re-read the program's scope page before every session. Subdomains of in-scope domains are NOT in-scope unless explicitly listed. DoS, brute force, automated scanners, and social engineering are usually disallowed — check the program rules first. Never test an asset that doesn't appear in the scope.",
  },
  {
    id: 'private',
    label: 'Private engagement',
    short: 'PRIV',
    blurb: 'Explicitly authorized pentest with a signed Rules of Engagement.',
    scopeNote:
      "You should have a signed Rules of Engagement document covering the assets, allowed techniques, blackout windows, and emergency contacts. Keep it accessible during the engagement. When in doubt about whether a target or technique is in scope, stop and ask.",
  },
  {
    id: 'lab',
    label: 'Lab / CTF',
    short: 'LAB',
    blurb: 'Practice environment, typically VPN-connected and isolated from the public internet.',
    scopeNote:
      'Lab environments are designed to be attacked, and noise is fine \u2014 often the point. The practical constraint is network isolation: lab boxes usually cannot reach the public internet, so any callback (reverse shell, OOB exfiltration, Burp Collaborator) needs a listener INSIDE the lab on your VPN-assigned IP. Plan accordingly.',
  },
];

export function engagementOf(id: Engagement | null | undefined): EngagementMeta | null {
  if (!id) return null;
  return ENGAGEMENTS.find((e) => e.id === id) ?? null;
}
