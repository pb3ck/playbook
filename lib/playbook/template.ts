/**
 * Tiny `{name}` template substitution. Used to interpolate user-supplied
 * context (target, discovered version, free-form scratch values, future
 * axes) into command snippets on the playbook page.
 *
 * Deliberately bare-bones — no escaping, no nesting, no defaults. The
 * only consumer is `CommandSnippet.command` strings under our own
 * authorship; anything dynamic that touches the DOM is rendered as a
 * text node by React, so HTML escaping isn't a concern here.
 *
 * Resolution order:
 *   1. `vars[name]` — caller-supplied (target, version)
 *   2. `scratch[name]` — user-filled scratch value for that token
 *   3. `<placeholder>` for known tokens (target, version)
 *   4. Verbatim `{name}` for everything else (visible authoring bug)
 */

/** Per-token placeholders rendered when a `{name}` token has no value
 *  — the snippet stays copyable but visibly *not* configured. */
const PLACEHOLDERS: Record<string, string> = {
  target: '<target>',
  version: '<version>',
};

/** Backwards-compat re-export. */
export const TARGET_PLACEHOLDER = PLACEHOLDERS.target;

/* Lookbehind on `%` so curl `-w` format strings like `%{http_code}`,
   `%{redirect_url}`, `%{url_effective}`, `%{size_download}` are NOT
   treated as playbook tokens. The user must never be prompted for
   these in the scratch editor (curl resolves them itself), and they
   must never be eaten by `interpolate` either. Other shell sigils
   (`${var}`, `$(cmd)`) already start with a non-`{` char so they're
   unaffected. */
const TOKEN = /(?<!%)\{(\w+)\}/g;

/**
 * Replace every `{name}` in `template` with the corresponding value
 * from `vars`, falling back to `scratch[name]` for ad-hoc user-set
 * tokens (e.g. `{cve}`, `{exploit_id}`, `{path}`). Known tokens
 * without a value fall back to a visible placeholder; unknown tokens
 * are left verbatim so authoring mistakes surface rather than silently
 * substituting nothing.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | undefined>,
  scratch: Record<string, string> = {},
): string {
  return template.replace(TOKEN, (full, name: string) => {
    const v = vars[name];
    if (v && v.length > 0) return v;
    const s = scratch[name];
    if (s && s.length > 0) return s;
    if (name in PLACEHOLDERS) return PLACEHOLDERS[name];
    return full;
  });
}

/**
 * Walk a string and collect every distinct `{name}` token used. Used
 * by the focus view to show a per-step scratch-value editor populated
 * with exactly the tokens that step's commands actually reference
 * (minus the well-known `target` / `version` which have their own
 * dedicated inputs).
 */
export function extractTokens(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  // Reset regex state defensively (TOKEN has the `g` flag).
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(template)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/**
 * Tokens that the UI surfaces in their own dedicated inputs and
 * therefore should never appear in the auto-detected scratch
 * editor — `target` lives in the shell, `version` is per-tag in
 * the engagement builder.
 */
export const RESERVED_TOKENS = new Set(['target', 'version']);

/**
 * Walk every command string in `commands`, collect distinct
 * `{name}` tokens, drop the reserved ones (`target`, `version`).
 * The order is "first appearance" so the scratch editor renders
 * tokens in the order the user reads them in the commands. Used
 * by the engagement builder (Map view) to populate its scratch-
 * value editor with the tokens the focused step actually uses.
 */
export function extractScratchTokens(
  commands: ReadonlyArray<{ command: string }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of commands) {
    for (const t of extractTokens(c.command)) {
      if (RESERVED_TOKENS.has(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
