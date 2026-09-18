// Keeps a public demo alive on a small budget.
//
// Calls on the server's own AssemblyAI key are limited: a few at once, a few
// per visitor per hour, and a few minutes each. Calls on a visitor's own key
// are limited only by what this server can carry. Nothing here stores a key.

export type GuardOptions = {
  /** Concurrent calls on the server's key. */
  maxServerCalls: number;
  /** Concurrent calls of any kind. */
  maxTotalCalls: number;
  /** Server-key calls per visitor per hour. */
  perIpPerHour: number;
  /** Longest call, in ms. */
  maxCallMs: number;
  /** API requests per visitor per minute. */
  apiPerIpPerMinute: number;
};

export const guardOptionsFromEnv = (env = process.env): GuardOptions => ({
  maxServerCalls: Number(env.MAX_SERVER_CALLS ?? 2),
  maxTotalCalls: Number(env.MAX_TOTAL_CALLS ?? 8),
  perIpPerHour: Number(env.CALLS_PER_IP_PER_HOUR ?? 8),
  maxCallMs: Number(env.MAX_CALL_SECONDS ?? 180) * 1000,
  apiPerIpPerMinute: Number(env.API_PER_IP_PER_MINUTE ?? 20),
});

export class Guard {
  readonly opts: GuardOptions;
  private serverCalls = 0;
  private totalCalls = 0;
  private starts = new Map<string, number[]>();
  private api = new Map<string, number[]>();

  constructor(opts: GuardOptions) {
    this.opts = opts;
  }

  private recent(map: Map<string, number[]>, ip: string, windowMs: number): number[] {
    const now = Date.now();
    const xs = (map.get(ip) ?? []).filter((t) => now - t < windowMs);
    map.set(ip, xs);
    return xs;
  }

  /** Returns a release function, or a reason the call cannot start. */
  admit(ip: string, byoKey: boolean): { release: () => void } | { reason: string } {
    if (this.totalCalls >= this.opts.maxTotalCalls) return { reason: 'The engine is at capacity. Try again in a minute.' };
    if (!byoKey) {
      if (this.serverCalls >= this.opts.maxServerCalls) {
        return { reason: 'The shared demo key is busy with other calls. Try again in a minute, or bring your own AssemblyAI key on the setup page.' };
      }
      const xs = this.recent(this.starts, ip, 3600_000);
      if (xs.length >= this.opts.perIpPerHour) {
        return { reason: 'You have used this hour\'s demo calls on the shared key. Bring your own AssemblyAI key on the setup page to keep going.' };
      }
      xs.push(Date.now());
      this.serverCalls++;
    }
    this.totalCalls++;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.totalCalls--;
        if (!byoKey) this.serverCalls--;
      },
    };
  }

  allowApi(ip: string): boolean {
    const xs = this.recent(this.api, ip, 60_000);
    if (xs.length >= this.opts.apiPerIpPerMinute) return false;
    xs.push(Date.now());
    return true;
  }

  get status() {
    return { serverCalls: this.serverCalls, totalCalls: this.totalCalls, ...this.opts };
  }
}

/** The visitor's address, honouring one proxy hop (Railway, Vercel). */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback: string | undefined): string {
  const fwd = headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || fallback || 'unknown';
}
