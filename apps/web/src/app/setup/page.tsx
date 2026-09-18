import type { Metadata } from 'next';
import { Page } from '@/components/page';
import { SetupClient } from './setup-client';

export const metadata: Metadata = {
  title: 'Make it yours',
  description: 'Bring your own words, name, AssemblyAI key and model to One Moment. Nothing is stored on our server.',
};

export default function SetupPage() {
  return (
    <Page
      eyebrow="Bring your own"
      title="Make it yours"
      intro={
        <p>
          Other tools in this space ask you to train a model on your voice first, which is impossible three weeks after a stroke.
          One Moment personalises with words instead: your medicines, your pharmacy, the people you call. You can take them
          with you as a file.
        </p>
      }
    >
      <SetupClient />
    </Page>
  );
}
