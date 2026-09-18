import type { Metadata } from 'next';
import { DemoClient } from './demo-client';

export const metadata: Metadata = {
  title: 'Try a call',
  description: 'Hear a real One Moment call: a caller with aphasia pauses for six seconds mid-sentence, and the agent holds the line for him.',
};

export default function DemoPage() {
  return <DemoClient />;
}
