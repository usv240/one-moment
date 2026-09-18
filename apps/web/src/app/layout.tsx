import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

// Inter for dense UI. Atkinson Hyperlegible for everything the caller reads:
// designed by the Braille Institute to maximise character disambiguation.
// JetBrains Mono for evidence, timings and code.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const atkinson = Atkinson_Hyperlegible({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-atkinson', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'One Moment: the voice agent that waits for you',
    template: '%s | One Moment',
  },
  description:
    'One Moment waits as long as a stroke survivor needs, offers two choices when the word will not come, asks the pharmacist to hold the line, and speaks only the words he actually said.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#121110' },
  ],
};

// Runs synchronously in <head>, before first paint, so an explicit theme choice
// never flashes. No stored choice means "follow the OS", handled in CSS.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("om-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${atkinson.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
