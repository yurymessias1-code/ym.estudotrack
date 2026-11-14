const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ console, TextEncoder });
["ciclo.js", "hoje.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), ctx, { filename: file }));

const {
  weekStartISO,
  weightsFromEdital,
  buildWeeklyPlan,
  cycleTopicAccuracy,
  cycleWeakTopics,
  cycleWeakCandidates,
  cycleReasonInsight,
  cycleDayProgress,
  cycleBackupStatus,
  normalizeCycleSettings,
  normalizeWeights,
  normalizeStudyWeekdays,
  cycleReminderMessage,
} = ctx;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FALHOU: ${name}`);
    throw error;
  }
}
const json = (value) => JSON.stringify(value);

const WED = "2026-11-11";
const SUN = "2026-11-15";

/* ---------- configurações ---------- */

test("configurações: novos campos têm padrão e limites", () => {
  const d = normalizeCycleSettings({});
  assert.strictEqual(d.autoWeak, true);
  assert.strictEqual(d.weakAccuracy, 70);
  assert.strictEqual(d.weakMinQuestions, 10);
  assert.strictEqual(d.backupDays, 7);
  assert.strictEqual(json([...d.studyWeekdays]), json([1, 2, 3, 4, 5, 6]));
  assert.strictEqual(json(d.weights), "{}");
  const c = normalizeCycleSettings({ autoWeak: false, weakAccuracy: 5, weakMinQuestions: 9999, backupDays: 0, studyWeekdays: [0, 9, "x"], weights: { a: "3", b: -2, c: 999, "": 4, d: "abc" } });
  assert.strictEqual(c.autoWeak, false);
  assert.strictEqual(c.weakAccuracy, 30);
  assert.strictEqual(c.weakMinQuestions, 100);
  assert.strictEqual(c.backupDays, 0, "0 desliga o lembrete e deve ser preservado");
  assert.strictEqual(json([...c.studyWeekdays]), json([0]));
  assert.strictEqual(json(c.weights), json({ a: 3, b: 0, c: 200 }));
  assert.strictEqual(normalizeCycleSettings({ backupDays: "abc" }).backupDays, 7);
});

test("pesos e dias de estudo: entradas inválidas caem no padrão", () => {
  assert.strictEqual(json(normalizeWeights(null)), "{}");
  assert.strictEqual(json([...normalizeStudyWeekdays([])]), json([1, 2, 3, 4, 5, 6]));
  assert.strictEqual(json([...normalizeStudyWeekdays([3, 3, 1])]), json([3, 1]));
});

/* ---------- semana e pesos do edital ---------- */

test("semana começa na segunda-feira", () => {
  assert.strictEqual(weekStartISO(WED), "2026-11-09");
  assert.strictEqual(weekStartISO(SUN), "2026-11-09");
  assert.strictEqual(weekStartISO("2026-11-09"), "2026-11-09");
  assert.strictEqual(weekStartISO("2027-01-01"), "2026-12-28");
});

test("pesos do edital: igualdade, acento e correspondência parcial inequívoca", () => {
  const subjects = [
    { id: "cf", name: "Direito Constitucional" },
    { id: "adm", name: "Direito Administrativo" },
    { id: "pt", name: "Língua Portuguesa" },
  ];
  const items = [
    { subjectName: "direito constitucional" },
    { subjectName: "DIREITO CONSTITUCIONAL" },
    { subjectName: "Lingua Portuguesa" },
    { subjectName: "Administrativo" }, // parcial, único candidato
    { subjectName: "Direito" }, // ambíguo: casa com duas matérias, ignorado
    { subjectName: "" },
    { subjectName: "Matemática" },
  ];
  assert.strictEqual(json(weightsFromEdital(items, subjects)), json({ cf: 2, pt: 1, adm: 1 }));
});

test("plano semanal: divide a meta pelo peso e a de hoje pelos dias restantes", () => {
  const plan = buildWeeklyPlan({
    subjects: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ],
    weights: { a: 2, b: 1, c: 0 },
    weeklyMinutes: 600,
    weekdays: [1, 2, 3, 4, 5, 6],
    today: WED,
  });
  const a = plan.rows.find((r) => r.subjectId === "a");
  const b = plan.rows.find((r) => r.subjectId === "b");
  const c = plan.rows.find((r) => r.subjectId === "c");
  assert.strictEqual(plan.daysLeft, 4); // qua, qui, sex, sáb
  assert.strictEqual(a.targetMin, 400);
  assert.strictEqual(b.targetMin, 200);
  assert.strictEqual(c.targetMin, 0);
  assert.strictEqual(a.todayTarget, 100);
  assert.strictEqual(b.todayTarget, 50);
  assert.strictEqual(c.todayTarget, 0);
  assert.strictEqual(plan.todayTotal, 150);
  assert.strictEqual(plan.rows[plan.rows.length - 1].subjectId, "c", "matéria sem peso vai para o fim");
});

test("plano semanal: atraso é redistribuído e a meta de hoje não encolhe ao estudar", () => {
  const base = { subjects: [{ id: "a", name: "A" }], weights: { a: 1 }, weeklyMinutes: 600, weekdays: [1, 2, 3, 4, 5, 6], today: WED };
  const behind = buildWeeklyPlan({ ...base, minutesWeek: { a: 0 } });
  assert.strictEqual(behind.rows[0].todayTarget, 150); // 600 / 4 dias
  const ahead = buildWeeklyPlan({ ...base, minutesWeek: { a: 300 } });
  assert.strictEqual(ahead.rows[0].todayTarget, 75); // (600 - 300) / 4
  const studying = buildWeeklyPlan({ ...base, minutesWeek: { a: 330 }, minutesToday: { a: 30 } });
  assert.strictEqual(studying.rows[0].todayTarget, 75, "mesma meta de antes de estudar hoje");
  assert.strictEqual(studying.rows[0].todayPending, 45);
  const done = buildWeeklyPlan({ ...base, minutesWeek: { a: 375 }, minutesToday: { a: 75 } });
  assert.strictEqual(done.rows[0].todayPending, 0);
});

test("plano semanal: dia de folga, meta batida e arredondamento limitado ao que falta", () => {
  const rest = buildWeeklyPlan({ subjects: [{ id: "a", name: "A" }], weights: { a: 1 }, weeklyMinutes: 600, weekdays: [1, 2, 3, 4, 5, 6], today: SUN });
  assert.strictEqual(rest.todayIsStudyDay, false);
  assert.strictEqual(rest.rows[0].todayTarget, 0);
  assert.strictEqual(rest.daysLeft, 0);
  const full = buildWeeklyPlan({ subjects: [{ id: "a", name: "A" }], weights: { a: 1 }, weeklyMinutes: 600, weekdays: [1, 2, 3, 4, 5, 6], minutesWeek: { a: 700 }, today: WED });
  assert.strictEqual(full.rows[0].remaining, 0);
  assert.strictEqual(full.rows[0].todayTarget, 0);
  assert.strictEqual(full.totalDone, 600, "o feito acima da meta não passa de 100%");
  const tiny = buildWeeklyPlan({ subjects: [{ id: "a", name: "A" }], weights: { a: 1 }, weeklyMinutes: 600, weekdays: [1, 2, 3, 4, 5, 6], minutesWeek: { a: 597 }, today: WED });
  assert.ok(tiny.rows[0].todayTarget <= 3, "nunca sugere mais do que falta");
});

test("plano semanal: sem pesos ou sem matérias não quebra", () => {
  const none = buildWeeklyPlan({ subjects: [], weights: {}, weeklyMinutes: 600, weekdays: [1], today: WED });
  assert.strictEqual(none.rows.length, 0);
  assert.strictEqual(none.totalTarget, 0);
  const zero = buildWeeklyPlan({ subjects: [{ id: "a", name: "A" }], weights: { a: 0 }, weeklyMinutes: 600, weekdays: [1, 2, 3], today: WED });
  assert.strictEqual(zero.totalTarget, 0);
});

/* ---------- reforço por desempenho ---------- */

function q(topicId, date, correct, wrong, subjectId = "s") {
  return { topicId, subjectId, date, correct, wrong };
}
const opts = { threshold: 70, minQuestions: 10 };

test("acerto por assunto: soma só a janela, ignora logs sem assunto", () => {
  const stats = cycleTopicAccuracy([q("t1", "2026-11-10", 6, 4), q("t1", "2026-11-01", 4, 6), q("t1", "2026-08-01", 0, 50), { date: "2026-11-10", correct: 0, wrong: 9 }], WED);
  assert.strictEqual(stats.length, 1);
  assert.strictEqual(stats[0].total, 20);
  assert.strictEqual(stats[0].correct, 10);
  assert.strictEqual(stats[0].accuracy, 50);
});

test("assuntos fracos: exige volume mínimo e acerto abaixo da meta", () => {
  const logs = [q("fraco", "2026-11-10", 6, 6), q("bom", "2026-11-10", 11, 1), q("poucas", "2026-11-10", 1, 5)];
  assert.strictEqual(json(cycleWeakTopics(logs, WED, opts).map((t) => t.topicId)), json(["fraco"]));
});

test("reforço: cria uma vez, não duplica enquanto pendente", () => {
  const logs = [q("t1", "2026-11-10", 5, 7)];
  assert.strictEqual(cycleWeakCandidates({ logs, revisions: [], today: WED, ...opts }).length, 1);
  const pending = [{ kind: "weak", topicId: "t1", status: "pending", baseDate: "2026-11-10" }];
  assert.strictEqual(cycleWeakCandidates({ logs, revisions: pending, today: WED, ...opts }).length, 0);
});

test("reforço: depois de concluído, só volta com novas questões ainda fracas", () => {
  const done = [{ kind: "weak", topicId: "t1", status: "done", baseDate: "2026-11-05" }];
  const sameLogs = [q("t1", "2026-11-04", 5, 7)];
  assert.strictEqual(cycleWeakCandidates({ logs: sameLogs, revisions: done, today: WED, ...opts }).length, 0, "sem questões novas");
  const fewNew = [...sameLogs, q("t1", "2026-11-09", 0, 3)];
  assert.strictEqual(cycleWeakCandidates({ logs: fewNew, revisions: done, today: WED, ...opts }).length, 0, "poucas questões novas");
  const badNew = [...sameLogs, q("t1", "2026-11-09", 2, 4)];
  assert.strictEqual(cycleWeakCandidates({ logs: badNew, revisions: done, today: WED, ...opts }).length, 1, "novas questões fracas");
  const goodNew = [...sameLogs, q("t1", "2026-11-09", 5, 1), q("t1", "2026-11-10", 5, 0)];
  assert.strictEqual(cycleWeakCandidates({ logs: goodNew, revisions: done, today: WED, ...opts }).length, 0, "novas questões boas");
});

test("reforço: reforço de outro assunto não bloqueia este", () => {
  const other = [{ kind: "weak", topicId: "outro", status: "pending", baseDate: WED }];
  assert.strictEqual(cycleWeakCandidates({ logs: [q("t1", "2026-11-10", 5, 7)], revisions: other, today: WED, ...opts }).length, 1);
});

/* ---------- motivo recorrente de erro ---------- */

function e(reason, date) {
  return { reason, date };
}

test("motivo recorrente: precisa de volume e de dominância", () => {
  const few = [e("confusao", "2026-11-01"), e("confusao", "2026-11-02"), e("atencao", "2026-11-03")];
  assert.strictEqual(cycleReasonInsight(few, WED), null);
  const dominant = ["confusao", "confusao", "confusao", "atencao", "chute", "tempo"].map((r, i) => e(r, `2026-11-0${i + 1}`));
  const insight = cycleReasonInsight(dominant, WED);
  assert.strictEqual(insight.reason, "confusao");
  assert.strictEqual(insight.share, 50);
  assert.strictEqual(insight.count, 3);
  const spread = ["confusao", "atencao", "chute", "tempo", "conhecimento", "literalidade", "interpretacao"].map((r, i) => e(r, `2026-11-0${i + 1}`));
  assert.strictEqual(cycleReasonInsight(spread, WED), null, "14% não é dominante");
  const old = dominant.map((x) => e(x.reason, "2026-01-01"));
  assert.strictEqual(cycleReasonInsight(old, WED), null, "erros antigos saem da conta");
});

/* ---------- progresso do dia ---------- */

test("progresso do dia", () => {
  assert.strictEqual(json(cycleDayProgress(0, 0)), json({ done: 0, total: 0, pct: 0 }));
  assert.strictEqual(cycleDayProgress(1, 3).pct, 33);
  assert.strictEqual(cycleDayProgress(3, 3).pct, 100);
});

/* ---------- backup semanal ---------- */

const baseBackup = { today: WED, days: 7, hasData: true, created: "2026-01-01" };

test("backup: vence após N dias, respeita desligado, sem dados e adiamento", () => {
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, last: "2026-11-04" }).due, true);
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, last: "2026-11-04" }).since, 7);
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, last: "2026-11-08" }).due, false);
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, days: 0, last: "2020-01-01" }).due, false, "0 desliga");
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, hasData: false, last: "" }).due, false, "sem dados não cobra");
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, last: "2026-11-01", snooze: WED }).due, false, "adiado até hoje");
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, last: "2026-11-01", snooze: "2026-11-10" }).due, true, "adiamento de ontem expirou");
});

test("backup: sem nenhum backup, só cobra depois de N dias de conta", () => {
  const fresh = cycleBackupStatus({ ...baseBackup, last: "", created: "2026-11-09" });
  assert.strictEqual(fresh.due, false);
  const old = cycleBackupStatus({ ...baseBackup, last: "", created: "2026-10-01" });
  assert.strictEqual(old.due, true);
  assert.strictEqual(old.never, true);
  assert.strictEqual(cycleBackupStatus({ ...baseBackup, last: "", created: "" }).due, true, "sem data de criação: cobra");
});

/* ---------- mensagem do lembrete com backup ---------- */

test("lembrete: backup entra na mensagem e muda o título quando é o único motivo", () => {
  const only = cycleReminderMessage({ backupDue: true });
  assert.strictEqual(only.body, "backup semanal pendente");
  assert.strictEqual(only.title, "Lembrete do Estudos Track");
  const both = cycleReminderMessage({ revDue: 2, backupDue: true });
  assert.strictEqual(both.body, "2 revisões · backup semanal pendente");
  assert.strictEqual(both.title, "Hora de revisar");
  assert.strictEqual(cycleReminderMessage({ backupDue: false }), null);
});

console.log(`hoje-tests: ${passed} testes passaram.`);
