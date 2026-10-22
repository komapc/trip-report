// API для трип-репорта. Статика (public/) отдаётся Cloudflare до воркера,
// сюда доходят только /api/*. Ничего о запросе (IP, UA, время) не сохраняем.

const SCALE_KEYS = ["ohuenno", "social", "yoga", "dance", "music", "anxiety", "prikhol",
  "great", "politics", "rhymes", "inward", "ego", "munchies"];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseSession(body) {
  const strain = str(body.strain, 80);
  if (!strain) return { error: "Нужен сорт" };
  const at = new Date(body.at);
  if (isNaN(at)) return { error: "Неверная дата" };
  const scores = {};
  for (const k of SCALE_KEYS) {
    const v = Number(body.scores?.[k]);
    scores[k] = Number.isInteger(v) && v >= -5 && v <= 5 ? v : 0;
  }
  const delToken = str(body.delToken, 128);
  if (delToken.length < 16) return { error: "Нет токена удаления" };
  return {
    row: {
      at: at.toISOString(), strain, method: str(body.method, 60), legendary: body.legendary ? 1 : 0,
      scores: JSON.stringify(scores), banal: str(body.banal, 4000), text: str(body.text, 8000),
    },
    delToken,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (url.pathname === "/api/sessions" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, at, strain, method, legendary, scores, banal, text FROM sessions ORDER BY at DESC LIMIT 2000"
      ).all();
      return json(results.map((r) => ({ ...r, legendary: !!r.legendary, scores: JSON.parse(r.scores) })));
    }

    if (url.pathname === "/api/sessions" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Плохой JSON" }, 400); }
      const p = parseSession(body);
      if (p.error) return json({ error: p.error }, 400);
      const id = crypto.randomUUID();
      const r = p.row;
      await env.DB.prepare(
        "INSERT INTO sessions (id, at, strain, method, legendary, scores, banal, text, del_hash) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(id, r.at, r.strain, r.method, r.legendary, r.scores, r.banal, r.text, await sha256(p.delToken)).run();
      return json({ id }, 201);
    }

    const m = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})$/);
    if (m && request.method === "DELETE") {
      const token = request.headers.get("x-del-token") || "";
      const { meta } = await env.DB.prepare("DELETE FROM sessions WHERE id = ? AND del_hash = ?")
        .bind(m[1], await sha256(token)).run();
      return meta.changes ? json({ ok: true }) : json({ error: "Удалить может только тот, кто записал, с того же браузера" }, 403);
    }

    return json({ error: "Не найдено" }, 404);
  },
};
