const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({ console, JSON, Date, Intl, TextEncoder });
["ciclo.js", "hoje.js", "retencao.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f }));
const { reportStreak, reportHeatmap, reportAdherence, reportRetention, reportLoad, reportErrors } = ctx;

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
const json = (v) => JSON.stringify(v);
const TODAY = "2026-11-18"; // quarta-feira
const day = (offset) => ctx.cycleAddDays(TODAY, offset);
const log = (offset, minutes = 30) => ({ date: day(offset), minutes });

/* ---------- sequência ---------- */

test("sequência: conta os dias seguidos terminando hoje", () => {
  const s = reportStreak([log(-2), log(-1), log(0)], TODAY);
  assert.strictEqual(s.current, 3);
  assert.strictEqual(s.best, 3);
  assert.strictEqual(s.studiedToday, true);
});

test("sequência: hoje ainda sem estudo não quebra, conta até ontem", () => {
  const s = reportStreak([log(-3), log(-2), log(-1)], TODAY);
  assert.strictEqual(s.current, 3);
  assert.strictEqual(s.studiedToday, false);
});

test("sequência: um dia sem estudar zera a atual, mas a melhor fica", () => {
  const s = reportStreak([log(-10), log(-9), log(-8), log(-7), log(-2), log(0)], TODAY);
  assert.strictEqual(s.current, 1, "ontem não teve estudo: só hoje conta");
  assert.strictEqual(s.best, 4);
  assert.strictEqual(reportStreak([log(-3)], TODAY).current, 0, "anteontem e antes não sustentam a sequência");
});

test("sequência: vários registros no mesmo dia somam e o mínimo é respeitado", () => {
  const logs = [{ date: day(0), minutes: 6 }, { date: day(0), minutes: 6 }, { date: day(-1), minutes: 6 }];
  assert.strictEqual(reportStreak(logs, TODAY, 10).current, 1, "hoje 12 min ≥ 10; ontem 6 min não conta");
  assert.strictEqual(reportStreak(logs, TODAY, 1).current, 2);
});

test("sequência: dados inválidos e vazio não quebram; médias e janela de 30 dias", () => {
  const empty = reportStreak([], TODAY);
  assert.strictEqual(json(empty), json({ current: 0, best: 0, studiedToday: false, daysStudied: 0, last30: 0, avgMinutes: 0 }));
  const messy = reportStreak([{ date: "lixo", minutes: 30 }, { minutes: 5 }, null, { date: day(0), minutes: "x" }, { date: day(-40), minutes: 60 }, log(0, 30)], TODAY);
  assert.strictEqual(messy.daysStudied, 2);
  assert.strictEqual(messy.last30, 1, "o estudo de 40 dias atrás fica de fora dos 30 dias");
  assert.strictEqual(messy.avgMinutes, 45);
});

/* ---------- mapa de dias ---------- */

test("mapa: 12 semanas de segunda a domingo, a última contém hoje e o futuro é marcado", () => {
  const map = reportHeatmap([log(0, 45), log(-1, 29), log(-2, 120)], TODAY, 12);
  assert.strictEqual(map.weeks.length, 12);
  assert.ok(map.weeks.every((week) => week.length === 7));
  assert.strictEqual(map.weeks[11][0].date, "2026-11-16", "segunda-feira da semana atual");
  assert.strictEqual(map.weeks[0][0].date, "2026-08-31");
  assert.strictEqual(map.weeks[11][2].date, TODAY);
  assert.strictEqual(map.weeks[11][2].future, false);
  assert.strictEqual(map.weeks[11][3].future, true);
  assert.strictEqual(map.weeks[11][2].level, 2, "45 min");
  assert.strictEqual(map.weeks[11][1].level, 1, "29 min");
  assert.strictEqual(map.weeks[11][0].level, 4, "120 min");
  assert.strictEqual(map.activeDays, 3);
  assert.strictEqual(map.totalMinutes, 194);
});

test("mapa: limites dos níveis e dias futuros nunca têm minutos", () => {
  const lv = (m) => reportHeatmap([{ date: TODAY, minutes: m }], TODAY, 1).weeks[0][2].level;
  assert.strictEqual(json([lv(0), lv(1), lv(29), lv(30), lv(59), lv(60), lv(119), lv(120), lv(500)]), json([0, 1, 1, 2, 2, 3, 3, 4, 4]));
  const future = reportHeatmap([{ date: day(2), minutes: 90 }], TODAY, 1);
  assert.strictEqual(future.weeks[0][4].minutes, 0);
  assert.strictEqual(future.activeDays, 0);
});

/* ---------- aderência ---------- */

test("aderência: estudado x meta semanal, da mais antiga para a atual", () => {
  const logs = [log(0, 100), log(-1, 50), log(-8, 600), log(-9, 300)];
  const weeks = reportAdherence(logs, 600, TODAY, 3);
  assert.strictEqual(weeks.length, 3);
  assert.strictEqual(weeks[2].current, true);
  assert.strictEqual(weeks[0].current, false);
  assert.strictEqual(weeks[2].done, 150);
  assert.strictEqual(weeks[2].pct, 25);
  assert.strictEqual(weeks[1].done, 900, "segunda-feira 9/11 até domingo 15/11 (-8 e -9 caem aqui)");
  assert.strictEqual(weeks[1].pct, 150, "passar da meta é preservado (a tela limita a barra)");
  assert.strictEqual(weeks[2].weekStart, "2026-11-16");
  assert.strictEqual(reportAdherence([], 0, TODAY, 2)[0].pct, 0, "sem meta não divide por zero");
});

/* ---------- retenção ---------- */

function revision(subjectId, results) {
  return { subjectId, history: results.map(([offset, result]) => ({ date: day(offset), result })) };
}

test("retenção: Bom e Fácil contam como lembrados; geral, por semana e por matéria", () => {
  const revisions = [
    revision("s1", [[-1, "ok"], [-2, "easy"], [-3, "hard"], [-4, "forgot"]]),
    revision("s2", [[-1, "ok"], [-9, "forgot"]]),
    revision("s1", [[-90, "forgot"]]), // fora da janela de 60 dias
  ];
  const r = reportRetention(revisions, { s1: "Penal", s2: "Português" }, TODAY);
  assert.strictEqual(r.reviews, 6);
  assert.strictEqual(r.kept, 3);
  assert.strictEqual(r.forgot, 2);
  assert.strictEqual(r.pct, 50);
  assert.strictEqual(json(r.bySubject.map((x) => [x.name, x.reviews, x.pct])), json([["Penal", 4, 50], ["Português", 2, 50]].sort((a, b) => a[2] - b[2] || b[1] - a[1])));
  assert.strictEqual(r.weekly.length, 8);
  const current = r.weekly[7];
  assert.strictEqual(current.weekStart, "2026-11-16");
  assert.strictEqual(current.reviews, 3, "17/11 (duas) e 16/11, todas na semana atual");
  assert.strictEqual(current.pct, 100, "ok, easy e ok");
  assert.strictEqual(r.weekly[6].reviews, 3, "semana anterior: 15/11, 14/11 e 09/11");
  assert.strictEqual(r.weekly[6].pct, 0, "hard, forgot e forgot");
  assert.strictEqual(r.weekly[5].pct, null, "semana sem revisões não tem porcentagem");
});

test("retenção: matéria mais fraca vem primeiro; sem revisões não há porcentagem", () => {
  const r = reportRetention([revision("a", [[-1, "ok"], [-2, "ok"]]), revision("b", [[-1, "forgot"], [-2, "hard"]]), { history: [{ date: day(-1), result: "ok" }] }], { a: "A", b: "B" }, TODAY);
  assert.strictEqual(r.bySubject[0].name, "B");
  assert.strictEqual(r.bySubject[0].pct, 0);
  assert.strictEqual(r.bySubject[r.bySubject.length - 1].pct, 100);
  assert.strictEqual(r.bySubject.some((x) => x.name === "Sem matéria"), true, "revisão sem matéria entra como 'Sem matéria'");
  const none = reportRetention([], {}, TODAY);
  assert.strictEqual(none.pct, null);
  assert.strictEqual(none.weekly.every((w) => w.pct === null), true);
  assert.strictEqual(reportRetention([{ history: [{ date: "lixo", result: "ok" }, null] }], {}, TODAY).reviews, 0);
});

/* ---------- carga ---------- */

test("carga: atrasadas entram em hoje; concluídas e dominados ficam de fora", () => {
  const revisions = [
    { status: "pending", dueDate: day(-3) },
    { status: "pending", dueDate: day(0) },
    { status: "pending", dueDate: day(2) },
    { status: "pending", dueDate: day(2) },
    { status: "done", dueDate: day(2) },
    { status: "pending", dueDate: day(20) },
  ];
  const errors = [{ mastered: false, dueDate: day(-1) }, { mastered: true, dueDate: day(0) }, { mastered: false, dueDate: day(2) }, { mastered: false, dueDate: "" }];
  const load = reportLoad(revisions, errors, TODAY, 14);
  assert.strictEqual(load.length, 14);
  assert.strictEqual(json({ ...load[0] }), json({ date: TODAY, rev: 2, err: 1 }));
  assert.strictEqual(load[2].rev, 2);
  assert.strictEqual(load[2].err, 1);
  assert.strictEqual(load.reduce((sum, d) => sum + d.rev, 0), 4, "a de 20 dias fica fora da janela");
});

/* ---------- erros ---------- */

test("erros: por motivo, dominados e por semana, só nos últimos 90 dias", () => {
  const errors = [
    { date: day(0), reason: "confusao", mastered: false },
    { date: day(-1), reason: "confusao", mastered: true },
    { date: day(-8), reason: "atencao", mastered: false },
    { date: day(-100), reason: "chute", mastered: false },
    { date: "lixo", reason: "tempo" },
  ];
  const e = reportErrors(errors, TODAY);
  assert.strictEqual(e.total, 3);
  assert.strictEqual(e.mastered, 1);
  assert.strictEqual(Math.round(e.masteredPct), 33);
  assert.strictEqual(e.byReason[0].reason, "confusao");
  assert.strictEqual(Math.round(e.byReason[0].pct), 67);
  assert.strictEqual(e.weekly.length, 8);
  assert.strictEqual(e.weekly[7].count, 2);
  assert.strictEqual(e.weekly[6].count, 1);
  assert.strictEqual(reportErrors([], TODAY).masteredPct, null);
});

console.log(`retencao-tests: ${passed} testes passaram.`);
