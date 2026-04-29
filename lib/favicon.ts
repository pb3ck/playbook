/**
 * Build a Google s2 favicon URL for an arbitrary site URL.
 *
 * Why Google's service: works for ~every site without us hosting assets, and
 * if a site has no favicon it returns a generic globe rather than 404'ing.
 * Requested at sz=64 so the asset stays crisp at hi-DPI even when rendered
 * at 16–18px in the UI.
 */
export function faviconUrl(toolUrl: string): string | null {
  try {
    const u = new URL(toolUrl);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return null;
  }
}
