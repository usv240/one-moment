import { ImageResponse } from 'next/og';

export const alt = 'One Moment: the voice agent that waits for you';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The share card. The measured headline, not a slogan: the same sentence, cut in
// two by default settings, held whole by One Moment.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#fbfaf9', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, background: '#e6f2f2', border: '3px solid #1f6a6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 20, height: 20, borderRadius: 10, background: '#1f6a6b' }} />
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#1c1b19' }}>One Moment</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: '#1c1b19', lineHeight: 1.1 }}>Every voice agent is built to stop listening.</div>
          <div style={{ fontSize: 64, fontWeight: 700, color: '#1f6a6b', lineHeight: 1.1 }}>This one is built to wait.</div>
        </div>
        <div style={{ display: 'flex', gap: 24, fontSize: 26, color: '#1c1b19' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: '#f3f2ef', borderRadius: 16, padding: 20, flex: 1 }}>
            <div style={{ fontSize: 20, color: '#55514c' }}>DEFAULT SETTINGS: 2 TURNS</div>
            <div style={{ marginTop: 8 }}>&ldquo;I need to refill my...&rdquo; / &ldquo;amlodipine prescription please.&rdquo;</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', background: '#ffffff', border: '3px solid #1f6a6b', borderRadius: 16, padding: 20, flex: 1 }}>
            <div style={{ fontSize: 20, color: '#1f6a6b' }}>ONE MOMENT: 1 TURN</div>
            <div style={{ marginTop: 8 }}>&ldquo;I need to refill my amlodipine prescription, please.&rdquo;</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
