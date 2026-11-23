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
  const server = { origin: ORIGIN, anonKey: ANON_KEY, users, rows, stats, failing: false, counter: 0 };

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type, prefer, x-client-info, x-supabase-api-version",
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
          rows.set(user.id, updated);
          return json(route, 200, [project(updated, select)]);
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
