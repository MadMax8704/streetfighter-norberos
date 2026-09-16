import { getStore } from "@netlify/blobs";

/* ============================================================================
   Ragdoll Masters – ranglista API
   ----------------------------------------------------------------------------
   GET  /api/scores   -> { scores: [ {name,score,wave,time,ts}, ... ] }  (top 10)
   POST /api/scores   -> ugyanaz + { entry }  (a létrehozott bejegyzés, ts-sel)

   Tárolás: Netlify Blobs, egyetlen "board" kulcs alatt a teljes lista JSON-ként.
   Írás ETag-ellenőrzéssel (onlyIfMatch / onlyIfNew), ütközésnél újrapróbálva —
   így két egyszerre beérkező eredmény nem írja felül egymást.
   ========================================================================== */

const STORE = "ragdoll-leaderboard";
const KEY = "board";
const TOP = 10;            // ennyi sor megy vissza a kliensnek
const KEEP = 60;           // ennyi bejegyzést tárolunk összesen
const MAX_BODY = 2048;     // maximális kérésméret (byte)
const RL_WINDOW = 60_000;  // rate limit ablaka: 1 perc
const RL_MAX = 6;          // ennyi beküldés / IP / perc

/* best-effort rate limit: csak a meleg (újrahasznált) példányon belül működik,
   de a legdurvább spamot így is megfogja. */
const seen = new Map();

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

const cleanName = (v) =>
  String(v ?? "")
    .replace(/[<>&"'`\\/\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12)
    .toUpperCase() || "PLAYER";

const sortRows = (a) =>
  a.slice().sort((x, y) => (y.score || 0) - (x.score || 0) || (x.time || 0) - (y.time || 0));

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/* a kulcs lehet, hogy még nem létezik: a getWithMetadata ilyenkor null-t ad */
async function readBoard(store) {
  const res = await store.getWithMetadata(KEY, { type: "json" });
  return Array.isArray(res?.data) ? res.data : [];
}

function rateLimited(ip) {
  const at = Date.now();
  const hits = (seen.get(ip) || []).filter((t) => at - t < RL_WINDOW);
  hits.push(at);
  seen.set(ip, hits);
  if (seen.size > 1000) seen.clear(); // ne nőjön korlátlanul
  return hits.length > RL_MAX;
}

export default async (req, context) => {
  const store = getStore(STORE);

  try {
    if (req.method === "GET") {
      const rows = sortRows(await readBoard(store)).slice(0, TOP);
      return json({ scores: rows, source: "global" });
    }

    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const ip = context?.ip;
    if (ip && rateLimited(ip)) return json({ error: "too many submissions" }, 429);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "payload too large" }, 413);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "invalid body" }, 400);
    }

    /* a pontszámnak egésznek és >= 0-nak kell lennie; clampInt helyett explicit
       ellenőrzés, mert a clampInt a negatív értékeket csendben 0-ra vágta volna */
    const rawScore = Math.trunc(Number(body.score));
    if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1e9) {
      return json({ error: "invalid score" }, 400);
    }
    const score = rawScore;

    const entry = {
      name: cleanName(body.name),
      score,
      wave: clampInt(body.wave, 1, 999, 1),
      time: clampInt(body.time, 0, 86400, 0),
      ts: Date.now(),
    };

    /* olvas-írás ETag-gel: ha közben más írt, újrapróbáljuk a friss listával */
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await store.getWithMetadata(KEY, { type: "json" });
      const rows = Array.isArray(res?.data) ? res.data : [];
      const next = sortRows(rows.concat([entry])).slice(0, KEEP);
      const opts = res?.etag ? { onlyIfMatch: res.etag } : { onlyIfNew: true };
      const out = await store.setJSON(KEY, next, opts);
      if (out?.modified !== false) {
        const idx = next.findIndex((r) => r.ts === entry.ts && r.name === entry.name);
        return json({
          scores: next.slice(0, TOP),
          source: "global",
          entry,
          rank: idx >= 0 ? idx + 1 : null,
        });
      }
    }
    return json({ error: "write conflict, try again" }, 409);
  } catch (err) {
    console.error("scores function error", err);
    return json({ error: "server error" }, 500);
  }
};

export const config = { path: "/api/scores", method: ["GET", "POST"] };
