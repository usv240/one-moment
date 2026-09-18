// Drives the orchestrator exactly as a judge's browser would, in sample mode:
// one WebSocket, no microphone, no second person. Prints the call as it unfolds.
import WebSocket from 'ws';
import { startServer } from '../src/server.ts';

const server = await startServer({ port: 8798, tunnel: true });
console.log(`server up, public URL ${server.publicUrl ?? 'none'}\n`);
const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
const T0 = Date.now();
const at = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(5) + 's';
const audio: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
let done = false;

ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'caller', mode: 'sample' })));
ws.on('message', (data, isBinary) => {
  if (isBinary) { const b = data as Buffer; audio[b[0]!] = (audio[b[0]!] ?? 0) + b.length - 1; return; }
  const m = JSON.parse(String(data));
  switch (m.type) {
    case 'ready': console.log(`${at()} ready  farLeg=${m.farLeg}`); break;
    case 'simulation': console.log(`${at()} SIM    ${m.event}${m.detail ? `: ${m.detail}` : ''}`); if (m.event === 'call_complete') done = true; break;
    case 'floor': if (!['USER_SPEAKING'].includes(m.state)) console.log(`${at()} floor  ${m.state}`); break;
    case 'outward': console.log(`${at()} APPROVED (${m.kind}) "${m.text}"`); break;
    case 'agent_spoke': console.log(`${at()} SPOKEN  "${m.text}"`); break;
    case 'dissent': console.log(`${at()} dissent ${m.result.decision.action} rule ${m.result.decision.policyRule}`); break;
    case 'far_heard': console.log(`${at()} far heard "${m.text}"`); break;
    case 'question': console.log(`${at()} QUESTION "${m.question.prompt}"`); break;
    case 'error': console.log(`${at()} ERROR ${m.message}`); break;
  }
});

const deadline = Date.now() + 70000;
while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
const sec = (bytes: number, rate: number) => (bytes / 2 / rate).toFixed(1) + 's';
console.log(`\naudio streamed to the browser: caller ${sec(audio[1]!, 16000)}, pharmacist ${sec(audio[2]!, 24000)}, agent voice ${sec(audio[3]!, 24000)}`);
console.log(done ? 'SAMPLE CALL COMPLETE' : 'DID NOT COMPLETE within 70s');
ws.close();
await server.close();
process.exit(done ? 0 : 1);
