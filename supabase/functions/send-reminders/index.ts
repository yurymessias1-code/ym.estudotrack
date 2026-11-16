// Supabase Edge Function: envia os lembretes de revisão por Web Push, mesmo com o site fechado.
// Chamada a cada 5 minutos pelo pg_cron (cabeçalho x-cron-secret) e pelo botão "Testar push" do app
// (token do usuário). Veja PUSH-SETUP.md.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { digestDay, dueSlots, localParts, markSent, messageFor } from "../_shared/reminder-core.mjs";

const env = (name: string): string => Deno.env.get(name) ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = env("VAPID_PUBLIC_KEY");
  const vapidPrivate = env("VAPID_PRIVATE_KEY");
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return json({ error: "Faltam segredos da função (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY). Veja o PUSH-SETUP.md." }, 500);
  }
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", vapidPublic, vapidPrivate);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Quem chama: o agendador (segredo compartilhado) ou um usuário logado (só para teste).
  const cronSecret = env("CRON_SECRET");
  const isCron = cronSecret !== "" && req.headers.get("x-cron-secret") === cronSecret;
  let onlyUser = "";
  if (!isCron) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Não autorizado." }, 401);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json({ error: "Sessão inválida." }, 401);
    if (!body?.test) return json({ error: "Envie { \"test\": true } para testar." }, 400);
    onlyUser = data.user.id;
  }

  const subsQuery = admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
  const { data: subs, error: subsError } = onlyUser ? await subsQuery.eq("user_id", onlyUser) : await subsQuery;
  if (subsError) return json({ error: subsError.message }, 500);
  const subsByUser = new Map<string, any[]>();
  for (const sub of subs ?? []) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  const digestQuery = admin.from("reminder_digests").select("user_id, digest, tz, last_sent");
  const { data: digests, error: digestError } = onlyUser ? await digestQuery.eq("user_id", onlyUser) : await digestQuery;
  if (digestError) return json({ error: digestError.message }, 500);

  async function sendToAll(userSubs: any[], payload: unknown) {
    let sent = 0;
    let failed = 0;
    const gone: string[] = [];
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 6 * 3600, urgency: "normal" },
        );
        sent += 1;
      } catch (error: any) {
        failed += 1;
        if (error?.statusCode === 404 || error?.statusCode === 410) gone.push(sub.id);
        else console.error("push falhou", error?.statusCode, error?.body ?? error?.message);
      }
    }
    if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
    return { sent, failed, removed: gone.length };
  }

  const now = Date.now();

  // ---- teste: manda agora para os aparelhos do próprio usuário
  if (onlyUser) {
    const userSubs = subsByUser.get(onlyUser) ?? [];
    if (!userSubs.length) return json({ error: "Nenhum aparelho com push ativo para esta conta." }, 404);
    const row = (digests ?? [])[0];
    const local = localParts(now, row?.tz);
    const message = messageFor(digestDay(row?.digest, local.date)) ?? {
      title: "Push funcionando",
      body: "Seus lembretes de revisão vão chegar neste aparelho, mesmo com o site fechado.",
    };
    const result = await sendToAll(userSubs, { ...message, tag: "estudos-track-revisao", view: "revisao" });
    return json({ ok: true, test: true, ...result });
  }

  // ---- agendamento: horário de cada usuário no fuso dele
  let users = 0;
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const row of digests ?? []) {
    const userSubs = subsByUser.get(row.user_id) ?? [];
    if (!userSubs.length) continue;
    const local = localParts(now, row.tz);
    const slots = dueSlots({ times: row.digest?.times ?? [], last: row.last_sent ?? {}, local });
    if (!slots.length) continue;
    const message = messageFor(digestDay(row.digest, local.date));
    if (!message) continue;
    const result = await sendToAll(userSubs, { ...message, tag: "estudos-track-revisao", view: "revisao" });
    users += 1;
    sent += result.sent;
    failed += result.failed;
    removed += result.removed;
    if (result.sent > 0) {
      await admin.from("reminder_digests").update({ last_sent: markSent(row.last_sent, slots, local.date) }).eq("user_id", row.user_id);
    }
  }
  return json({ ok: true, users, sent, failed, removed });
});
