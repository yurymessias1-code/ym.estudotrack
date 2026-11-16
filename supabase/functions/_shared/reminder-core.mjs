// Lógica pura dos lembretes por push. Não usa APIs do Deno: roda na função send-reminders
// e é testada em Node (tests/push-tests.js). O texto da mensagem espelha o do app (cycleReminderMessage).

export const SLOT_WINDOW_MIN = 180; // um aviso atrasado ainda sai até 3 h depois do horário
export const STALE_AFTER_DAYS = 14; // sem abrir o app por mais de 14 dias além do resumo: para de insistir

const pad = (n) => String(n).padStart(2, "0");

export function parseHHMM(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function validTimeZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Data (AAAA-MM-DD) e minutos do dia no fuso `tz`. Fuso inválido cai para America/Sao_Paulo. */
export function localParts(nowMs, tz) {
  const zone = validTimeZone(tz) ? tz : "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: hour * 60 + minute, hhmm: `${pad(hour)}:${pad(minute)}`, tz: zone };
}

export function addDays(iso, days) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Horários configurados que já passaram hoje (dentro da janela) e ainda não foram enviados hoje. */
export function dueSlots({ times = [], last = {}, local, windowMin = SLOT_WINDOW_MIN }) {
  return (times || []).filter((slot) => {
    const at = parseHHMM(slot);
    if (at === null) return false;
    if (local.minutes < at || local.minutes > at + windowMin) return false;
    return !last || last[slot] !== local.date;
  });
}

/**
 * Linha do resumo para a data local. Depois do fim do resumo, o último dia vale (os vencidos
 * só acumulam), até STALE_AFTER_DAYS dias. Antes do início, não há dado confiável.
 */
export function digestDay(digest, date) {
  const days = digest && typeof digest.days === "object" && digest.days ? digest.days : {};
  if (days[date]) return days[date];
  const keys = Object.keys(days).sort();
  if (!keys.length) return null;
  const lastKey = keys[keys.length - 1];
  if (date > lastKey && date <= addDays(lastKey, STALE_AFTER_DAYS)) return days[lastKey];
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function messageFor(day) {
  if (!day) return null;
  const rev = Number(day.rev) || 0;
  const over = Number(day.revOverdue) || 0;
  const err = Number(day.err) || 0;
  const fc = Number(day.fc) || 0;
  const law = typeof day.law === "string" ? day.law : "";
  const parts = [];
  if (rev) parts.push(`${plural(rev, "revisão", "revisões")}${over ? ` (${plural(over, "atrasada", "atrasadas")})` : ""}`);
  if (fc) parts.push(plural(fc, "flashcard", "flashcards"));
  if (err) parts.push(`${plural(err, "erro", "erros")} para refazer`);
  if (law) parts.push(`Lei seca: ${law}`);
  if (!parts.length) return null;
  return {
    title: over ? "Revisões atrasadas: não deixe o conteúdo esfriar" : "Hora de revisar",
    body: parts.join(" · "),
  };
}

export function markSent(last, slots, date) {
  const next = { ...(last || {}) };
  slots.forEach((slot) => {
    next[slot] = date;
  });
  return next;
}
