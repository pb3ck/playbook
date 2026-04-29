/**
 * Target operating system — second filter axis alongside engagement.
 *
 * The engagement axis answers "what's the legal/contractual frame";
 * the OS axis answers "what kind of box am I attacking right now."
 * Both shape which steps/commands/tools surface in the walkthrough.
 *
 * Why two axes:
 *   The same engagement (e.g. private pentest) can target Linux web
 *   apps OR Windows AD environments — totally different post-ex
 *   tooling. LinPEAS isn't useful when you're attacking a Windows
 *   endpoint; mimikatz isn't useful on Linux. The OS axis lets the
 *   playbook stop showing the wrong half.
 *
 * Three picker options at the user level: linux, windows, or mixed.
 * Items in the methodology can be tagged `osApplies: ['linux']` or
 * `osApplies: ['windows']`; untagged items are OS-neutral and always
 * surface. "Mixed" means "show everything regardless of tag" — the
 * default for users who don't want to commit to one.
 */
export type TargetOS = 'linux' | 'windows';

/** What the user has selected. `'mixed'` = no filter; `null` = not
 *  picked yet (welcome modal stays open). */
export type TargetOSChoice = TargetOS | 'mixed';

export type TargetOSMeta = {
  id: TargetOSChoice;
  /** Display label (proper-cased per the copy-tone rule). */
  label: string;
  /** 3-char short code for compact badges (shell chip, etc.). */
  short: string;
  /** One-line description for the welcome picker. */
  blurb: string;
};

export const TARGET_OSES: TargetOSMeta[] = [
  {
    id: 'linux',
    label: 'Linux / Unix',
    short: 'LIN',
    blurb:
      'Linux servers, embedded, *BSD, container hosts. macOS targets fall here too — most Unix tooling overlaps.',
  },
  {
    id: 'windows',
    label: 'Windows',
    short: 'WIN',
    blurb:
      'Windows endpoints + servers, Active Directory environments, IIS. PowerShell + LOLBAS are your reference set.',
  },
  {
    id: 'mixed',
    label: 'Mixed / unsure',
    short: 'MIX',
    blurb:
      'Multi-OS engagement, or you don\u2019t know yet. Shows everything; filter once you have a target.',
  },
];

export function targetOSOf(
  id: TargetOSChoice | null | undefined,
): TargetOSMeta | null {
  if (!id) return null;
  return TARGET_OSES.find((o) => o.id === id) ?? null;
}

/**
 * Should an item with optional `osApplies` show, given the user's
 * current OS choice? Untagged items are always visible. Mixed-mode
 * users see everything. Otherwise the user's choice must intersect
 * the item's `osApplies` list.
 */
export function isOSVisible(
  osApplies: TargetOS[] | undefined,
  userChoice: TargetOSChoice | null,
): boolean {
  if (!osApplies || osApplies.length === 0) return true;
  if (userChoice === 'mixed' || userChoice === null) return true;
  return osApplies.includes(userChoice);
}
