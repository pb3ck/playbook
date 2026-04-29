'use client';

import { useEffect, useState } from 'react';

/**
 * Platform-aware modifier key label.
 *
 * Returns `⌘<key>` on Mac and `Ctrl <key>` everywhere else, so UI hints read
 * naturally for Windows/Linux users instead of showing a glyph they don't
 * have on their keyboard.
 *
 * SSR-safe: the initial value is the Mac label (to match the most common
 * desktop visitor), and the hook updates on mount once we can read
 * `navigator`. Initial server + client renders match — the post-mount
 * update is a state change, not a hydration mismatch.
 */
export function useModKey(keyName: string): string {
  // Server + first client render both see `⌘`. No hydration mismatch.
  const [label, setLabel] = useState(`⌘${keyName}`);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const isMac = detectIsMac();
    setLabel(isMac ? `⌘${keyName}` : `Ctrl ${keyName}`);
  }, [keyName]);

  return label;
}

/**
 * Detect whether we're on macOS / iPadOS / iPhone.
 *
 * Tries the modern userAgentData first (Chromium), falls back to the
 * deprecated but widely-supported navigator.platform, and finally to
 * userAgent sniffing. Any of these returning a Mac-ish string counts.
 */
export function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } })
    .userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
  return /mac|iphone|ipad/i.test(platform);
}
