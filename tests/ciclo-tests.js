const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.resolve(__dirname, "..", "ciclo.js"), "utf8");
const ctx = vm.createContext({ console, TextEncoder });
vm.runInContext(code, ctx);

const {
  cycleReviewStep,
  buildLawSchedule,
  lawWorkSegments,
  lawWorkLabel,
  lawUnitsFromPosition,
  lawRegisterWork,
  lawTotalWork,
  normalizeLawPlan,
  normalizeCycleIntervals,
  normalizeCycleSettings,
  normalizeRevision,
  cycleAddDays,
  cycleRedistributeOverdue,
  cycleReminderMessage,
  cycleIcsEscape,
  cycleIcsFold,
  buildIcs,
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

/* ---------- revisão espaçada ---------- */

test("revisão: 'ok' avança e usa o intervalo da próxima etapa", () => {
  assert.strictEqual(JSON.stringify(cycleReviewStep(0, "ok", [1, 7, 30, 60])), JSON.stringify({ done: false, stage: 1, gap: 7 }));
  assert.strictEqual(JSON.stringify(cycleReviewStep(2, "ok", [1, 7, 30, 60])), JSON.stringify({ done: false, stage: 3, gap: 60 }));
});

test("revisão: 'easy' avança com intervalo 50% maior", () => {
  assert.strictEqual(cycleReviewStep(0, "easy", [1, 7, 30, 60]).gap, 11);
});

test("revisão: 'hard' repete a etapa com metade do intervalo (mínimo 1 dia)", () => {
  const step = cycleReviewStep(2, "hard", [1, 7, 30, 60]);
  assert.strictEqual(step.stage, 2);
  assert.strictEqual(step.gap, 15);
  assert.strictEqual(cycleReviewStep(0, "hard", [1, 7]).gap, 1);
});

test("revisão: 'forgot' volta para a primeira etapa", () => {
  const step = cycleReviewStep(3, "forgot", [1, 7, 30, 60]);
  assert.strictEqual(step.stage, 0);
  assert.strictEqual(step.gap, 1);
});

test("revisão: passar da última etapa encerra a cadeia", () => {
  assert.strictEqual(cycleReviewStep(3, "ok", [1, 7, 30, 60]).done, true);
  assert.strictEqual(cycleReviewStep(0, "ok", [1]).done, true);
});

test("revisão: etapa fora do intervalo configurado não quebra o 'hard'", () => {
  assert.strictEqual(cycleReviewStep(9, "hard", [1, 7]).gap, 4);
});

test("intervalos: aceita texto, descarta lixo e limita a 8 itens", () => {
  assert.strictEqual(JSON.stringify([...normalizeCycleIntervals("1, 7; 30 abc 0 -3 400", [9])]), JSON.stringify([1, 7, 30]));
  assert.strictEqual(JSON.stringify([...normalizeCycleIntervals("", [1, 2])]), JSON.stringify([1, 2]));
  assert.strictEqual(normalizeCycleIntervals("1 2 3 4 5 6 7 8 9 10", [1]).length, 8);
});

test("configurações do ciclo: valores padrão e autoSince válido", () => {
  const settings = normalizeCycleSettings(undefined);
  assert.strictEqual(JSON.stringify([...settings.intervals]), JSON.stringify([1, 7, 30, 60]));
  assert.strictEqual(JSON.stringify([...settings.errorIntervals]), JSON.stringify([1, 3, 7, 15, 30]));
  assert.strictEqual(settings.autoFromStudy, true);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(settings.autoSince));
  assert.strictEqual(normalizeCycleSettings({ autoFromStudy: false, autoSince: "2026-01-05" }).autoSince, "2026-01-05");
});

test("normalizeRevision: sanitiza campos inválidos", () => {
  const revision = normalizeRevision({ kind: "xyz", stage: -4, dueDate: "amanhã", history: [{ date: "2026-01-01", result: "?" }] });
  assert.strictEqual(revision.kind, "manual");
  assert.strictEqual(revision.stage, 0);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(revision.dueDate));
  assert.strictEqual(revision.history[0].result, "ok");
  assert.strictEqual(revision.status, "pending");
});

/* ---------- lei seca ---------- */

function makePlan(overrides = {}) {
  return normalizeLawPlan({
    title: "CF/88",
    startUnit: 1,
    endUnit: 100,
    passes: 1,
    startDate: "2026-11-09", // segunda
    endDate: "2026-11-18", // 10 dias corridos
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    ...overrides,
  });
}
const TODAY = "2026-11-11"; // quarta

test("lei seca: segmentos atravessam duas leituras", () => {
  const plan = makePlan({ endUnit: 10, passes: 2 });
  const segments = lawWorkSegments(plan, 8, 12);
  assert.strictEqual(
    JSON.stringify(segments.map((s) => ({ pass: s.pass, from: s.from, to: s.to, count: s.count }))),
    JSON.stringify([
      { pass: 1, from: 9, to: 10, count: 2 },
      { pass: 2, from: 1, to: 2, count: 2 },
    ])
  );
  assert.strictEqual(lawWorkLabel(plan, 8, 12), "1ª leitura: artigos 9–10 + 2ª leitura: artigos 1–2");
  assert.strictEqual(lawWorkLabel(makePlan(), 0, 1), "artigos 1");
});

test("lei seca: plano em dia distribui igualmente", () => {
  const plan = makePlan({ doneWork: 20 });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.todayIsReading, true);
  assert.strictEqual(info.todayTarget, 10);
  assert.strictEqual(info.rows.length, 8);
  assert.strictEqual(info.rows.reduce((sum, row) => sum + row.count, 0), 80);
  assert.strictEqual(info.rows[0].label, "artigos 21–30");
  assert.strictEqual(info.delta, 0);
  assert.strictEqual(info.status, "Em dia");
});

test("lei seca: a meta de hoje não encolhe enquanto você lê", () => {
  const plan = makePlan({ doneWork: 30, readLog: [{ date: TODAY, fromWork: 20, toWork: 30 }] });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.readToday, 10);
  assert.strictEqual(info.todayTarget, 10);
  assert.strictEqual(info.rows[0].count, 10);
  assert.strictEqual(info.rows[1].fromWork, 30);
  assert.strictEqual(info.rows.reduce((sum, row) => sum + row.count, 0), 80); // hoje (10) + futuros (70)
});

test("lei seca: ler menos que a meta empurra o restante para os próximos dias", () => {
  const plan = makePlan({ doneWork: 25, readLog: [{ date: TODAY, fromWork: 20, toWork: 25 }] });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.todayTarget, 10);
  assert.strictEqual(info.rows[1].fromWork, 30);
  const futureTotal = info.rows.slice(1).reduce((sum, row) => sum + row.count, 0);
  assert.strictEqual(futureTotal, 70);
});

test("lei seca: ler mais que a meta reduz o ritmo dos próximos dias", () => {
  const plan = makePlan({ doneWork: 45, readLog: [{ date: TODAY, fromWork: 20, toWork: 45 }] });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.todayTarget, 10);
  assert.strictEqual(info.rows[1].fromWork, 45);
  assert.strictEqual(info.rows.slice(1).reduce((sum, row) => sum + row.count, 0), 55);
  assert.ok(info.delta > 0);
  assert.ok(info.status.includes("adiantado"));
});

test("lei seca: atraso é sinalizado e o restante é redistribuído", () => {
  const info = buildLawSchedule(makePlan({ doneWork: 0 }), TODAY);
  assert.strictEqual(info.delta, -20);
  assert.strictEqual(info.status, "20 artigos atrasado");
  assert.strictEqual(info.tone, "bad");
  assert.strictEqual(info.todayTarget, 13);
  assert.strictEqual(info.rows.reduce((sum, row) => sum + row.count, 0), 100);
});

test("lei seca: dia de folga mostra a próxima leitura sem meta hoje", () => {
  const plan = makePlan({ weekdays: [1, 2, 3, 4, 5], startDate: "2026-11-09", endDate: "2026-11-30" });
  const info = buildLawSchedule(plan, "2026-11-15"); // domingo
  assert.strictEqual(info.todayIsReading, false);
  assert.strictEqual(info.todayTarget, 0);
  assert.strictEqual(info.rows[0].date, "2026-11-16");
  assert.strictEqual(info.rows.reduce((sum, row) => sum + row.count, 0), 100);
});

test("lei seca: prazo vencido concentra o que falta em hoje", () => {
  const plan = makePlan({ doneWork: 40, endDate: "2026-11-10" });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.overdue, true);
  assert.strictEqual(info.status, "Prazo vencido");
  assert.strictEqual(info.rows.length, 1);
  assert.strictEqual(info.rows[0].count, 60);
});

test("lei seca: plano ainda não iniciado", () => {
  const plan = makePlan({ startDate: "2026-11-20", endDate: "2026-11-30" });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.notStarted, true);
  assert.strictEqual(info.todayIsReading, false);
  assert.strictEqual(info.rows[0].date, "2026-11-20");
  assert.strictEqual(info.status, "Ainda não começou");
});

test("lei seca: poucas unidades para muitos dias não gera linhas vazias", () => {
  const plan = makePlan({ endUnit: 3, startDate: "2026-11-11", endDate: "2026-11-20" });
  const info = buildLawSchedule(plan, TODAY);
  assert.ok(info.rows.every((row) => row.count > 0));
  assert.strictEqual(info.rows.reduce((sum, row) => sum + row.count, 0), 3);
});

test("lei seca: plano concluído", () => {
  const plan = makePlan({ doneWork: 100 });
  const info = buildLawSchedule(plan, TODAY);
  assert.strictEqual(info.finished, true);
  assert.strictEqual(info.status, "Concluído");
  assert.strictEqual(info.rows.length, 0);
});

test("lei seca: várias leituras entram no total e na leitura atual", () => {
  const plan = makePlan({ endUnit: 50, passes: 3, doneWork: 60 });
  assert.strictEqual(lawTotalWork(plan), 150);
  assert.strictEqual(buildLawSchedule(plan, TODAY).currentPass, 2);
});

test("lei seca: registrar leitura limita ao que falta e guarda histórico", () => {
  const plan = makePlan({ doneWork: 95 });
  assert.strictEqual(lawRegisterWork(plan, 20, TODAY), 5);
  assert.strictEqual(plan.doneWork, 100);
  assert.strictEqual(plan.readLog.at(-1).fromWork, 95);
  assert.strictEqual(lawRegisterWork(plan, 3, TODAY), 0);
  assert.strictEqual(lawRegisterWork(makePlan(), -4, TODAY), 0);
});

test("lei seca: 'li até o nº' valida faixa e retrocesso", () => {
  const plan = makePlan({ startUnit: 10, endUnit: 60, doneWork: 5 }); // já leu 10–14
  assert.strictEqual(lawUnitsFromPosition(plan, 20).units, 6);
  assert.ok(lawUnitsFromPosition(plan, 12).error.includes("14"));
  assert.ok(lawUnitsFromPosition(plan, 9).error);
  assert.ok(lawUnitsFromPosition(plan, 61).error);
  assert.ok(lawUnitsFromPosition(plan, "abc").error);
  assert.ok(lawUnitsFromPosition(makePlan({ doneWork: 100 }), 5).error.includes("concluído"));
});

test("lei seca: 'li até' respeita a leitura em andamento (2ª passada)", () => {
  const plan = makePlan({ endUnit: 10, passes: 2, doneWork: 12 }); // 2ª leitura, já no art. 2
  assert.strictEqual(lawUnitsFromPosition(plan, 6).units, 4);
});

test("normalizeLawPlan: corrige intervalo, datas e dias inválidos", () => {
  const plan = normalizeLawPlan({ startUnit: 50, endUnit: 10, passes: 99, startDate: "2026-11-20", endDate: "2026-11-01", weekdays: [], doneWork: 99999 });
  assert.ok(plan.endUnit >= plan.startUnit);
  assert.strictEqual(plan.passes, 10);
  assert.ok(plan.endDate >= plan.startDate);
  assert.strictEqual(JSON.stringify([...plan.weekdays]), JSON.stringify([1, 2, 3, 4, 5, 6]));
  assert.ok(plan.doneWork <= lawTotalWork(plan));
});

test("cycleAddDays: atravessa virada de mês e de ano", () => {
  assert.strictEqual(cycleAddDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(cycleAddDays("2026-03-01", -1), "2026-02-28");
});


/* ---------- lembretes ---------- */

test("configurações: horários de aviso e limite diário", () => {
  const defaults = normalizeCycleSettings({});
  assert.strictEqual(defaults.reminderTime, "08:00");
  assert.strictEqual(defaults.eveningTime, "");
  assert.strictEqual(defaults.dailyLimit, 12);
  const custom = normalizeCycleSettings({ reminderTime: "06:45", eveningTime: "19:30", dailyLimit: 5 });
  assert.strictEqual(custom.reminderTime, "06:45");
  assert.strictEqual(custom.eveningTime, "19:30");
  assert.strictEqual(custom.dailyLimit, 5);
  const invalid = normalizeCycleSettings({ reminderTime: "25:99", eveningTime: "abc", dailyLimit: -3 });
  assert.strictEqual(invalid.reminderTime, "08:00");
  assert.strictEqual(invalid.eveningTime, "");
  assert.strictEqual(invalid.dailyLimit, 1);
});

function rev(id, dueDate, status = "pending") {
  return { id, dueDate, status };
}

test("redistribuir atrasadas: respeita o limite diário e começa pelas mais antigas", () => {
  const today = "2026-11-12";
  const list = [
    rev("a", "2026-11-01"),
    rev("b", "2026-11-03"),
    rev("c", "2026-11-05"),
    rev("d", "2026-11-07"),
    rev("e", "2026-11-09"),
    rev("hoje1", today),
    rev("hoje2", today),
    rev("futura", "2026-11-14"),
    rev("feita", "2026-11-02", "done"),
  ];
  const changes = cycleRedistributeOverdue(list, today, 4);
  assert.strictEqual(changes.length, 5, "só as pendentes atrasadas mudam");
  assert.strictEqual(JSON.stringify(changes.map((c) => c.id)), JSON.stringify(["a", "b", "c", "d", "e"]));
  assert.strictEqual(JSON.stringify(changes.map((c) => c.dueDate)), JSON.stringify([today, today, "2026-11-13", "2026-11-13", "2026-11-13"]));
  const perDay = {};
  list.filter((r) => r.status === "pending" && r.dueDate >= today).forEach((r) => (perDay[r.dueDate] = (perDay[r.dueDate] || 0) + 1));
  changes.forEach((c) => (perDay[c.dueDate] = (perDay[c.dueDate] || 0) + 1));
  Object.values(perDay).forEach((count) => assert.ok(count <= 4, "dia acima do limite"));
});

test("redistribuir atrasadas: pula dias já cheios e não mexe em nada sem atrasadas", () => {
  const today = "2026-11-12";
  const full = ["2026-11-12", "2026-11-12", "2026-11-13", "2026-11-13"].map((d, i) => rev(`f${i}`, d));
  const changes = cycleRedistributeOverdue([...full, rev("x", "2026-10-01")], today, 2);
  assert.strictEqual(changes[0].dueDate, "2026-11-14");
  assert.strictEqual(cycleRedistributeOverdue(full, today, 2).length, 0);
});

test("mensagem do lembrete: singular, plural, atraso e lei seca", () => {
  assert.strictEqual(cycleReminderMessage({}), null);
  const one = cycleReminderMessage({ revDue: 1 });
  assert.strictEqual(one.body, "1 revisão");
  assert.strictEqual(one.title, "Hora de revisar");
  const full = cycleReminderMessage({ revDue: 5, revOverdue: 2, errorsDue: 1, lawLabel: "artigos 11–20" });
  assert.strictEqual(full.body, "5 revisões (2 atrasadas) · 1 erro para refazer · Lei seca: artigos 11–20");
  assert.ok(full.title.includes("atrasadas"));
});

test(".ics: escape de caracteres especiais", () => {
  assert.strictEqual(cycleIcsEscape("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test(".ics: linhas dobradas em até 75 octetos sem partir UTF-8 e sem perder texto", () => {
  const longo = "DESCRIPTION:" + "Revisão de ação penal pública condicionada à representação, ".repeat(6);
  const folded = cycleIcsFold(longo);
  const parts = folded.split("\r\n ");
  assert.ok(parts.length > 1);
  parts.forEach((part, index) => assert.ok(Buffer.byteLength(part) + (index ? 1 : 0) <= 75, `linha ${index} excede 75 octetos`));
  assert.strictEqual(parts.join(""), longo);
});

test(".ics: calendário válido com alarme e horário local", () => {
  const ics = buildIcs(
    [{ uid: "2026-11-13-ciclo@estudostrack", date: "2026-11-13", time: "08:00", minutes: 30, summary: "Estudos Track: 2 revisões, 1 erro", description: "Revisões:\n- Direito Constitucional (R1/4)" }],
    { now: new Date(Date.UTC(2026, 10, 12, 15, 0, 0)) }
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART:20261113T080000\r\n"));
  assert.ok(ics.includes("DTEND:20261113T083000\r\n"));
  assert.ok(ics.includes("DTSTAMP:20261112T150000Z\r\n"));
  assert.ok(ics.includes("BEGIN:VALARM\r\nTRIGGER:PT0M"));
  assert.ok(ics.includes("SUMMARY:Estudos Track: 2 revisões\\, 1 erro"));
  assert.ok(ics.includes("DESCRIPTION:Revisões:\\n- Direito Constitucional (R1/4)"));
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(!/[^\r]\n/.test(ics), "toda quebra de linha deve ser CRLF");
});

test(".ics: evento que cruza a meia-noite avança a data no DTEND", () => {
  const ics = buildIcs([{ uid: "x", date: "2026-12-31", time: "23:45", minutes: 30, summary: "s", description: "" }]);
  assert.ok(ics.includes("DTSTART:20261231T234500"));
  assert.ok(ics.includes("DTEND:20270101T001500"));
});

console.log(`ciclo-tests: ${passed} testes passaram.`);
