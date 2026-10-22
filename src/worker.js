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

const keyOf = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

// id накурок данного сорта; lower() в SQLite не знает кириллицу, поэтому сравниваем в JS
async function sessionIdsOf(env, key) {
  const { results } = await env.DB.prepare("SELECT id, strain FROM sessions").all();
  return results.filter((r) => keyOf(r.strain) === key).map((r) => r.id);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseSession(body, needToken = true) {
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
  if (needToken && delToken.length < 16) return { error: "Нет токена удаления" };
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

    if (url.pathname === "/api/strains" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT name FROM strains ORDER BY name LIMIT 2000").all();
      return json(results.map((r) => r.name));
    }

    if (url.pathname === "/api/strains" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Плохой JSON" }, 400); }
      const name = str(body.name, 80);
      if (!name) return json({ error: "Нужно название" }, 400);
      const key = keyOf(name);
      await env.DB.prepare("INSERT OR IGNORE INTO strains (key, name) VALUES (?, ?)").bind(key, name).run();
      return json({ ok: true }, 201);
    }

    // Переименовать сорт (заодно во всех накурках) — может любой, авторов нет.
    if (url.pathname === "/api/strains" && request.method === "PATCH") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Плохой JSON" }, 400); }
      const from = keyOf(str(body.from, 200)), to = str(body.to, 80);
      if (!from || !to) return json({ error: "Нужно старое и новое название" }, 400);
      const ids = await sessionIdsOf(env, from);
      await env.DB.batch([
        ...ids.map((id) => env.DB.prepare("UPDATE sessions SET strain = ? WHERE id = ?").bind(to, id)),
        env.DB.prepare("DELETE FROM strains WHERE key = ?").bind(from),
        env.DB.prepare("INSERT OR REPLACE INTO strains (key, name) VALUES (?, ?)").bind(keyOf(to), to),
      ]);
      return json({ ok: true, renamed: ids.length });
    }

    // Удалить можно только сорт без накурок, чтобы не снести чужие записи.
    if (url.pathname === "/api/strains" && request.method === "DELETE") {
      const key = keyOf(str(url.searchParams.get("name"), 200));
      if (!key) return json({ error: "Нужно название" }, 400);
      if ((await sessionIdsOf(env, key)).length) return json({ error: "У сорта есть накурки, удалить нельзя" }, 409);
      await env.DB.prepare("DELETE FROM strains WHERE key = ?").bind(key).run();
      return json({ ok: true });
    }

    const m = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})$/);
    if (m && request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Плохой JSON" }, 400); }
      const p = parseSession(body, false);
      if (p.error) return json({ error: p.error }, 400);
      const r = p.row;
      const { meta } = await env.DB.prepare(
        "UPDATE sessions SET at = ?, strain = ?, method = ?, legendary = ?, scores = ?, banal = ?, text = ? WHERE id = ? AND del_hash = ?"
      ).bind(r.at, r.strain, r.method, r.legendary, r.scores, r.banal, r.text, m[1], await sha256(request.headers.get("x-del-token") || "")).run();
      return meta.changes ? json({ ok: true }) : json({ error: "Изменить может только тот, кто записал, с того же браузера" }, 403);
    }

    if (m && request.method === "DELETE") {
      const token = request.headers.get("x-del-token") || "";
      const { meta } = await env.DB.prepare("DELETE FROM sessions WHERE id = ? AND del_hash = ?")
        .bind(m[1], await sha256(token)).run();
      return meta.changes ? json({ ok: true }) : json({ error: "Удалить может только тот, кто записал, с того же браузера" }, 403);
    }

    return json({ error: "Не найдено" }, 404);
  },
};
