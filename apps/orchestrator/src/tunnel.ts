// Development tunnel.
//
// The Voice Agent API calls our "LLM" endpoint and rejects anything that is not
// public HTTPS. In production that is the deployed orchestrator's own URL. On a
// laptop, a Cloudflare quick tunnel provides one: no account, no system install,
// the binary lives inside node_modules.
//
// Found by testing: spawning through the npm .bin shim swallowed cloudflared's
// output on Windows. Call the executable directly.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

function cloudflaredBinary(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = path.dirname(require.resolve('cloudflared/package.json'));
    const bin = path.join(pkg, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

export async function openTunnel(port: number, timeoutMs = 60000): Promise<{ url: string; proc: ChildProcess } | null> {
  const bin = cloudflaredBinary();
  if (!bin) return null;
  const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
  const url = await new Promise<string | null>((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    const onData = (d: Buffer) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { clearTimeout(t); resolve(m[0]); }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', () => { clearTimeout(t); resolve(null); });
  });
  if (!url) { proc.kill(); return null; }
  // A fresh quick-tunnel hostname takes a variable time to resolve publicly.
  // MEASURED 18 Sept: a fixed 4s wait was sometimes not enough, and AssemblyAI
  // rejected the agent with "base_url host does not resolve". Poll instead.
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) break;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { url, proc };
}
