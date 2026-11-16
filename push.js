/*
 * Push real (Web Push) via Supabase: inscrição do aparelho e envio do resumo diário ao servidor.
 * Carregado depois do hoje.js e antes do app.js. A função send-reminders (supabase/functions) lê o
 * resumo e avisa no horário escolhido, mesmo com o site fechado. Veja PUSH-SETUP.md.
 */

const PUSH_FLAG_PREFIX = "ymEstudos.push.";
const PUSH_HORIZON_DAYS = 30;
const PUSH_SYNC_DELAY_MS = 4000;

let pushSyncTimer = 0;

function pushConfig() {
  const config = globalThis.ESTUDOS_TRACK_SUPABASE || {};
  return {
    url: String(config.url || "").trim().replace(/\/+$/, ""),
    anonKey: String(config.anonKey || "").trim(),
    vapidKey: String(config.vapidPublicKey || "").trim(),
  };
}

function pushBase64ToBytes(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function pushTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

/* ---------- resumo diário (puro) ---------- */

/**
 * O que vence em cada um dos próximos dias. Revisões e erros são cumulativos ("tudo que já
 * venceu até aquele dia"), o que vale se você não abrir o app; ao abrir, o resumo é reenviado.
 */
function buildPushDigest({ revisions, errors, lawPlans, flashDue = 0, times, today, tz, horizonDays = PUSH_HORIZON_DAYS, now = new Date() }) {
  const pending = revisions.filter((revision) => revision.status === "pending");
  const openErrors = errors.filter((entry) => !entry.mastered && entry.dueDate);
  const lawByDate = {};
  lawPlans.forEach((plan) => {
    const info = buildLawSchedule(plan, today);
    info.rows.forEach((row) => {
      if (row.date === today && info.readToday >= info.todayTarget) return; // meta de hoje já cumprida
      (lawByDate[row.date] = lawByDate[row.date] || []).push(row.label);
    });
  });
  const days = {};
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = cycleAddDays(today, offset);
    const laws = lawByDate[date] || [];
    days[date] = {
      rev: pending.filter((revision) => revision.dueDate <= date).length,
      revOverdue: pending.filter((revision) => revision.dueDate < date).length,
      err: openErrors.filter((entry) => entry.dueDate <= date).length,
      fc: flashDue,
      law: laws.length ? `${laws[0]}${laws.length > 1 ? ` (+${laws.length - 1})` : ""}` : "",
    };
  }
  return { v: 1, generatedAt: now.toISOString(), today, tz, times, days };
}

function pushDigestFromState() {
  ensureCycleState();
  const settings = state.cycleSettings;
  return buildPushDigest({
    revisions: state.revisions,
    errors: state.errorNotebook,
    lawPlans: state.lawPlans,
    flashDue: typeof getFlashDueCount === "function" ? getFlashDueCount() : 0,
    times: [settings.reminderTime, settings.eveningTime].filter(Boolean),
    today: cycleToday(),
    tz: pushTimeZone(),
  });
}

/* ---------- sessão e chamadas ao Supabase ---------- */

async function pushSession() {
  const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
  if (!client?.auth?.getSession) return null;
  try {
    const { data } = await client.auth.getSession();
    const session = data?.session;
    return session?.access_token && session.user?.id ? session : null;
  } catch {
    return null;
  }
}

async function pushRest(path, { method = "POST", body, prefer = "", session }) {
  const config = pushConfig();
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => "")}`.trim());
}

function pushFlagKey(userId) {
  return `${PUSH_FLAG_PREFIX}${userId}`;
}

function pushFlagRead(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(pushFlagKey(userId)) || "{}");
    return { endpoint: typeof raw.endpoint === "string" ? raw.endpoint : "" };
  } catch {
    return { endpoint: "" };
  }
}

function pushFlagWrite(userId, flag) {
  try {
    if (flag?.endpoint) localStorage.setItem(pushFlagKey(userId), JSON.stringify({ endpoint: flag.endpoint }));
    else localStorage.removeItem(pushFlagKey(userId));
  } catch {
    /* sem armazenamento: o app apenas não lembra que o push está ativo */
  }
}

function pushSupported() {
  return typeof Notification !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window;
}

async function pushStatus() {
  const config = pushConfig();
  if (!config.vapidKey) {
    return { code: "unconfigured", text: "O push com o site fechado ainda não foi configurado neste site. Veja o PUSH-SETUP.md." };
  }
  if (!pushSupported()) {
    return { code: "unsupported", text: "Este navegador não oferece push. No iPhone, instale o site na Tela de Início." };
  }
  const session = await pushSession();
  if (!session) return { code: "offline", text: "Entre com sua conta online (aba Conta) para ativar o push." };
  if (Notification.permission === "denied") {
    return { code: "blocked", text: "As notificações estão bloqueadas neste navegador. Libere nas configurações do site e tente de novo." };
  }
  if (pushFlagRead(session.user.id).endpoint) {
    return { code: "active", text: "Push ativo neste aparelho: o aviso chega mesmo com o site fechado." };
  }
  return { code: "inactive", text: "Push desativado neste aparelho." };
}

async function renderPushPanel() {
  const status = $("#pushStatus");
  if (!status) return;
  const info = await pushStatus();
  status.textContent = info.text;
  status.className = `reminder-status tone-${info.code === "active" ? "good" : ["blocked", "unsupported", "unconfigured"].includes(info.code) ? "bad" : "warn"}`;
  const toggle = $("#pushToggleBtn");
  const test = $("#pushTestBtn");
  if (toggle) {
    toggle.textContent = info.code === "active" ? "Desativar push" : "Ativar push neste aparelho";
    toggle.disabled = !["active", "inactive", "blocked"].includes(info.code);
  }
  if (test) test.disabled = info.code !== "active";
}

/* ---------- ativar, desativar, testar ---------- */

async function pushSaveSubscription(subscription, session) {
  const json = subscription.toJSON();
  await pushRest("push_subscriptions?on_conflict=user_id,endpoint", {
    prefer: "resolution=merge-duplicates,return=minimal",
    session,
    body: {
      user_id: session.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh || "",
      auth: json.keys?.auth || "",
      user_agent: String(navigator.userAgent || "").slice(0, 200),
      updated_at: new Date().toISOString(),
    },
  });
}

async function pushEnable() {
  try {
    const info = await pushStatus();
    if (!["inactive", "active", "blocked"].includes(info.code)) {
      showToast(info.text);
      return false;
    }
    let permission = Notification.permission;
    if (permission !== "granted") permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("As notificações estão bloqueadas neste navegador. Libere nas configurações do site.");
      return false;
    }
    const session = await pushSession();
    const registration = await navigator.serviceWorker.ready;
    const options = { userVisibleOnly: true, applicationServerKey: pushBase64ToBytes(pushConfig().vapidKey) };
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe(options);
    }
    await pushSaveSubscription(subscription, session);
    pushFlagWrite(session.user.id, { endpoint: subscription.endpoint });
    await pushSyncDigest({ force: true });
    await renderPushPanel();
    showToast("Push ativado neste aparelho. Use \"Testar push\" para confirmar.");
    return true;
  } catch (error) {
    console.warn("Falha ao ativar o push:", error);
    showToast(`Não foi possível ativar o push: ${error?.message || error}`);
    return false;
  }
}

async function pushDisable() {
  try {
    const session = await pushSession();
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && session) {
      await pushRest(`push_subscriptions?user_id=eq.${encodeURIComponent(session.user.id)}&endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE", session }).catch(() => {});
    }
    if (subscription) await subscription.unsubscribe();
    if (session) pushFlagWrite(session.user.id, { endpoint: "" });
    cycleUI.pushDigestHash = "";
    await renderPushPanel();
    showToast("Push desativado neste aparelho.");
    return true;
  } catch (error) {
    console.warn("Falha ao desativar o push:", error);
    showToast(`Não foi possível desativar o push: ${error?.message || error}`);
    return false;
  }
}

async function pushTest() {
  try {
    const session = await pushSession();
    if (!session) {
      showToast("Entre com sua conta online para testar o push.");
      return false;
    }
    await pushSyncDigest({ force: true });
    const config = pushConfig();
    const response = await fetch(`${config.url}/functions/v1/send-reminders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 && !data.error) {
      showToast("A função send-reminders não foi encontrada no Supabase. Veja o PUSH-SETUP.md.");
      return false;
    }
    if (!response.ok) {
      showToast(data.error || `O teste falhou (${response.status}).`);
      return false;
    }
    showToast(data.sent > 0 ? `Push de teste enviado para ${cyclePlural(data.sent, "aparelho", "aparelhos")}. Deve chegar em alguns segundos.` : "O serviço de push recusou o envio. Veja os logs da função.");
    return data.sent > 0;
  } catch (error) {
    console.warn("Falha no teste de push:", error);
    showToast(`O teste de push falhou: ${error?.message || error}`);
    return false;
  }
}

/* ---------- sincronização do resumo ---------- */

async function pushSyncDigest({ force = false } = {}) {
  try {
    const session = await pushSession();
    if (!session) return false;
    if (!pushFlagRead(session.user.id).endpoint) return false;
    const digest = pushDigestFromState();
    const hash = JSON.stringify({ ...digest, generatedAt: "" });
    if (!force && hash === cycleUI.pushDigestHash) return false;
    await pushRest("reminder_digests?on_conflict=user_id", {
      prefer: "resolution=merge-duplicates,return=minimal",
      session,
      body: { user_id: session.user.id, digest, tz: digest.tz, updated_at: new Date().toISOString() },
    });
    cycleUI.pushDigestHash = hash;
    return true;
  } catch (error) {
    console.warn("Falha ao sincronizar o resumo do push:", error);
    return false;
  }
}

/** Agrupa as mudanças: o resumo só é enviado depois de alguns segundos sem alterações. */
function pushScheduleSync() {
  if (typeof window === "undefined") return;
  window.clearTimeout(pushSyncTimer);
  pushSyncTimer = window.setTimeout(() => {
    pushEnsureSubscription().then(() => pushSyncDigest());
  }, PUSH_SYNC_DELAY_MS);
}

/** O navegador pode trocar a inscrição (endpoint) sozinho: confere uma vez por abertura. */
async function pushEnsureSubscription() {
  if (cycleUI.pushEnsured || !pushSupported() || !pushConfig().vapidKey) return;
  const session = await pushSession();
  if (!session) return;
  const flag = pushFlagRead(session.user.id);
  if (!flag.endpoint || Notification.permission !== "granted") return;
  cycleUI.pushEnsured = true;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushBase64ToBytes(pushConfig().vapidKey) });
    if (subscription.endpoint !== flag.endpoint) {
      await pushSaveSubscription(subscription, session);
      pushFlagWrite(session.user.id, { endpoint: subscription.endpoint });
    }
  } catch (error) {
    console.warn("Não foi possível renovar a inscrição de push:", error);
  }
}

function handlePushAction(type) {
  if (type === "pushToggle") {
    pushStatus().then((info) => (info.code === "active" ? pushDisable() : pushEnable()));
    return true;
  }
  if (type === "pushTest") {
    pushTest();
    return true;
  }
  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildPushDigest, pushBase64ToBytes };
}
