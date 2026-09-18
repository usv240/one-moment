import type { Metadata } from 'next';
import { Check, X } from 'lucide-react';
import { Block, Code, Page, Table } from '@/components/page';
import { Cite } from '@/components/cite';
import contrast from '@/content/contrast.json';
import axe from '@/content/axe.json';

export const metadata: Metadata = {
  title: 'Accessibility report',
  description: 'Our own accessibility audit of One Moment: contrast, automated checks, and the design decisions behind the caller view.',
};

type Row = { mode: string; fg: string; bg: string; fgHex: string; bgHex: string; ratio: number; min: number; why: string; pass: boolean };
type AxeRun = { checkedAt: string | null; tool: string; pages: { path: string; scheme: string; violations: { id: string; impact: string | null; help: string; nodes: number }[]; passes: number }[] };

const Verdict = ({ ok }: { ok: boolean }) => (
  <span className="inline-flex items-center gap-1 font-medium text-ink">
    {ok ? <Check aria-hidden className="h-4 w-4 text-grounded" /> : <X aria-hidden className="h-4 w-4 text-vetoed" />}
    {ok ? 'Pass' : 'Fail'}
  </span>
);

export default function AccessibilityPage() {
  const rows = (contrast as { checkedAt: string; rows: Row[] }).rows;
  const passed = rows.filter((r) => r.pass).length;
  const run = axe as AxeRun;
  const totalViolations = run.pages.reduce((s, p) => s + p.violations.length, 0);

  return (
    <Page
      eyebrow="Accessibility"
      title="Our own audit"
      intro={<p>We built an accessibility product. Failing accessibility would be indefensible, so here is our audit, generated from the code, including anything it found.</p>}
    >
      <Block id="caller-view" title="Decisions behind the caller's screen">
        <ul className="space-y-3">
          {[
            ['At most three things on screen.', 'One idea per line, very large type. Aphasia-friendly formatting and Hick\'s law both point the same way: fewer choices, faster and surer decisions.'],
            ['No timer, ever.', 'A clock on someone who cannot find a word adds pressure and makes the block worse.'],
            ['No transcript of their own speech.', 'Seeing your own disfluent speech written out is discouraging, and it is not what the caller needs.'],
            ['Two real choices, never yes or no.', 'Buttons 88 pixels tall, at most four words each, plus "Something else".'],
            ['Atkinson Hyperlegible for everything the caller reads.', 'Designed by the Braille Institute to make letters hard to confuse.'],
            ['Stop is on screen whenever it speaks for the caller.', 'Its own colour token, with contrast checked separately, because it is the one control that must always work.'],
          ].map(([t, b]) => (
            <li key={t} className="rounded-xl border border-line bg-raised p-4">
              <p className="font-semibold text-ink">{t}</p>
              <p className="mt-1 text-sm text-muted">{b}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">Sources: <Cite id="rose" /><Cite id="sca" /><Cite id="wcag" /></p>
      </Block>

      <Block id="contrast" title={`Colour contrast: ${passed} of ${rows.length} pairs pass`}>
        <p>
          Every text and state colour, in both themes, checked against WCAG 2.2. This runs before every build and the build
          fails on any violation. Last run {(contrast as { checkedAt: string }).checkedAt}.
        </p>
        <Table
          caption="Contrast pairs"
          head={['Theme', 'Pair', 'Ratio', 'Needed', 'Purpose', 'Result']}
          rows={rows.map((r) => [
            r.mode,
            <span key="p" className="flex items-center gap-2">
              <span aria-hidden className="h-4 w-4 rounded border border-line" style={{ background: r.bgHex }}>
                <span className="block h-2 w-2 translate-x-1 translate-y-1 rounded-sm" style={{ background: r.fgHex }} />
              </span>
              <Code>{r.fg}</Code> on <Code>{r.bg}</Code>
            </span>,
            <span key="r" className="font-mono">{r.ratio}:1</span>,
            <span key="m" className="font-mono">{r.min}:1</span>,
            r.why,
            <Verdict key="v" ok={r.pass} />,
          ])}
        />
        <p className="text-sm text-muted">
          The amber &ldquo;worked out&rdquo; evidence colour is below 3:1 in light mode. It is never the only signal: every
          evidence mark also has an icon and a text label, and the colours were chosen with a colour-blindness validator after
          our first draft, green and red, failed it.
        </p>
      </Block>

      <Block id="automated" title={run.checkedAt ? `Automated checks: ${totalViolations} ${totalViolations === 1 ? 'issue' : 'issues'} found` : 'Automated checks'}>
        {run.checkedAt ? (
          <>
            <p>
              {run.tool}, run on {run.checkedAt} against every page in both themes. Automated tools catch only some real
              problems, so this is a floor, not a verdict.
            </p>
            <Table
              caption="Automated accessibility checks"
              head={['Page', 'Theme', 'Rules passed', 'Issues']}
              rows={run.pages.map((p) => [
                <Code key="p">{p.path}</Code>,
                p.scheme,
                p.passes,
                p.violations.length ? p.violations.map((v) => `${v.help} (${v.impact ?? 'n/a'}, ${v.nodes})`).join('; ') : <Verdict key="v" ok />,
              ])}
            />
          </>
        ) : (
          <p className="text-muted">Not yet run on this build.</p>
        )}
      </Block>

      <Block id="gaps" title="What we have not done">
        <ul className="list-disc space-y-2 pl-5">
          <li>No testing with people with aphasia, and no review by a speech-language pathologist.</li>
          <li>No full manual screen-reader walkthrough. Live regions announce the caller&apos;s state and the replay captions, but that is not the same as a real audit.</li>
          <li>Voice input only. A caller who cannot speak at all needs a different product.</li>
        </ul>
      </Block>
    </Page>
  );
}
