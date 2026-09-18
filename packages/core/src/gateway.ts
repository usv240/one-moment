// AssemblyAI LLM Gateway client.
//
// Everything in here was learned by running it, not by reading about it:
//
//  - GET /v1/models lists the live catalogue. A free-tier key is entitled to a
//    small subset (measured: 1 of 37). Every other id returns 400 "Your account
//    does not have access to this LLM Gateway model", including the ids used as
//    examples in the official docs. So we discover, never hardcode.
//  - The gateway rate-limits hard. A 429 returns in about 95ms, so an unhandled
//    rate limit looks exactly like excellent latency while returning nothing.
//    Retry with backoff, and report throttling separately from latency.
//  - Small models may not support response_format. JSON comes from the prompt.

const DEFAULT_BASE = 'https://llm-gateway.assemblyai.com/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ChatResult =
  | { ok: true; ms: number; rateLimited: number; content: string }
  | { ok: false; ms: number; rateLimited: number; status?: number; error: string };

export type GatewayConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
};

export async function chat(
  cfg: GatewayConfig & { model: string },
  system: string,
  user: string,
  maxTokens = 220,
): Promise<ChatResult> {
  const base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const maxRetries = cfg.maxRetries ?? 4;
  const t0 = Date.now();
  let rateLimited = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: cfg.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, rateLimited, error: (err as Error).message };
    }

    const text = await res.text();

    if (res.status === 429) {
      rateLimited++;
      if (attempt === maxRetries) {
        return { ok: false, ms: Date.now() - t0, rateLimited, status: 429, error: 'rate limited' };
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 250);
      continue;
    }

    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, ms, rateLimited, status: res.status, error: text.slice(0, 300) };

    try {
      const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
      return { ok: true, ms, rateLimited, content: json.choices?.[0]?.message?.content ?? '' };
    } catch {
      return { ok: false, ms, rateLimited, status: res.status, error: 'unparseable gateway response' };
    }
  }
  return { ok: false, ms: Date.now() - t0, rateLimited, error: 'retries exhausted' };
}

/** Pull the first JSON object out of a model reply, tolerating fences and prose. */
export function extractJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

let cachedModel: { key: string; model: string } | null = null;

/**
 * Find a model this key is actually entitled to. Smallest and fastest first,
 * because Dissent runs on every turn inside a 400ms budget.
 */
export async function discoverModel(cfg: GatewayConfig): Promise<string | null> {
  if (cfg.model) return cfg.model;
  if (cachedModel && cachedModel.key === cfg.apiKey) return cachedModel.model;

  const base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  let listed: string[] = [];
  try {
    const res = await fetch(`${base}/models`, { headers: { authorization: cfg.apiKey } });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id: string }[] };
      listed = (json.data ?? []).map((m) => m.id);
    }
  } catch {
    return null;
  }

  const hinted = listed.filter((id) => /fast|lite|mini|nano|flash|haiku/i.test(id));
  const order = [...new Set([...hinted, ...listed])];

  for (const model of order) {
    const r = await chat({ ...cfg, model, maxRetries: 1 }, 'Reply with: ok', 'ping', 8);
    if (r.ok) {
      cachedModel = { key: cfg.apiKey, model };
      return model;
    }
    if (r.status === 429) await sleep(1000);
  }
  return null;
}
