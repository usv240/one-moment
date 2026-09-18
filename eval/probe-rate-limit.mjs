// How hard does the free-tier LLM Gateway rate-limit? Fire small requests at a
// steady pace and record when 429s start and what Retry-After says.
const key = process.env.ASSEMBLYAI_API_KEY;
const url = 'https://llm-gateway.assemblyai.com/v1/chat/completions';
const body = JSON.stringify({ model: 'qwen3.5-4b-32k-fast', max_tokens: 4, temperature: 0, messages: [{ role: 'user', content: 'ok' }] });
const T0 = Date.now();
const rows = [];
for (let i = 0; i < 14; i++) {
  const t = Date.now();
  const r = await fetch(url, { method: 'POST', headers: { authorization: key, 'content-type': 'application/json' }, body });
  const hdr = {};
  for (const [k, v] of r.headers) if (/rate|retry|limit|remaining|reset/i.test(k)) hdr[k] = v;
  await r.text();
  rows.push({ i, at: ((t - T0) / 1000).toFixed(1), status: r.status, ms: Date.now() - t, hdr });
  console.log(`#${String(i).padStart(2)} +${((t - T0) / 1000).toFixed(1).padStart(5)}s  ${r.status}  ${String(Date.now() - t).padStart(5)}ms  ${JSON.stringify(hdr)}`);
  await new Promise((res) => setTimeout(res, 1500));
}
const ok = rows.filter((r) => r.status === 200).length;
console.log(`\n${ok}/${rows.length} succeeded at one request per ~1.5s`);
