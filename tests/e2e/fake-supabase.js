// Supabase falso em memória para os testes no navegador: autenticação por senha e a tabela study_profiles
// com a mesma semântica do PostgREST usada pelo app (select, upsert e update condicional com filtros).
const ORIGIN = "https://fake.supabase.test";
const ANON_KEY = "anon-key-falsa-para-testes-0123456789";

let lastStampMs = 0;
/**
 * Imita o gatilho set_study_profiles_updated_at do schema: toda gravação recebe o relógio do SERVIDOR
 * (estritamente crescente) com microssegundos e +00:00, ignorando o horário que o cliente mandou.
 */
function serverStamp() {
  lastStampMs = Math.max(Date.now(), lastStampMs + 1);
  return new Date(lastStampMs).toISOString().replace("Z", `${String(lastStampMs % 997).padStart(3, "0")}+00:00`);
}

function createFakeSupabase() {
  const users = new Map();
  const tokens = new Map();
  const rows = new Map();
  const stats = { patches: 0, conflicts: 0, upserts: 0, selects: 0, failed: 0 };
  const storage = new Map(); // "<user_id>/<id>" -> { type, buffer }
  const history = []; // study_profiles_history: { id, user_id, state, kind, saved_at }
  const server = { origin: ORIGIN, anonKey: ANON_KEY, users, rows, stats, storage, history, failing: false, storageFailing: false, bucketMissing: false, historyMissing: false, historyGapMs: 0, counter: 0 };

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type, prefer, x-client-info, x-supabase-api-version, x-upsert",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "content-range",
  };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

  function session(user) {
    server.counter += 1;
    const token = `tok-${server.counter}-${Math.random().toString(16).slice(2)}`;
    tokens.set(token, user);
    return { access_token: token, refresh_token: `ref-${server.counter}`, token_type: "bearer", expires_in: 3600, user: { id: user.id, email: user.email, user_metadata: {} } };
  }

  function userFrom(request) {
    const header = request.headers()["authorization"] || "";
    return tokens.get(header.replace(/^Bearer\s+/i, "")) || null;
  }

  function project(row, select) {
    if (!select || select === "*") return row;
    const out = {};
    select.split(",").forEach((column) => {
      if (column in row) out[column] = row[column];
    });
    return out;
  }

  server.install = async (context, { supabaseConfig = true } = {}) => {
    if (supabaseConfig) {
      await context.route("**/supabase-config.js*", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `globalThis.ESTUDOS_TRACK_SUPABASE = { url: "${ORIGIN}", anonKey: "${ANON_KEY}", table: "study_profiles", vapidPublicKey: "" };`,
        })
      );
    }
    await context.route(`${ORIGIN}/**`, async (route, request) => {
      const url = new URL(request.url());
      const method = request.method();
      if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

      // Storage: bucket privado erro-prints, com a mesma regra de pasta por usuário das políticas do SQL.
      if (url.pathname.startsWith("/storage/v1/")) {
        const user = userFrom(request);
        if (!user) return json(route, 401, { message: "JWT inválido" });
        if (server.storageFailing) return route.abort("internetdisconnected");
        if (server.bucketMissing) return json(route, 404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
        const own = (key) => key.startsWith(`${user.id}/`);
        const match = /^\/storage\/v1\/object\/(?:authenticated\/)?erro-prints\/(.+)$/.exec(url.pathname);
        if (match && method === "POST") {
          if (!own(match[1])) return json(route, 403, { message: "new row violates row-level security policy" });
          storage.set(match[1], { type: request.headers()["content-type"] || "image/webp", buffer: request.postDataBuffer() });
          stats.uploads = (stats.uploads || 0) + 1;
          return json(route, 200, { Key: `erro-prints/${match[1]}` });
        }
        if (match && method === "GET") {
          const file = storage.get(match[1]);
          if (!own(match[1]) || !file) return json(route, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
          stats.downloads = (stats.downloads || 0) + 1;
          return route.fulfill({ status: 200, headers: { ...cors, "content-type": file.type }, body: file.buffer });
        }
        if (match && method === "DELETE") {
          if (!own(match[1])) return json(route, 403, { message: "forbidden" });
          storage.delete(match[1]);
          return json(route, 200, { message: "Successfully deleted" });
        }
        if (url.pathname === "/storage/v1/object/list/erro-prints" && method === "POST") {
          const prefix = JSON.parse(request.postData() || "{}").prefix || "";
          const names = [...storage.keys()].filter((key) => own(key) && key.startsWith(`${prefix}/`)).map((key) => ({ name: key.slice(prefix.length + 1) }));
          return json(route, 200, names);
        }
        if (url.pathname === "/storage/v1/object/erro-prints" && method === "DELETE") {
          (JSON.parse(request.postData() || "{}").prefixes || []).filter(own).forEach((key) => storage.delete(key));
          return json(route, 200, []);
        }
        return json(route, 404, { message: `rota de storage não simulada: ${method} ${url.pathname}` });
      }

      const body = request.postData() ? JSON.parse(request.postData()) : null;

      if (url.pathname === "/auth/v1/signup" && method === "POST") {
        if (users.has(body.email)) return json(route, 422, { code: 422, msg: "User already registered" });
        const user = { id: `user-${users.size + 1}`, email: body.email, password: body.password };
        users.set(body.email, user);
        return json(route, 200, session(user));
      }
      if (url.pathname === "/auth/v1/token" && method === "POST") {
        const user = users.get(body.email);
        if (!user || user.password !== body.password) return json(route, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return json(route, 200, session(user));
      }
      if (url.pathname === "/auth/v1/user") {
        const user = userFrom(request);
        return user ? json(route, 200, { id: user.id, email: user.email, user_metadata: {} }) : json(route, 401, { msg: "invalid token" });
      }
      if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: cors });

      if (url.pathname === "/rest/v1/study_profiles") {
        if (server.failing) {
          stats.failed += 1;
          return json(route, 503, { message: "Serviço indisponível (simulado)" });
        }
        const user = userFrom(request);
        if (!user) return json(route, 401, { message: "JWT inválido" });
        const filters = {};
        for (const [key, value] of url.searchParams) {
          if (value.startsWith("eq.")) filters[key] = value.slice(3);
        }
        const select = url.searchParams.get("select");
        if (method === "GET") {
          stats.selects += 1;
          const row = rows.get(user.id);
          const match = row && (!filters.user_id || filters.user_id === user.id) ? [project(row, select)] : [];
          return json(route, 200, match);
        }
        if (method === "POST") {
          if (body.user_id !== user.id) return json(route, 403, { message: "violação de política de segurança (RLS)" });
          stats.upserts += 1;
          rows.set(user.id, { ...body, updated_at: serverStamp() });
          return route.fulfill({ status: 201, headers: cors, body: "" });
        }
        if (method === "PATCH") {
          stats.patches += 1;
          const row = rows.get(user.id);
          const matches = row && filters.user_id === user.id && (!filters.updated_at || Date.parse(filters.updated_at) === Date.parse(row.updated_at));
          if (!matches) {
            stats.conflicts += 1;
            return json(route, 200, []);
          }
          const updated = { ...row, ...body, updated_at: serverStamp() };
          // gatilho snapshot_study_profile: guarda a versão anterior (no máximo uma "auto" por janela)
          const oldState = row.state;
          const hasOld = oldState && Object.keys(oldState).length > 0;
          const changed = JSON.stringify(oldState) !== JSON.stringify(updated.state);
          const lastAuto = [...history].reverse().find((h) => h.user_id === user.id && h.kind === "auto");
          if (hasOld && changed && (!lastAuto || Date.now() - Date.parse(lastAuto.saved_at) >= server.historyGapMs)) {
            history.push({ id: history.length + 1, user_id: user.id, state: JSON.parse(JSON.stringify(oldState)), kind: "auto", saved_at: new Date().toISOString() });
          }
          rows.set(user.id, updated);
          return json(route, 200, [project(updated, select)]);
        }
      }
      if (url.pathname === "/rest/v1/study_profiles_history") {
        if (server.historyMissing) return json(route, 404, { code: "PGRST205", message: "Could not find the table 'public.study_profiles_history' in the schema cache" });
        const user = userFrom(request);
        if (!user) return json(route, 401, { message: "JWT inválido" });
        const filters = {};
        for (const [key, value] of url.searchParams) if (value.startsWith("eq.")) filters[key] = value.slice(3);
        const mine = () => history.filter((h) => h.user_id === user.id && (!filters.user_id || filters.user_id === user.id) && (!filters.id || String(h.id) === filters.id));
        if (method === "GET") {
          let list = mine().sort((a, b) => Date.parse(b.saved_at) - Date.parse(a.saved_at) || b.id - a.id);
          if (url.searchParams.get("order") === "saved_at.asc") list = list.reverse();
          const limit = Number(url.searchParams.get("limit")) || 0;
          if (limit) list = list.slice(0, limit);
          return json(route, 200, list.map((h) => project(h, url.searchParams.get("select"))));
        }
        if (method === "POST") {
          // política de insert: só do próprio usuário e só cópias "antes-de-restaurar"
          if (body.user_id !== user.id || body.kind !== "antes-de-restaurar") return json(route, 403, { message: "new row violates row-level security policy" });
          history.push({ id: history.length + 1, user_id: user.id, state: body.state, kind: body.kind, saved_at: new Date().toISOString() });
          return route.fulfill({ status: 201, headers: cors, body: "" });
        }
        if (method === "DELETE") {
          for (let i = history.length - 1; i >= 0; i -= 1) if (history[i].user_id === user.id) history.splice(i, 1);
          return route.fulfill({ status: 204, headers: cors });
        }
      }
      return json(route, 404, { message: `rota não simulada: ${method} ${url.pathname}` });
    });
  };

  /** Estado salvo da conta (ou null). */
  server.savedState = (email) => {
    const user = users.get(email);
    return user && rows.get(user.id) ? rows.get(user.id).state : null;
  };
  return server;
}

module.exports = { createFakeSupabase, ANON_KEY, ORIGIN };
