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
  normalizeErrorEntry,
  cycleAddDays,
  cycleRedistributeOverdue,
  cycleReminderMessage,
  cycleProjectStages,
  cycleCalendarGroups,
  cycleCalendarEvent,
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


/* ---------- agenda com etapas futuras ---------- */

test("etapas futuras: contam o intervalo entre uma revisão e a seguinte", () => {
  const steps = cycleProjectStages(0, "2026-11-12", [1, 7, 30, 60]);
  assert.strictEqual(JSON.stringify(steps), JSON.stringify([{ stage: 1, date: "2026-11-19" }, { stage: 2, date: "2026-12-19" }, { stage: 3, date: "2027-02-17" }]));
  assert.strictEqual(JSON.stringify(cycleProjectStages(2, "2026-11-12", [1, 7, 30, 60])), JSON.stringify([{ stage: 3, date: "2027-01-11" }]));
  assert.strictEqual(cycleProjectStages(3, "2026-11-12", [1, 7, 30, 60]).length, 0, "última etapa não projeta nada");
  assert.strictEqual(cycleProjectStages(9, "2026-11-12", [1, 7]).length, 0);
});

test("agenda: agrupa por dia, leva atrasados para hoje e projeta as etapas seguintes", () => {
  const groups = cycleCalendarGroups({
    revisions: [
      { label: "Penal", stage: 0, dueDate: "2026-11-10" }, // atrasada: será feita hoje
      { label: "Civil", stage: 1, dueDate: "2026-11-15" },
    ],
    intervals: [1, 7, 30, 60],
    errors: [{ text: "Habeas data", stage: 0, dueDate: "2026-11-13" }],
    errorIntervals: [1, 3, 7, 15, 30],
    lawRows: [{ date: "2026-11-12", text: "CF: artigos 1–10" }, { date: "2026-11-12", text: "CP: artigos 1–5" }, { date: "2027-06-01", text: "fora do horizonte" }],
    flashDue: 2,
    today: "2026-11-12",
    horizon: "2027-02-10",
  });
  const byDate = Object.fromEntries(groups.map((g) => [g.date, g]));
  assert.strictEqual(JSON.stringify(groups.map((g) => g.date)), JSON.stringify([...groups.map((g) => g.date)].sort()), "ordenado por data");
  assert.strictEqual(JSON.stringify(byDate["2026-11-12"].rev), JSON.stringify(["Penal (R1/4)"]));
  assert.strictEqual(byDate["2026-11-12"].fc, 2, "flashcards só aparecem hoje");
  assert.strictEqual(byDate["2026-11-12"].law.length, 2);
  assert.strictEqual(JSON.stringify(byDate["2026-11-15"].rev), JSON.stringify(["Civil (R2/4)"]));
  // a atrasada é projetada a partir de hoje (e não de 10/11): R2 em 19/11 e R3 em 19/12; R4 passa do horizonte
  assert.strictEqual(JSON.stringify(byDate["2026-11-19"].revNext), JSON.stringify(["Penal (R2/4)"]));
  assert.strictEqual(JSON.stringify(byDate["2026-12-19"].revNext), JSON.stringify(["Penal (R3/4)"]));
  assert.ok(!groups.some((g) => g.revNext.some((x) => x.includes("R4/4") && x.startsWith("Penal"))), "R4 está fora do horizonte");
  // Civil estava em R2 para 15/11: R3 em 15/12 e R4 em 13/02/2027 (fora)
  assert.strictEqual(JSON.stringify(byDate["2026-12-15"].revNext), JSON.stringify(["Civil (R3/4)"]));
  // erros: 13/11 (refazer), depois 16/11, 23/11, 08/12 e 07/01
  assert.strictEqual(byDate["2026-11-13"].err.length, 1);
  assert.deepStrictEqual([...["2026-11-16", "2026-11-23", "2026-12-08", "2027-01-07"].map((d) => byDate[d].errNext.length)], [1, 1, 1, 1]);
  assert.ok(!byDate["2027-06-01"], "lei seca fora do horizonte não entra");
});

test("agenda: evento com resumo e descrição por seção", () => {
  const event = cycleCalendarEvent({ date: "2026-11-12", rev: ["A (R1/4)"], revNext: ["B (R2/4)"], err: ["E1"], errNext: ["E2"], law: ["CF: artigos 1–10"], fc: 2 }, "08:00");
  assert.strictEqual(event.summary, "Estudos Track: 1 revisão, 1 revisão prevista, 1 erro, 1 refação prevista, 2 flashcards, lei seca");
  assert.strictEqual(event.uid, "2026-11-12-ciclo@estudostrack");
  assert.strictEqual(event.time, "08:00");
  assert.ok(event.description.includes("Revisões previstas (se você acertar as anteriores):\n- B (R2/4)"));
  assert.ok(event.description.includes("Flashcards para revisar: 2"));
  const onlyNext = cycleCalendarEvent({ date: "2026-12-01", rev: [], revNext: ["X (R2/4)"], err: [], errNext: [], law: [], fc: 0 }, "07:30");
  assert.strictEqual(onlyNext.summary, "Estudos Track: 1 revisão prevista");
  const many = cycleCalendarEvent({ date: "2026-12-01", rev: Array.from({ length: 20 }, (_, i) => `R${i}`), revNext: [], err: [], errNext: [], law: [], fc: 0 }, "08:00");
  assert.ok(many.description.includes("+ 5 outros"), "listas longas são resumidas");
});

test("lembrete: flashcards entram na mensagem entre revisões e erros", () => {
  const message = cycleReminderMessage({ revDue: 2, flashDue: 3, errorsDue: 1 });
  assert.strictEqual(message.body, "2 revisões · 3 flashcards · 1 erro para refazer");
  assert.strictEqual(cycleReminderMessage({ flashDue: 1 }).body, "1 flashcard");
  assert.strictEqual(cycleReminderMessage({ flashDue: 1 }).title, "Hora de revisar");
});

test("caderno de erros: prints normalizados (só metadados, ids seguros, no máx. 12)", () => {
  const old = normalizeErrorEntry({ statement: "q", correctAnswer: "r" });
  assert.strictEqual(JSON.stringify(old.images), "[]");
  assert.strictEqual(JSON.stringify(old.answerImages), "[]");
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `img_${i}`, w: 100, h: 50 }));
  const e = normalizeErrorEntry({ statement: "", correctAnswer: "", images: [{ id: "a/b<c>", w: "800", h: 400, blob: "x", dataUrl: "data:..." }, { id: "" }, null, ...many], answerImages: "lixo" });
  assert.strictEqual(e.images.length, 12);
  assert.strictEqual(JSON.stringify(e.images[0]), JSON.stringify({ id: "abc", w: 800, h: 400 }));
  assert.strictEqual(JSON.stringify(e.answerImages), "[]");
});


/* ---------- uma cadeia de revisão por assunto, unificação e refação de erros com 4 notas ---------- */

vm.runInContext(
  `function getTopic(id) { return (state.topics || []).find((t) => t.id === id); }
   function getSubject(id) { return (state.subjects || []).find((s) => s.id === id); }
   function getEntrySubjectId(entry) { return entry.subjectId || (getTopic(entry.topicId) || {}).subjectId || ""; }`,
  ctx
);

function freshState(extra = {}) {
  ctx.state = {
    subjects: [{ id: "s1", name: "Penal" }, { id: "s2", name: "Português" }],
    topics: [{ id: "t1", subjectId: "s1", name: "HC" }, { id: "t2", subjectId: "s2", name: "Crase" }],
    studyLogs: [],
    revisions: [],
    errorNotebook: [],
    cycleSettings: ctx.normalizeCycleSettings({ autoSince: "2026-01-01" }),
    ...extra,
  };
  return ctx.state;
}
const log = (topicId, date, minutes = 30, subjectId = "") => ({ id: `${topicId}${date}`, topicId, subjectId, date, minutes });

test("revisão automática: estudar o mesmo assunto em vários dias abre uma cadeia só", () => {
  const st = freshState();
  st.studyLogs = [log("t1", "2026-11-10"), log("t1", "2026-11-11"), log("t1", "2026-11-12"), log("t2", "2026-11-11")];
  assert.strictEqual(ctx.syncAutoRevisions(), 2, "uma cadeia para t1 e uma para t2");
  const t1 = st.revisions.filter((r) => r.topicId === "t1");
  assert.strictEqual(t1.length, 1);
  assert.strictEqual(t1[0].originKey, "study:t1:2026-11-10", "a cadeia nasce do primeiro dia estudado");
  assert.strictEqual(JSON.stringify(t1[0].absorbedKeys), JSON.stringify(["study:t1:2026-11-11", "study:t1:2026-11-12"]));
  assert.strictEqual(ctx.syncAutoRevisions(), 0, "rodar de novo não cria nada");
  assert.strictEqual(st.revisions.length, 2);
});

test("revisão automática: terminada a cadeia, um novo estudo abre outra; matéria sem assunto tem a sua", () => {
  const st = freshState();
  st.studyLogs = [log("t1", "2026-11-10")];
  ctx.syncAutoRevisions();
  st.revisions[0].status = "done";
  st.studyLogs.push(log("t1", "2026-11-20"));
  assert.strictEqual(ctx.syncAutoRevisions(), 1, "cadeia anterior estava concluída");
  assert.strictEqual(st.revisions.filter((r) => r.status === "pending" && r.topicId === "t1").length, 1);
  st.studyLogs.push(log("", "2026-11-21", 20, "s2"), log("", "2026-11-22", 20, "s2"));
  assert.strictEqual(ctx.syncAutoRevisions(), 1, "dois dias da mesma matéria sem assunto: uma cadeia");
  assert.ok(st.revisions.some((r) => r.originKey === "study:s2:2026-11-21" && r.absorbedKeys.includes("study:s2:2026-11-22")));
  st.studyLogs.push(log("t2", "2026-11-23", 5));
  assert.strictEqual(ctx.syncAutoRevisions(), 0, "menos de 10 minutos não conta");
});

test("revisão: absorbedKeys sobrevive à normalização e é limitado", () => {
  const keys = Array.from({ length: 80 }, (_, i) => `study:t1:2026-01-${i}`);
  const r = normalizeRevision({ kind: "study", subjectId: "s1", topicId: "t1", absorbedKeys: [...keys, "", null] });
  assert.strictEqual(r.absorbedKeys.length, 60);
  assert.strictEqual(normalizeRevision({}).absorbedKeys.length, 0);
});

test("unificar cadeias repetidas: fica a mais avançada de cada assunto e nada além de 'study' aberto é tocado", () => {
  const mk = (id, over) => normalizeRevision({ id, kind: "study", subjectId: "s1", topicId: "t1", originKey: `study:t1:${id}`, ...over });
  const revisions = [
    mk("a", { stage: 0, dueDate: "2026-11-11" }),
    mk("b", { stage: 2, dueDate: "2026-11-30", history: [{ date: "2026-11-12", stage: 0, result: "ok" }, { date: "2026-11-19", stage: 1, result: "ok" }] }),
    mk("c", { stage: 0, dueDate: "2026-11-12", absorbedKeys: ["study:t1:x"] }),
    mk("d", { stage: 3, status: "done" }),
    normalizeRevision({ id: "w", kind: "weak", subjectId: "s1", topicId: "t1", originKey: "weak:t1:2026-11-12" }),
    normalizeRevision({ id: "m", kind: "manual", subjectId: "s1", topicId: "t1", originKey: "manual:t1" }),
    normalizeRevision({ id: "o", kind: "study", subjectId: "s2", topicId: "t2", originKey: "study:t2:2026-11-10" }),
  ];
  const plan = ctx.cycleConsolidatePlan(revisions);
  assert.strictEqual(plan.groups, 1);
  assert.strictEqual(JSON.stringify([...plan.remove].sort()), JSON.stringify(["a", "c"]));
  assert.strictEqual(JSON.stringify(Object.keys(plan.keepers)), JSON.stringify(["b"]));
  assert.strictEqual(JSON.stringify([...plan.keepers.b].sort()), JSON.stringify(["study:t1:a", "study:t1:c", "study:t1:x"]));
  assert.strictEqual(ctx.cycleConsolidatePlan([mk("z", {})]).remove.length, 0, "uma cadeia só: nada a fazer");
});

test("caderno de erros: refação com 4 notas", () => {
  const st = freshState();
  const make = (over) => {
    const e = normalizeErrorEntry({ id: "e1", subjectId: "s1", statement: "q", date: "2026-11-01", stage: 2, lapses: 0, dueDate: "2026-11-10", ...over });
    st.errorNotebook = [e];
    return e;
  };
  let e = make({});
  let step = ctx.retestErrorEntry("e1", "forgot");
  assert.strictEqual(e.stage, 0);
  assert.strictEqual(e.lapses, 1);
  assert.strictEqual(e.lastResult, "wrong");
  assert.strictEqual(step.result, "forgot");
  assert.strictEqual(step.leech, false);

  e = make({ stage: 2 });
  step = ctx.retestErrorEntry("e1", "hard");
  assert.strictEqual(e.stage, 2, "acertar com dúvida não avança");
  assert.strictEqual(e.lapses, 0, "e não conta como erro");
  assert.strictEqual(e.lastResult, "hard");
  assert.strictEqual(step.gap, Math.ceil(ctx.state.cycleSettings.errorIntervals[2] / 2), "volta com metade do intervalo da etapa");
  assert.strictEqual(e.attempts, 1);

  e = make({ stage: 1 });
  ctx.retestErrorEntry("e1", "ok");
  assert.strictEqual(e.stage, 2);
  assert.strictEqual(e.lastResult, "ok");
  const okGap = ctx.state.cycleSettings.errorIntervals[2];

  e = make({ stage: 1 });
  step = ctx.retestErrorEntry("e1", "easy");
  assert.strictEqual(e.lastResult, "easy");
  assert.strictEqual(step.gap, Math.round(okGap * 1.5), "fácil: intervalo 1,5× maior");

  const last = ctx.state.cycleSettings.errorIntervals.length - 1;
  e = make({ stage: last });
  ctx.retestErrorEntry("e1", "hard");
  assert.strictEqual(e.mastered, false, "com dúvida na última etapa ainda não domina");
  e = make({ stage: last });
  step = ctx.retestErrorEntry("e1", "ok");
  assert.strictEqual(e.mastered, true);
  assert.strictEqual(e.dueDate, "");
  assert.strictEqual(step.done, true);
});

test("caderno de erros: aceita true/false do jeito antigo e ignora valores estranhos", () => {
  assert.strictEqual(ctx.errorRetestResult(true), "ok");
  assert.strictEqual(ctx.errorRetestResult(false), "forgot");
  assert.strictEqual(ctx.errorRetestResult("wrong"), "forgot");
  assert.strictEqual(ctx.errorRetestResult("easy"), "easy");
  assert.strictEqual(ctx.errorRetestResult("???"), "ok");
  for (const lastResult of ["ok", "wrong", "hard", "easy"]) assert.strictEqual(normalizeErrorEntry({ statement: "q", lastResult }).lastResult, lastResult);
  assert.strictEqual(normalizeErrorEntry({ statement: "q", lastResult: "lixo" }).lastResult, "");
  assert.strictEqual(ctx.retestErrorEntry("não existe", "ok"), null);
});

test("caderno de erros: reincidente aparece na terceira vez e passa na frente da fila", () => {
  const st = freshState();
  st.errorNotebook = [
    normalizeErrorEntry({ id: "velho", subjectId: "s1", statement: "a", dueDate: "2026-11-01" }),
    normalizeErrorEntry({ id: "reinc", subjectId: "s1", statement: "b", dueDate: "2026-11-09", lapses: 2 }),
    normalizeErrorEntry({ id: "novo", subjectId: "s1", statement: "c", dueDate: "2026-11-05" }),
    normalizeErrorEntry({ id: "futuro", subjectId: "s1", statement: "d", dueDate: "2026-12-30", lapses: 9 }),
    normalizeErrorEntry({ id: "dominado", subjectId: "s1", statement: "e", mastered: true, lapses: 5 }),
  ];
  assert.strictEqual(ctx.errorIsLeech(st.errorNotebook[1]), false, "2 erros ainda não é reincidente");
  const step = ctx.retestErrorEntry("reinc", "forgot");
  assert.strictEqual(step.leech, true);
  assert.strictEqual(ctx.errorIsLeech(st.errorNotebook[1]), true);
  assert.strictEqual(ctx.errorIsLeech(st.errorNotebook[4]), false, "dominado não é reincidente");
  const due = ctx.getDueErrors("2026-12-01").map((entry) => entry.id);
  assert.strictEqual(JSON.stringify(due), JSON.stringify(["reinc", "velho", "novo"]), "reincidentes primeiro, depois os mais antigos");
});

test("caderno de erros: reforço do assunto não duplica e exige matéria", () => {
  const st = freshState();
  const entry = normalizeErrorEntry({ id: "e1", subjectId: "s1", topicId: "t1", statement: "q" });
  st.errorNotebook = [entry];
  const first = ctx.errorCreateReinforcement(entry);
  assert.ok(first.created);
  assert.strictEqual(first.created.kind, "weak");
  assert.strictEqual(first.created.topicId, "t1");
  assert.strictEqual(first.created.dueDate, ctx.cycleToday(), "aparece nas revisões de hoje");
  assert.ok(ctx.errorCreateReinforcement(entry).existing, "já aberto: não cria outro");
  assert.strictEqual(st.revisions.length, 1);
  const orphan = normalizeErrorEntry({ id: "e2", statement: "q" });
  assert.ok(ctx.errorCreateReinforcement(orphan).error);
});

console.log(`ciclo-tests: ${passed} testes passaram.`);
