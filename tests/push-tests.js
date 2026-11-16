const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");
const json = (value) => JSON.stringify(value);
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FALHOU: ${name}`);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Contexto do navegador simulado (ciclo.js + hoje.js + push.js)       */
/* ------------------------------------------------------------------ */

function makeBrowser({ vapid = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", session = true, permission = "default" } = {}) {
  const calls = [];
  const toasts = [];
  const store = new Map();
  const registration = {
    pushManager: {
      sub: null,
      subscribeOptions: null,
      async getSubscription() {
        return this.sub;
      },
      async subscribe(options) {
        this.subscribeOptions = options;
        this.sub = makeSubscription("https://push.example/abc");
        return this.sub;
      },
    },
  };
  function makeSubscription(endpoint) {
    return {
      endpoint,
      unsubscribed: false,
      toJSON() {
        return { endpoint, keys: { p256dh: "P-KEY", auth: "A-KEY" } };
      },
      async unsubscribe() {
        this.unsubscribed = true;
        registration.pushManager.sub = null;
        return true;
      },
    };
  }
  const Notification = {
    permission,
    async requestPermission() {
      Notification.permission = "granted";
      return "granted";
    },
  };
  const sandbox = {
    console: { ...console, warn: () => {} },
    TextEncoder,
    atob,
    Intl,
    Date,
    JSON,
    Uint8Array,
    PushManager: function PushManager() {},
    Notification,
    navigator: { userAgent: "UA-teste", serviceWorker: { ready: Promise.resolve(registration) } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    ESTUDOS_TRACK_SUPABASE: { url: "https://proj.supabase.co", anonKey: "ANON-KEY-LONGA-O-BASTANTE-1234567890", vapidPublicKey: vapid },
    getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: session ? { access_token: "TOKEN-U1", user: { id: "U1" } } : null } }) } }),
    showToast: (message) => toasts.push(message),
    $: () => null,
    $$: () => [],
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      const next = sandbox.__nextFetch || { ok: true, status: 200, body: { sent: 1 } };
      return { ok: next.ok, status: next.status, json: async () => next.body, text: async () => JSON.stringify(next.body) };
    },
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  ["ciclo.js", "hoje.js", "push.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file }));
  ctx.state = { cycleSettings: ctx.normalizeCycleSettings({ reminderTime: "08:00", eveningTime: "19:00" }), revisions: [], errorNotebook: [], lawPlans: [], flashcards: [], profile: { id: "p" } };
  return { ctx, calls, toasts, store, registration, Notification, makeSubscription };
}

(async () => {
  /* ---------- núcleo compartilhado (reminder-core.mjs) ---------- */
  const core = await import(pathToFileURL(path.join(root, "supabase/functions/_shared/reminder-core.mjs")).href);

  await test("núcleo: data e hora local por fuso (inclui virada de dia e fuso inválido)", () => {
    assert.strictEqual(json(core.localParts(Date.UTC(2026, 10, 14, 11, 30), "America/Sao_Paulo")), json({ date: "2026-11-14", minutes: 510, hhmm: "08:30", tz: "America/Sao_Paulo" }));
    const tokyo = core.localParts(Date.UTC(2026, 10, 14, 20, 5), "Asia/Tokyo");
    assert.strictEqual(tokyo.date, "2026-11-15", "Tóquio já está no dia seguinte");
    assert.strictEqual(tokyo.hhmm, "05:05");
    assert.strictEqual(core.localParts(Date.UTC(2026, 10, 14, 11, 30), "Fuso/Invalido").tz, "America/Sao_Paulo");
    assert.strictEqual(core.localParts(Date.UTC(2026, 10, 14, 3, 0), "America/Sao_Paulo").hhmm, "00:00", "meia-noite não vira 24:00");
  });

  await test("núcleo: horários elegíveis respeitam janela e envio do dia", () => {
    const local = (hhmm) => ({ date: "2026-11-14", minutes: core.parseHHMM(hhmm) });
    const times = ["08:00", "19:00"];
    assert.strictEqual(json(core.dueSlots({ times, last: {}, local: local("07:59") })), "[]");
    assert.strictEqual(json(core.dueSlots({ times, last: {}, local: local("08:00") })), json(["08:00"]));
    assert.strictEqual(json(core.dueSlots({ times, last: {}, local: local("10:59") })), json(["08:00"]));
    assert.strictEqual(json(core.dueSlots({ times, last: {}, local: local("11:01") })), "[]", "fora da janela de 3 h");
    assert.strictEqual(json(core.dueSlots({ times, last: { "08:00": "2026-11-14" }, local: local("08:30") })), "[]", "já enviado hoje");
    assert.strictEqual(json(core.dueSlots({ times, last: { "08:00": "2026-11-13" }, local: local("08:30") })), json(["08:00"]), "envio de ontem não vale");
    assert.strictEqual(json(core.dueSlots({ times: ["25:00", "abc", "19:00"], last: {}, local: local("19:10") })), json(["19:00"]), "horário inválido é ignorado");
  });

  await test("núcleo: resumo do dia, acúmulo depois do fim e parada por inatividade", () => {
    const digest = { days: { "2026-11-14": { rev: 1 }, "2026-11-15": { rev: 2 }, "2026-11-16": { rev: 3 } } };
    assert.strictEqual(core.digestDay(digest, "2026-11-15").rev, 2);
    assert.strictEqual(core.digestDay(digest, "2026-11-20").rev, 3, "depois do fim: o último dia acumula");
    assert.strictEqual(core.digestDay(digest, "2026-11-30"), digest.days["2026-11-16"], "14 dias depois ainda vale");
    assert.strictEqual(core.digestDay(digest, "2026-12-01"), null, "mais de 14 dias sem abrir o app: para");
    assert.strictEqual(core.digestDay(digest, "2026-11-13"), null, "antes do resumo: sem dado");
    assert.strictEqual(core.digestDay({}, "2026-11-14"), null);
    assert.strictEqual(core.digestDay(null, "2026-11-14"), null);
    assert.strictEqual(core.addDays("2026-12-31", 1), "2027-01-01");
  });

  const browser = makeBrowser();

  await test("núcleo e app geram exatamente o mesmo texto de lembrete", () => {
    const cases = [
      { rev: 1 }, { rev: 5, revOverdue: 2 }, { err: 1 }, { err: 3, rev: 2 }, { fc: 1 }, { fc: 4, rev: 1, err: 2, revOverdue: 1, law: "artigos 11–20" },
      { law: "artigos 1–10 (+1)" }, { rev: 0, err: 0 }, {},
    ];
    cases.forEach((day) => {
      const a = core.messageFor(day);
      const b = browser.ctx.cycleReminderMessage({ revDue: day.rev, revOverdue: day.revOverdue, errorsDue: day.err, flashDue: day.fc, lawLabel: day.law });
      assert.strictEqual(json(a), json(b), `divergência em ${json(day)}`);
    });
    assert.strictEqual(core.messageFor(null), null);
  });

  /* ---------- resumo diário ---------- */
  await test("resumo: cumulativo por dia, atrasados, erros, lei seca e horizonte", () => {
    const { ctx } = browser;
    const plan = ctx.normalizeLawPlan({ title: "CF", startUnit: 1, endUnit: 100, startDate: "2026-11-09", endDate: "2026-11-18", weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const digest = ctx.buildPushDigest({
      revisions: [
        { status: "pending", dueDate: "2026-11-10" },
        { status: "pending", dueDate: "2026-11-12" },
        { status: "pending", dueDate: "2026-11-14" },
        { status: "done", dueDate: "2026-11-01" },
      ],
      errors: [{ mastered: false, dueDate: "2026-11-12" }, { mastered: true, dueDate: "2026-11-11" }, { mastered: false, dueDate: "" }],
      lawPlans: [plan],
      flashDue: 3,
      times: ["08:00"],
      today: "2026-11-12",
      tz: "America/Sao_Paulo",
      now: new Date(Date.UTC(2026, 10, 12, 12, 0, 0)),
    });
    assert.strictEqual(Object.keys(digest.days).length, 31);
    assert.strictEqual(json(digest.days["2026-11-12"]), json({ rev: 2, revOverdue: 1, err: 1, fc: 3, law: "artigos 1–15" }));
    assert.strictEqual(digest.days["2026-11-13"].rev, 2);
    assert.strictEqual(digest.days["2026-11-13"].revOverdue, 2, "sem fazer nada, as de ontem e de hoje já estariam atrasadas");
    assert.strictEqual(digest.days["2026-11-14"].rev, 3);
    assert.strictEqual(digest.days["2026-12-12"].law, "", "depois do fim do plano não há leitura");
    assert.strictEqual(digest.tz, "America/Sao_Paulo");
    assert.strictEqual(json(digest.times), json(["08:00"]));
    // meta de lei seca de hoje já cumprida some do resumo de hoje
    const read = ctx.normalizeLawPlan({ ...plan, doneWork: 32, readLog: [{ date: "2026-11-12", fromWork: 20, toWork: 32 }] });
    const after = ctx.buildPushDigest({ revisions: [], errors: [], lawPlans: [read], times: [], today: "2026-11-12", tz: "UTC" });
    assert.strictEqual(after.days["2026-11-12"].law, "", "meta de hoje cumprida");
    assert.ok(after.days["2026-11-13"].law.includes("artigos 33"), "amanhã continua de onde parou");
  });

  /* ---------- cliente: ativar, sincronizar, testar, desativar ---------- */
  await test("cliente: status conforme configuração, suporte e sessão", async () => {
    assert.strictEqual((await makeBrowser({ vapid: "" }).ctx.pushStatus()).code, "unconfigured");
    assert.ok((await makeBrowser({ vapid: "" }).ctx.pushStatus()).text.includes("PUSH-SETUP"));
    assert.strictEqual((await makeBrowser({ session: false }).ctx.pushStatus()).code, "offline");
    assert.strictEqual((await makeBrowser({ permission: "denied" }).ctx.pushStatus()).code, "blocked");
    assert.strictEqual((await makeBrowser().ctx.pushStatus()).code, "inactive");
  });

  await test("cliente: ativar inscreve o aparelho e envia o resumo", async () => {
    const b = makeBrowser();
    assert.strictEqual(await b.ctx.pushEnable(), true);
    const opts = b.registration.pushManager.subscribeOptions;
    assert.strictEqual(opts.userVisibleOnly, true);
    assert.strictEqual(opts.applicationServerKey.constructor.name, "Uint8Array");
    assert.strictEqual(opts.applicationServerKey.length, 65, "chave VAPID pública P-256 tem 65 bytes");
    const [sub, digest] = b.calls;
    assert.strictEqual(sub.url, "https://proj.supabase.co/rest/v1/push_subscriptions?on_conflict=user_id,endpoint");
    assert.strictEqual(sub.method, "POST");
    assert.strictEqual(sub.headers.apikey, "ANON-KEY-LONGA-O-BASTANTE-1234567890");
    assert.strictEqual(sub.headers.Authorization, "Bearer TOKEN-U1");
    assert.ok(sub.headers.Prefer.includes("merge-duplicates"));
    assert.strictEqual(sub.body.user_id, "U1");
    assert.strictEqual(sub.body.endpoint, "https://push.example/abc");
    assert.strictEqual(sub.body.p256dh, "P-KEY");
    assert.strictEqual(sub.body.auth, "A-KEY");
    assert.strictEqual(sub.body.user_agent, "UA-teste");
    assert.strictEqual(digest.url, "https://proj.supabase.co/rest/v1/reminder_digests?on_conflict=user_id");
    assert.strictEqual(digest.body.user_id, "U1");
    assert.strictEqual(Object.keys(digest.body.digest.days).length, 31);
    assert.strictEqual(json(digest.body.digest.times), json(["08:00", "19:00"]));
    assert.ok(!("last_sent" in digest.body), "o app não pode sobrescrever last_sent");
    assert.strictEqual((await b.ctx.pushStatus()).code, "active");
    assert.ok(b.store.get("ymEstudos.push.U1").includes("https://push.example/abc"));
  });

  await test("cliente: resumo só é reenviado quando muda", async () => {
    const b = makeBrowser();
    await b.ctx.pushEnable();
    const before = b.calls.length;
    assert.strictEqual(await b.ctx.pushSyncDigest(), false);
    assert.strictEqual(b.calls.length, before, "sem mudança, sem chamada");
    b.ctx.state.revisions.push({ status: "pending", dueDate: "2026-01-01" });
    assert.strictEqual(await b.ctx.pushSyncDigest(), true);
    assert.strictEqual(b.calls.length, before + 1);
    assert.strictEqual(await b.ctx.pushSyncDigest({ force: true }), true, "force sempre envia");
  });

  await test("cliente: sem push ativo ou sem sessão, nada é enviado", async () => {
    const b = makeBrowser();
    assert.strictEqual(await b.ctx.pushSyncDigest(), false, "aparelho sem inscrição");
    const offline = makeBrowser({ session: false });
    assert.strictEqual(await offline.ctx.pushSyncDigest({ force: true }), false);
    assert.strictEqual(b.calls.length + offline.calls.length, 0);
  });

  await test("cliente: permissão negada não inscreve nem chama o servidor", async () => {
    const b = makeBrowser({ permission: "denied" });
    b.Notification.requestPermission = async () => "denied";
    assert.strictEqual(await b.ctx.pushEnable(), false);
    assert.strictEqual(b.calls.length, 0);
    assert.strictEqual(b.registration.pushManager.sub, null);
  });

  await test("cliente: falha do servidor ao salvar é avisada e não deixa o push 'ativo'", async () => {
    const b = makeBrowser();
    b.ctx.__nextFetch = { ok: false, status: 404, body: { message: "relation does not exist" } };
    assert.strictEqual(await b.ctx.pushEnable(), false);
    assert.ok(b.toasts.some((t) => t.includes("Não foi possível ativar o push")));
    assert.strictEqual(b.store.has("ymEstudos.push.U1"), false);
  });

  await test("cliente: desativar apaga a inscrição no servidor e no aparelho", async () => {
    const b = makeBrowser();
    await b.ctx.pushEnable();
    const sub = b.registration.pushManager.sub;
    b.calls.length = 0;
    assert.strictEqual(await b.ctx.pushDisable(), true);
    assert.strictEqual(b.calls[0].method, "DELETE");
    assert.strictEqual(b.calls[0].url, "https://proj.supabase.co/rest/v1/push_subscriptions?user_id=eq.U1&endpoint=eq.https%3A%2F%2Fpush.example%2Fabc");
    assert.strictEqual(sub.unsubscribed, true);
    assert.strictEqual(b.store.has("ymEstudos.push.U1"), false);
    assert.strictEqual((await b.ctx.pushStatus()).code, "inactive");
  });

  await test("cliente: teste chama a função com o token do usuário e interpreta a resposta", async () => {
    const b = makeBrowser();
    await b.ctx.pushEnable();
    b.calls.length = 0;
    b.ctx.__nextFetch = { ok: true, status: 200, body: { ok: true, sent: 1 } };
    assert.strictEqual(await b.ctx.pushTest(), true);
    const call = b.calls.find((c) => c.url.endsWith("/functions/v1/send-reminders"));
    assert.strictEqual(call.url, "https://proj.supabase.co/functions/v1/send-reminders");
    assert.strictEqual(call.headers.Authorization, "Bearer TOKEN-U1");
    assert.strictEqual(json(call.body), json({ test: true }));
    assert.ok(b.toasts.at(-1).includes("1 aparelho"));
    b.ctx.__nextFetch = { ok: false, status: 404, body: {} };
    assert.strictEqual(await b.ctx.pushTest(), false);
    assert.ok(b.toasts.at(-1).includes("send-reminders"), "orienta quando a função não foi implantada");
    b.ctx.__nextFetch = { ok: false, status: 500, body: { error: "Faltam segredos da função" } };
    await b.ctx.pushTest();
    assert.ok(b.toasts.at(-1).includes("Faltam segredos"));
    b.ctx.__nextFetch = { ok: true, status: 200, body: { ok: true, sent: 0, failed: 1 } };
    assert.strictEqual(await b.ctx.pushTest(), false);
    assert.ok(b.toasts.at(-1).includes("recusou"));
  });

  await test("cliente: renova a inscrição quando o navegador troca o endpoint", async () => {
    const b = makeBrowser();
    await b.ctx.pushEnable();
    b.registration.pushManager.sub = b.makeSubscription("https://push.example/NOVO");
    vm.runInContext("cycleUI.pushEnsured = false", b.ctx);
    b.calls.length = 0;
    await b.ctx.pushEnsureSubscription();
    assert.strictEqual(b.calls[0].body.endpoint, "https://push.example/NOVO");
    assert.ok(b.store.get("ymEstudos.push.U1").includes("NOVO"));
    b.calls.length = 0;
    await b.ctx.pushEnsureSubscription();
    assert.strictEqual(b.calls.length, 0, "só confere uma vez por abertura");
  });

  /* ---------- função send-reminders (index.ts executado com stubs) ---------- */
  const { stripTypeScriptTypes } = require("node:module");
  if (typeof stripTypeScriptTypes !== "function") {
    console.warn("Node sem module.stripTypeScriptTypes: testes da função foram pulados.");
  } else {
    const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, "supabase/functions/send-reminders/index.ts"), "utf8"))
      .replace(/import\s+(\w+)\s+from\s+"([^"]+)";/g, 'const $1 = __mods["$2"].default;')
      .replace(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g, 'const {$1} = __mods["$2"];');

    function makeFunction({ env = {}, tables = {}, tokens = {}, failEndpoints = {} } = {}) {
      const db = { tables: JSON.parse(JSON.stringify(tables)), log: [], sent: [] };
      class Query {
        constructor(table) {
          this.table = table;
          this.op = "select";
          this.filters = [];
          this.payload = null;
        }
        select() { this.op = "select"; return this; }
        delete() { this.op = "delete"; return this; }
        update(payload) { this.op = "update"; this.payload = payload; return this; }
        eq(col, val) { this.filters.push((row) => row[col] === val); return this; }
        in(col, vals) { this.filters.push((row) => vals.includes(row[col])); return this; }
        then(resolve, reject) {
          try {
            const rows = db.tables[this.table] || [];
            const hit = rows.filter((row) => this.filters.every((f) => f(row)));
            if (this.op === "delete") {
              db.tables[this.table] = rows.filter((row) => !hit.includes(row));
              db.log.push({ op: "delete", table: this.table, ids: hit.map((r) => r.id) });
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
            if (this.op === "update") {
              hit.forEach((row) => Object.assign(row, this.payload));
              db.log.push({ op: "update", table: this.table, payload: this.payload });
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
            return Promise.resolve({ data: JSON.parse(JSON.stringify(hit)), error: null }).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).catch(reject);
          }
        }
      }
      const mods = {
        "npm:@supabase/supabase-js@2": {
          createClient: () => ({
            from: (table) => new Query(table),
            auth: { getUser: async (token) => (tokens[token] ? { data: { user: { id: tokens[token] } }, error: null } : { data: { user: null }, error: { message: "inválido" } }) },
          }),
        },
        "npm:web-push@3.6.7": {
          default: {
            setVapidDetails: () => {},
            sendNotification: async (sub, payload, options) => {
              if (failEndpoints[sub.endpoint]) {
                const error = new Error("falhou");
                error.statusCode = failEndpoints[sub.endpoint];
                throw error;
              }
              db.sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
            },
          },
        },
        "../_shared/reminder-core.mjs": core,
      };
      let handler = null;
      const Deno = { env: { get: (name) => env[name] }, serve: (h) => { handler = h; } };
      new Function("__mods", "Deno", source)(mods, Deno);
      const call = (init = {}, headers = {}) => handler(new Request("https://fn.test/send-reminders", { method: "POST", body: init === null ? undefined : JSON.stringify(init), headers }));
      return { db, handler, call };
    }

    const ENV = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", CRON_SECRET: "segredo" };
    const CRON = { "x-cron-secret": "segredo" };
    const day = (over = {}) => ({ rev: 3, revOverdue: 1, err: 0, fc: 0, law: "", ...over });
    function digestFor(times, dayData = day(), date = "2026-11-14") {
      return { times, days: { [date]: dayData, "2026-11-15": dayData } };
    }
    const subs = (userId, n) => Array.from({ length: n }, (_, i) => ({ id: `${userId}-s${i}`, user_id: userId, endpoint: `https://push/${userId}/${i}`, p256dh: "p", auth: "a" }));
    const at = (iso) => {
      Date.now = () => Date.parse(iso);
    };
    const realNow = Date.now;
    const restore = () => {
      Date.now = realNow;
    };

    await test("função: recusa chamadas sem credencial, método errado e configuração incompleta", async () => {
      const fn = makeFunction({ env: ENV });
      assert.strictEqual((await fn.handler(new Request("https://fn.test", { method: "GET" }))).status, 405);
      const options = await fn.handler(new Request("https://fn.test", { method: "OPTIONS" }));
      assert.strictEqual(options.status, 200);
      assert.strictEqual(options.headers.get("Access-Control-Allow-Origin"), "*");
      assert.strictEqual((await fn.call({})).status, 401, "sem credencial");
      assert.strictEqual((await fn.call({}, { "x-cron-secret": "errado" })).status, 401, "segredo errado");
      assert.strictEqual((await fn.call({}, { Authorization: "Bearer lixo" })).status, 401, "token inválido");
      const noSecrets = makeFunction({ env: { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" } });
      const response = await noSecrets.call({}, CRON);
      assert.strictEqual(response.status, 500);
      assert.ok((await response.json()).error.includes("VAPID"));
      const noCronConfigured = makeFunction({ env: { ...ENV, CRON_SECRET: "" } });
      assert.strictEqual((await noCronConfigured.call({}, { "x-cron-secret": "" })).status, 401, "sem CRON_SECRET configurado, o cabeçalho vazio não vale como segredo");
    });

    await test("função (cron): envia no horário, para todos os aparelhos, uma vez por horário", async () => {
      const fn = makeFunction({
        env: ENV,
        tables: {
          reminder_digests: [{ user_id: "U1", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00", "19:00"]) }],
          push_subscriptions: subs("U1", 2),
        },
      });
      try {
        at("2026-11-14T10:55:00Z"); // 07:55 em São Paulo
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 0, "antes do horário");
        at("2026-11-14T11:05:00Z"); // 08:05
        const first = await (await fn.call({}, CRON)).json();
        assert.strictEqual(json(first), json({ ok: true, users: 1, sent: 2, failed: 0, removed: 0 }));
        assert.strictEqual(fn.db.sent.length, 2);
        assert.strictEqual(fn.db.sent[0].payload.title, "Revisões atrasadas: não deixe o conteúdo esfriar");
        assert.strictEqual(fn.db.sent[0].payload.body, "3 revisões (1 atrasada)");
        assert.strictEqual(fn.db.sent[0].payload.tag, "estudos-track-revisao");
        assert.strictEqual(fn.db.tables.reminder_digests[0].last_sent["08:00"], "2026-11-14");
        at("2026-11-14T11:10:00Z");
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 0, "o mesmo horário não repete");
        at("2026-11-14T14:30:00Z"); // 11:30: fora da janela de 3 h
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 0, "fora da janela");
        at("2026-11-14T22:05:00Z"); // 19:05
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 2, "o horário da noite é outro envio");
        assert.strictEqual(fn.db.sent.length, 4);
      } finally {
        restore();
      }
    });

    await test("função (cron): nada vencido não envia e não consome o horário", async () => {
      const fn = makeFunction({
        env: ENV,
        tables: {
          reminder_digests: [{ user_id: "U1", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"], day({ rev: 0, revOverdue: 0 })) }],
          push_subscriptions: subs("U1", 1),
        },
      });
      try {
        at("2026-11-14T11:05:00Z");
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 0);
        assert.strictEqual(json(fn.db.tables.reminder_digests[0].last_sent), "{}", "horário continua livre se algo vencer depois");
        fn.db.tables.reminder_digests[0].digest = digestFor(["08:00"], day({ rev: 2, revOverdue: 0 }));
        at("2026-11-14T11:40:00Z");
        const result = await (await fn.call({}, CRON)).json();
        assert.strictEqual(result.sent, 1, "vence depois do horário, dentro da janela: sai");
        assert.strictEqual(fn.db.sent[0].payload.title, "Hora de revisar");
      } finally {
        restore();
      }
    });

    await test("função (cron): cada usuário no seu fuso; sem aparelho ou sem resumo é ignorado", async () => {
      const fn = makeFunction({
        env: ENV,
        tables: {
          reminder_digests: [
            { user_id: "BR", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"]) },
            { user_id: "JP", tz: "Asia/Tokyo", last_sent: {}, digest: digestFor(["20:00"], day(), "2026-11-14") },
            { user_id: "SEMAPARELHO", tz: "UTC", last_sent: {}, digest: digestFor(["11:00"]) },
          ],
          push_subscriptions: [...subs("BR", 1), ...subs("JP", 1), ...subs("SEMRESUMO", 1)],
        },
      });
      try {
        at("2026-11-14T11:05:00Z"); // 08:05 em SP e 20:05 em Tóquio
        const result = await (await fn.call({}, CRON)).json();
        assert.strictEqual(result.users, 2);
        assert.strictEqual(json(fn.db.sent.map((s) => s.endpoint).sort()), json(["https://push/BR/0", "https://push/JP/0"]));
      } finally {
        restore();
      }
    });

    await test("função (cron): inscrição morta (410) é removida; falha total não consome o horário", async () => {
      const fn = makeFunction({
        env: ENV,
        failEndpoints: { "https://push/U1/1": 410, "https://push/U2/0": 500 },
        tables: {
          reminder_digests: [
            { user_id: "U1", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"]) },
            { user_id: "U2", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"]) },
          ],
          push_subscriptions: [...subs("U1", 2), ...subs("U2", 1)],
        },
      });
      try {
        at("2026-11-14T11:05:00Z");
        const result = await (await fn.call({}, CRON)).json();
        assert.strictEqual(result.removed, 1);
        assert.strictEqual(result.sent, 1);
        assert.strictEqual(result.failed, 2);
        assert.strictEqual(json(fn.db.tables.push_subscriptions.map((s) => s.id).sort()), json(["U1-s0", "U2-s0"]), "só a 410 foi apagada");
        assert.strictEqual(fn.db.tables.reminder_digests.find((r) => r.user_id === "U1").last_sent["08:00"], "2026-11-14");
        assert.strictEqual(json(fn.db.tables.reminder_digests.find((r) => r.user_id === "U2").last_sent), "{}", "tudo falhou: tenta de novo na próxima rodada");
      } finally {
        restore();
      }
    });

    await test("função (cron): resumo muito antigo deixa de insistir", async () => {
      const fn = makeFunction({
        env: ENV,
        tables: { reminder_digests: [{ user_id: "U1", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"]) }], push_subscriptions: subs("U1", 1) },
      });
      try {
        at("2026-12-20T11:05:00Z"); // 35 dias depois do resumo
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 0);
        at("2026-11-20T11:05:00Z"); // 5 dias depois: ainda cobra
        assert.strictEqual((await (await fn.call({}, CRON)).json()).sent, 1);
      } finally {
        restore();
      }
    });

    await test("função (teste): manda só para o próprio usuário, exige test:true e avisa quando não há aparelho", async () => {
      const tables = {
        reminder_digests: [
          { user_id: "U1", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"], day({ rev: 4, revOverdue: 0 })) },
          { user_id: "U2", tz: "America/Sao_Paulo", last_sent: {}, digest: digestFor(["08:00"]) },
        ],
        push_subscriptions: [...subs("U1", 2), ...subs("U2", 1)],
      };
      const fn = makeFunction({ env: ENV, tables, tokens: { "TOKEN-U1": "U1", "TOKEN-U3": "U3" } });
      try {
        at("2026-11-14T15:00:00Z");
        const auth = { Authorization: "Bearer TOKEN-U1" };
        assert.strictEqual((await fn.call({}, auth)).status, 400, "usuário comum não dispara o envio geral");
        const response = await fn.call({ test: true }, auth);
        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.strictEqual(json(body), json({ ok: true, test: true, sent: 2, failed: 0, removed: 0 }));
        assert.ok(fn.db.sent.every((s) => s.endpoint.startsWith("https://push/U1/")), "nunca para outro usuário");
        assert.strictEqual(fn.db.sent[0].payload.body, "4 revisões");
        assert.strictEqual(json(fn.db.tables.reminder_digests[0].last_sent), "{}", "teste não consome o horário do dia");
        const none = await fn.call({ test: true }, { Authorization: "Bearer TOKEN-U3" });
        assert.strictEqual(none.status, 404);
        assert.ok((await none.json()).error.includes("Nenhum aparelho"));
      } finally {
        restore();
      }
    });

    await test("função (teste): sem resumo ainda, envia a mensagem genérica de confirmação", async () => {
      const fn = makeFunction({ env: ENV, tables: { reminder_digests: [], push_subscriptions: subs("U1", 1) }, tokens: { T: "U1" } });
      const body = await (await fn.call({ test: true }, { Authorization: "Bearer T" })).json();
      assert.strictEqual(body.sent, 1);
      assert.strictEqual(fn.db.sent[0].payload.title, "Push funcionando");
    });
  }

  console.log(`push-tests: ${passed} testes passaram.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
