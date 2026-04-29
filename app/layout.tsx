import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: {
    default: 'playbook',
    template: '%s — playbook',
  },
  description:
    'A phase-driven walkthrough of offensive security. Engagement-aware, ATT&CK-mapped, with an auto-derived attack graph and BYOK CVE enrichment.',
};

/**
 * Minimal layout — no nav, no footer, no shell chrome. The
 * Playbook component owns its own header (wordmark + chips), so
 * the layout is just type tokens + the safe-area paddings.
 *
 * The "skip to main" link stays for screen-reader / keyboard users
 * even though the page is single-purpose; the focus order inside
 * the playbook can still be deep enough to warrant it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-ink-0 text-bone-0 antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-ink-5 focus:bg-ink-1 focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-bone-0 focus:outline-none"
        >
          Skip to main content
        </a>
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}
