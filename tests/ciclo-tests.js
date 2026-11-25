const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.resolve(__dirname, "..", "ciclo.js"), "utf8");
const ctx = vm.createContext({ console, TextEncoder });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", "caderno.js"), "utf8"), ctx); // o ciclo usa as constantes e funções do caderno
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

test("revisão: 'forgot' desce duas etapas, sem apagar todo o progresso", () => {
  const show = (stage, intervals = [1, 7, 30, 60]) => JSON.stringify(cycleReviewStep(stage, "forgot", intervals));
  assert.strictEqual(show(3), JSON.stringify({ done: false, stage: 1, gap: 7 }), "item de 60 dias volta para 7, não para 1");
  assert.strictEqual(show(2), JSON.stringify({ done: false, stage: 0, gap: 1 }));
  assert.strictEqual(show(1), JSON.stringify({ done: false, stage: 0, gap: 1 }));
  assert.strictEqual(show(0), JSON.stringify({ done: false, stage: 0, gap: 1 }));
  assert.strictEqual(show(4, [1, 3, 7, 15, 30]), JSON.stringify({ done: false, stage: 2, gap: 7 }));
  assert.strictEqual(show(9, [1, 7]), JSON.stringify({ done: false, stage: 0, gap: 1 }), "etapa fora da lista não quebra");
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
   function getEntrySubjectId(entry) { return entry.subjectId || (getTopic(entry.topicId) || {}).subjectId || ""; }
   function getTopicLabel(id) { const t = getTopic(id); return t ? ((getSubject(t.subjectId) || {}).name || "") + ": " + t.name : ""; }
   function normalizeHashtags(value) { return String(value || "").split(/\\s+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean); }`,
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


/* ---------- prova (item 3), desce etapas (item 2) e erro repetido (item 4) ---------- */

test("prova: o intervalo encurta para no máximo metade do tempo que falta", () => {
  const cap = ctx.cycleCapGapForExam;
  assert.strictEqual(cap(30, "2026-11-01", "2026-12-01"), 15, "30 dias para a prova: no máximo 15");
  assert.strictEqual(cap(7, "2026-11-01", "2026-12-31"), 7, "prova longe: não muda");
  assert.strictEqual(cap(60, "2026-11-01", "2026-11-03"), 1, "2 dias: revisão na véspera");
  assert.strictEqual(cap(60, "2026-11-01", "2026-11-02"), 1, "prova amanhã: o mínimo é 1 dia");
  assert.strictEqual(cap(30, "2026-11-01", "2026-11-01"), 30, "prova hoje ou passada: sem ajuste");
  assert.strictEqual(cap(30, "2026-11-10", "2026-11-01"), 30);
  assert.strictEqual(cap(30, "2026-11-01", ""), 30, "sem prova: sem ajuste");
  // aplicando em sequência, as revisões ficam cada vez mais juntas: passa pela véspera e nada fica depois da prova
  let today = "2026-11-01";
  const exam = "2026-12-01";
  const days = [];
  while (today < exam) {
    today = cycleAddDays(today, cap(60, today, exam));
    days.push(today);
  }
  assert.ok(days.includes(cycleAddDays(exam, -1)), "tem revisão na véspera: " + days.join(","));
  assert.ok(days.every((day) => day <= exam), "nenhuma revisão depois da prova: " + days.join(","));
  assert.ok(days.length >= 5 && days.length <= 8, "poucas revisões, cada vez mais próximas: " + days.join(","));
});

test("prova: usa a prova mais próxima que vale para a matéria", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  st.competitions = [
    { id: "c1", date: ctx.cycleAddDays(today, 40), subjectIds: ["s1"] },
    { id: "c2", date: ctx.cycleAddDays(today, 10), subjectIds: ["s2"] },
    { id: "c3", date: ctx.cycleAddDays(today, 90), subjectIds: [] }, // sem matérias marcadas: vale para todas
    { id: "c4", date: ctx.cycleAddDays(today, -3), subjectIds: ["s1"] }, // já passou
    { id: "c5", date: "", subjectIds: ["s1"] },
  ];
  assert.strictEqual(ctx.cycleNextExamDate("s1", today), ctx.cycleAddDays(today, 40));
  assert.strictEqual(ctx.cycleNextExamDate("s2", today), ctx.cycleAddDays(today, 10));
  assert.strictEqual(ctx.cycleNextExamDate("zzz", today), ctx.cycleAddDays(today, 90), "matéria fora das provas: só a que vale para todas");
  assert.strictEqual(ctx.cycleNextExamDate("", today), ctx.cycleAddDays(today, 10), "sem matéria: a mais próxima de todas");
  st.competitions = [];
  assert.strictEqual(ctx.cycleNextExamDate("s1", today), "");
});

test("prova: revisão e erro usam o intervalo ajustado, e dá para desligar", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  st.cycleSettings.levelLoad = false; // aqui só a prova está em teste
  st.competitions = [{ id: "c1", date: ctx.cycleAddDays(today, 20), subjectIds: ["s1"] }];
  st.revisions = [normalizeRevision({ id: "r1", kind: "study", subjectId: "s1", topicId: "t1", stage: 2, dueDate: today })];
  const step = ctx.completeRevision("r1", "ok", "");
  assert.strictEqual(step.gap, 10, "próximo intervalo seria 60; faltam 20 dias para a prova");
  assert.strictEqual(st.revisions[0].dueDate, ctx.cycleAddDays(today, 10));
  assert.strictEqual(step.examDate, ctx.cycleAddDays(today, 20));

  st.errorNotebook = [normalizeErrorEntry({ id: "e1", subjectId: "s1", statement: "q", stage: 3, dueDate: today })];
  const errStep = ctx.retestErrorEntry("e1", "ok"); // intervalo da etapa 4 seria 30
  assert.strictEqual(errStep.gap, 10);
  assert.strictEqual(st.errorNotebook[0].dueDate, ctx.cycleAddDays(today, 10));

  st.cycleSettings.examAdapt = false;
  st.revisions = [normalizeRevision({ id: "r2", kind: "study", subjectId: "s1", topicId: "t1", stage: 2, dueDate: today })];
  assert.strictEqual(ctx.completeRevision("r2", "ok", "").gap, 60, "com a opção desligada, nada muda");
  assert.strictEqual(normalizeCycleSettings({}).examAdapt, true, "ligada por padrão");
  assert.strictEqual(normalizeCycleSettings({ examAdapt: false }).examAdapt, false);
});

test("errar de novo desce etapas na revisão e no caderno", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  st.cycleSettings.levelLoad = false; // aqui só a descida de etapas está em teste
  st.revisions = [normalizeRevision({ id: "r1", kind: "study", subjectId: "s1", topicId: "t1", stage: 3, dueDate: today })];
  const step = ctx.completeRevision("r1", "forgot", "");
  assert.strictEqual(st.revisions[0].stage, 1);
  assert.strictEqual(step.gap, 7);
  assert.strictEqual(st.revisions[0].dueDate, ctx.cycleAddDays(today, 7));
  st.errorNotebook = [normalizeErrorEntry({ id: "e1", subjectId: "s1", statement: "q", stage: 4, dueDate: today })];
  ctx.retestErrorEntry("e1", "forgot");
  assert.strictEqual(st.errorNotebook[0].stage, 2, "erro no estágio 4 desce para o 2, não para o 0");
  assert.strictEqual(st.errorNotebook[0].dueDate, ctx.cycleAddDays(today, 7));
  assert.strictEqual(st.errorNotebook[0].lapses, 1);
});

test("erro repetido: reconhece o mesmo enunciado ignorando acento, pontuação e maiúsculas", () => {
  const key = ctx.errorStatementKey;
  assert.strictEqual(key("  A Súmula 568 do STJ,  permite…  decisão monocrática?! "), key("a sumula 568 do stj permite decisao monocratica"));
  const entries = [
    normalizeErrorEntry({ id: "a", subjectId: "s1", statement: "A súmula 568 do STJ permite decisão monocrática do relator." }),
    normalizeErrorEntry({ id: "b", subjectId: "s1", statement: "curto" }),
  ];
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "A SUMULA 568 do STJ permite decisao monocratica do relator" }).id, "a");
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "A súmula 568 do STJ permite decisão monocrática do relator." }, "a"), null, "ignora o próprio registro");
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "curto" }), null, "enunciado curto demais não é comparado");
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "" }), null);
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "Outro enunciado bem diferente, com bastante texto." }), null);
});

test("erro repetido: soma na contagem, reabre o dominado e junta o que veio no novo registro", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  const existing = normalizeErrorEntry({
    id: "a",
    subjectId: "s1",
    statement: "A súmula 568 do STJ permite decisão monocrática do relator.",
    mastered: true,
    stage: 4,
    lapses: 1,
    attempts: 3,
    rule: "",
    correctAnswer: "",
    images: [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }, { id: "i5" }],
    notes: "<p>nota velha</p>",
    tags: "#stj",
  });
  st.errorNotebook = [existing];
  const incoming = normalizeErrorEntry({
    statement: "a sumula 568 do STJ permite decisao monocratica do relator",
    rule: "Súmula 568: pode, quando houver entendimento dominante.",
    correctAnswer: "Certo",
    images: [{ id: "i5" }, { id: "n1" }, { id: "n2" }],
    notes: "<p>nota nova</p>",
    tags: "#penal #stj",
  });
  const { entry, droppedImages } = ctx.errorRegisterRepeat(existing, incoming, today);
  assert.strictEqual(st.errorNotebook.length, 1, "não duplicou");
  assert.strictEqual(entry.lapses, 2);
  assert.strictEqual(entry.attempts, 4);
  assert.strictEqual(entry.mastered, false, "voltou para a fila");
  assert.strictEqual(entry.stage, 2, "desceu duas etapas");
  assert.strictEqual(entry.lastResult, "wrong");
  assert.strictEqual(entry.dueDate, ctx.cycleAddDays(today, 7));
  assert.strictEqual(entry.rule, incoming.rule, "campo vazio recebe o novo");
  assert.strictEqual(entry.correctAnswer, "Certo");
  assert.strictEqual(JSON.stringify(entry.images.map((image) => image.id)), JSON.stringify(["i1", "i2", "i3", "i4", "i5", "n1"]), "print repetido não entra de novo; respeita o limite de 6");
  assert.strictEqual(JSON.stringify(droppedImages.map((image) => image.id)), JSON.stringify(["n2"]), "o que não coube é devolvido para ser apagado");
  assert.ok(/nota velha/.test(entry.notes) && /nota nova/.test(entry.notes), "anotações juntas: " + entry.notes);
  assert.strictEqual(JSON.stringify([...entry.tags].sort()), JSON.stringify(["penal", "stj"]));
  // quem já tinha regra mantém a sua
  const kept = ctx.errorRegisterRepeat(normalizeErrorEntry({ id: "z", subjectId: "s1", statement: "x".repeat(30), rule: "minha regra" }), normalizeErrorEntry({ statement: "x".repeat(30), rule: "outra" }), today).entry;
  assert.strictEqual(kept.rule, "minha regra");
});


/* ---------- carga do dia (item 5): nivelar ao agendar e redistribuir erros ---------- */

test("carga do dia: o dia mais vazio perto do previsto ganha, e só se for realmente mais vazio", () => {
  const today = "2026-11-10";
  const day = (n) => cycleAddDays(today, n);
  const level = (gap, loads, options) => ctx.cycleLevelGap(gap, Object.fromEntries(Object.entries(loads).map(([n, count]) => [day(Number(n)), count])), today, options);
  assert.strictEqual(level(1, { 1: 9, 2: 0 }), 1, "intervalo de 1 dia nunca anda");
  assert.strictEqual(level(2, { 2: 9, 3: 0, 1: 0 }), 2, "nem o de 2 dias");
  assert.strictEqual(level(7, { 6: 3, 7: 3, 8: 1 }), 8, "o dia seguinte está mais leve");
  assert.strictEqual(level(7, { 6: 2, 7: 2, 8: 2 }), 7, "empate: fica o previsto");
  assert.strictEqual(level(7, { 6: 1, 7: 3, 8: 1 }), 6, "empate entre vizinhos: o mais cedo");
  assert.strictEqual(level(7, { 6: 5, 7: 1, 8: 5 }), 7, "o previsto já é o mais leve");
  assert.strictEqual(level(7, { 5: 0, 6: 4, 7: 4, 8: 4, 9: 0 }), 7, "até 14 dias só anda 1 dia: os dias 5 e 9 vazios não valem");
  assert.strictEqual(level(30, { 28: 0, 29: 5, 30: 5, 31: 5, 32: 2 }), 28, "intervalos longos andam até 2 dias");
  assert.strictEqual(level(10, { 9: 2, 10: 4, 11: 0 }, { maxGap: 10 }), 9, "com limite (prova), não passa dele");
  assert.strictEqual(level(3, {}), 3, "sem carga nenhuma, nada muda");
  assert.strictEqual(ctx.cycleLevelRadius(2), 0);
  assert.strictEqual(ctx.cycleLevelRadius(3), 1);
  assert.strictEqual(ctx.cycleLevelRadius(14), 1);
  assert.strictEqual(ctx.cycleLevelRadius(15), 2);
});

test("carga do dia: conta revisões abertas e erros não dominados, de hoje em diante", () => {
  const today = "2026-11-10";
  const revisions = [
    normalizeRevision({ id: "a", kind: "study", subjectId: "s1", dueDate: "2026-11-12" }),
    normalizeRevision({ id: "b", kind: "study", subjectId: "s1", dueDate: "2026-11-12" }),
    normalizeRevision({ id: "c", kind: "study", subjectId: "s1", dueDate: "2026-11-12", status: "done" }),
    normalizeRevision({ id: "d", kind: "study", subjectId: "s1", dueDate: "2026-11-01" }),
  ];
  const errors = [
    normalizeErrorEntry({ id: "e1", subjectId: "s1", statement: "q", dueDate: "2026-11-12" }),
    normalizeErrorEntry({ id: "e2", subjectId: "s1", statement: "q", dueDate: "2026-11-12", mastered: true }),
    normalizeErrorEntry({ id: "e3", subjectId: "s1", statement: "q", dueDate: "2026-11-13" }),
  ];
  assert.strictEqual(JSON.stringify(ctx.cycleLoadByDate(revisions, errors, today)), JSON.stringify({ "2026-11-12": 3, "2026-11-13": 1 }));
  assert.strictEqual(ctx.cycleLoadByDate(revisions, errors, today, { revisionId: "a", errorId: "e1" })["2026-11-12"], 1, "o item reagendado não conta contra si mesmo");
});

test("carga do dia: revisão e erro são agendados no dia mais leve; dá para desligar", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  const due = (n) => ctx.cycleAddDays(today, n);
  // dia 7 já tem 2 revisões e 1 erro; o dia 6 tem 1; o dia 8 está vazio
  st.revisions = [
    normalizeRevision({ id: "x1", kind: "study", subjectId: "s2", topicId: "t2", dueDate: due(7) }),
    normalizeRevision({ id: "x2", kind: "study", subjectId: "s2", topicId: "t2", dueDate: due(7) }),
    normalizeRevision({ id: "x3", kind: "manual", subjectId: "s2", dueDate: due(6) }),
    normalizeRevision({ id: "r1", kind: "study", subjectId: "s1", topicId: "t1", stage: 0, dueDate: today }),
  ];
  st.errorNotebook = [
    normalizeErrorEntry({ id: "ex", subjectId: "s2", statement: "outro", dueDate: due(7) }),
    normalizeErrorEntry({ id: "e1", subjectId: "s1", statement: "q", stage: 1, dueDate: today }),
  ];
  const step = ctx.completeRevision("r1", "ok", ""); // etapa 1: intervalo de 7 dias
  assert.strictEqual(step.leveled, true);
  assert.strictEqual(step.gap, 8, "o dia 8 estava vazio");
  assert.strictEqual(st.revisions[3].dueDate, due(8));

  const errStep = ctx.retestErrorEntry("e1", "ok"); // etapa 2: intervalo de 7 dias; agora o dia 8 tem 1 item (a revisão)
  assert.strictEqual(st.errorNotebook[1].dueDate, due(errStep.gap));
  assert.ok(errStep.gap === 6 || errStep.gap === 8, "foi para um vizinho");
  assert.ok([due(6), due(8)].includes(st.errorNotebook[1].dueDate));

  st.cycleSettings.levelLoad = false;
  st.revisions[3] = normalizeRevision({ id: "r2", kind: "study", subjectId: "s1", topicId: "t1", stage: 0, dueDate: today });
  assert.strictEqual(ctx.completeRevision("r2", "ok", "").gap, 7, "desligado: sempre o dia previsto");
  assert.strictEqual(normalizeCycleSettings({}).levelLoad, true, "ligada por padrão");
  assert.strictEqual(normalizeCycleSettings({ levelLoad: false }).levelLoad, false);
});

test("carga do dia: a prova manda mais que o nivelamento (não passa do dia limite)", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  st.competitions = [{ id: "c1", date: ctx.cycleAddDays(today, 20), subjectIds: ["s1"] }];
  st.revisions = [normalizeRevision({ id: "r1", kind: "study", subjectId: "s1", topicId: "t1", stage: 2, dueDate: today })];
  // o dia limite (10) está cheio e o 11 vazio: não pode ir para o 11
  st.errorNotebook = Array.from({ length: 4 }, (_, i) => normalizeErrorEntry({ id: `c${i}`, subjectId: "s2", statement: "q", dueDate: ctx.cycleAddDays(today, 10) }));
  const step = ctx.completeRevision("r1", "ok", "");
  assert.ok(step.gap <= 10, "limite da prova: " + step.gap);
});

test("redistribuir atrasados: erros entram na conta e no limite por dia", () => {
  const today = "2026-11-12";
  const rev = (id, dueDate, status = "pending") => normalizeRevision({ id, kind: "study", subjectId: "s1", dueDate, status });
  const err = (id, dueDate, extra = {}) => normalizeErrorEntry({ id, subjectId: "s1", statement: "enunciado " + id, dueDate, ...extra });
  const revisions = [rev("futura", "2026-11-12"), rev("velha", "2026-11-01")];
  const errors = [err("e1", "2026-11-02"), err("e2", "2026-11-03"), err("dom", "2026-11-04", { mastered: true }), err("hoje", "2026-11-12")];
  const changes = ctx.cycleRedistributeOverdue(revisions, today, 2, errors);
  assert.strictEqual(
    JSON.stringify(changes),
    JSON.stringify([
      { id: "velha", dueDate: "2026-11-13" }, // dia 12 já tem 2 (a revisão e o erro de hoje)
      { id: "e1", dueDate: "2026-11-13", kind: "error" },
      { id: "e2", dueDate: "2026-11-14", kind: "error" },
    ]),
    "mais antigos primeiro, revisões e erros dividem o mesmo limite, dominado não entra"
  );
  assert.strictEqual(JSON.stringify(ctx.cycleRedistributeOverdue(revisions, today, 2)), JSON.stringify([{ id: "velha", dueDate: "2026-11-12" }]), "sem a lista de erros, funciona como antes (só a revisão futura ocupa o dia 12)");
});


/* ---------- bola de neve: fila limitada, capacidade por dia, mínimo de estudo e ritmo sustentável ---------- */

test("capacidade: dia cheio empurra para o primeiro dia seguinte com vaga, dentro da folga e sem passar do limite", () => {
  const today = "2026-11-10";
  const day = (n) => cycleAddDays(today, n);
  const level = (gap, loads, options) => ctx.cycleLevelGap(gap, Object.fromEntries(Object.entries(loads).map(([n, count]) => [day(Number(n)), count])), today, options);
  assert.strictEqual(level(1, { 1: 2 }, { limit: 2 }), 2, "primeira revisão: amanhã cheio, vai para depois de amanhã");
  assert.strictEqual(level(1, { 1: 2, 2: 2, 3: 2 }, { limit: 2 }), 1, "tudo cheio na folga: fica no previsto (não foge para longe)");
  assert.strictEqual(level(7, { 6: 3, 7: 3, 8: 3, 9: 1 }, { limit: 3 }), 9, "dia 7 cheio, 6 e 8 também: o primeiro com vaga é o 9");
  assert.strictEqual(level(7, { 6: 3, 7: 3, 8: 3, 9: 1 }, { limit: 3, maxGap: 7 }), 7, "com limite de prova, não passa");
  assert.strictEqual(level(7, { 7: 50 }), 6, "sem limite de capacidade vale só o nivelamento: o vizinho vazio ganha do dia cheio");
  assert.strictEqual(ctx.cycleCapacitySlack(1), 2);
  assert.strictEqual(ctx.cycleCapacitySlack(7), 3);
  assert.strictEqual(ctx.cycleCapacitySlack(30), 10);
  assert.strictEqual(ctx.cycleCapacitySlack(200), 10, "folga tem teto");
});

test("capacidade: a primeira revisão de um assunto novo escorrega para o dia com vaga", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  st.cycleSettings.dailyLimit = 2;
  const due = (n) => ctx.cycleAddDays(today, n);
  st.revisions = [
    normalizeRevision({ id: "a", kind: "manual", subjectId: "s2", dueDate: due(1) }),
    normalizeRevision({ id: "b", kind: "manual", subjectId: "s2", dueDate: due(1) }),
  ];
  st.studyLogs = [{ id: "l1", topicId: "t1", subjectId: "", date: today, minutes: 30 }];
  assert.strictEqual(ctx.syncAutoRevisions(), 1);
  const created = st.revisions.find((r) => r.originKey === `study:t1:${today}`);
  assert.strictEqual(created.dueDate, due(2), "amanhã já tem 2 (o limite): vai para depois de amanhã");
  st.cycleSettings.levelLoad = false;
  st.revisions = st.revisions.slice(0, 2);
  assert.strictEqual(ctx.syncAutoRevisions(), 1);
  assert.strictEqual(st.revisions.find((r) => r.originKey === `study:t1:${today}`).dueDate, due(1), "com a opção desligada, o dia previsto");
});

test("mínimo de estudo para abrir revisões: 20 minutos por padrão e ajustável", () => {
  const today = ctx.cycleToday();
  const st = freshState();
  assert.strictEqual(st.cycleSettings.minAutoMinutes, 20);
  st.studyLogs = [{ id: "l1", topicId: "t1", date: today, minutes: 15 }];
  assert.strictEqual(ctx.syncAutoRevisions(), 0, "15 minutos não abrem cadeia");
  st.studyLogs.push({ id: "l2", topicId: "t1", date: today, minutes: 10 });
  assert.strictEqual(ctx.syncAutoRevisions(), 1, "mas 15 + 10 no mesmo dia e assunto passam de 20");
  st.revisions = [];
  st.cycleSettings.minAutoMinutes = 30;
  assert.strictEqual(ctx.syncAutoRevisions(), 0, "limite ajustado para 30");
  assert.strictEqual(normalizeCycleSettings({}).minAutoMinutes, 20);
  assert.strictEqual(normalizeCycleSettings({ minAutoMinutes: 2 }).minAutoMinutes, 5, "mínimo de 5");
  assert.strictEqual(normalizeCycleSettings({ minAutoMinutes: 999 }).minAutoMinutes, 120, "máximo de 120");
});

test("fila do dia: limitada ao limite por dia, os mais urgentes primeiro, descontando o que já foi feito", () => {
  const today = ctx.cycleToday();
  const day = (n) => ctx.cycleAddDays(today, n);
  const st = freshState();
  st.cycleSettings.dailyLimit = 4;
  const rev = (id, dueDate, extra = {}) => normalizeRevision({ id, kind: "study", subjectId: "s1", topicId: "t1", originKey: id, dueDate, ...extra });
  st.revisions = [rev("r1", day(0)), rev("r2", day(0)), rev("r3", day(0)), rev("r4", day(0)), rev("r5", day(-10), { stage: 1 }), rev("r6", day(-3)), rev("futura", day(5))];
  st.errorNotebook = [
    normalizeErrorEntry({ id: "e1", subjectId: "s1", statement: "q1", lapses: 3, dueDate: day(0) }),
    normalizeErrorEntry({ id: "e2", subjectId: "s1", statement: "q2", dueDate: day(-1) }),
    normalizeErrorEntry({ id: "dom", subjectId: "s1", statement: "q3", mastered: true, dueDate: day(-9) }),
  ];
  const queue = ctx.cycleTodayQueue(today);
  assert.strictEqual(queue.totalDue, 8, "6 revisões e 2 erros vencem (futura e dominado não contam)");
  assert.strictEqual(JSON.stringify(queue.revisions.map((r) => r.id)), JSON.stringify(["r5", "r6", "r1"].sort((a, b) => st.revisions.find((r) => r.id === a).dueDate.localeCompare(st.revisions.find((r) => r.id === b).dueDate) || a.localeCompare(b))), "revisões escolhidas: as mais atrasadas e a primeira da fila, mostradas por data");
  assert.strictEqual(JSON.stringify(queue.errors.map((e) => e.id)), JSON.stringify(["e1"]), "o erro reincidente entra primeiro");
  assert.strictEqual(queue.waitingRevisions, 3);
  assert.strictEqual(queue.waitingErrors, 1);
  assert.strictEqual(queue.revisions.length + queue.errors.length, 4, "no máximo o limite");
  assert.strictEqual(ctx.getQueueRevisions(today).length, 3);
  assert.strictEqual(ctx.getQueueErrors(today).length, 1);

  // o que já foi feito hoje consome o limite
  st.revisions.push(rev("feita", day(7), { history: [{ date: today, stage: 0, result: "ok" }] }));
  const after = ctx.cycleTodayQueue(today);
  assert.strictEqual(after.revisions.length + after.errors.length, 3, "1 feita hoje: sobram 3 do limite de 4");
  assert.strictEqual(after.doneToday, 1);

  // "Revisar mais 5" e a opção de desligar o limite
  vm.runInContext(`cycleUI.extra = { date: "${today}", count: 5 };`, ctx);
  assert.strictEqual(ctx.cycleTodayQueue(today).revisions.length + ctx.cycleTodayQueue(today).errors.length, 8, "mais 5: cabe tudo");
  vm.runInContext("cycleUI.extra = { date: '2000-01-01', count: 99 };", ctx);
  assert.strictEqual(ctx.cycleTodayQueue(today).waitingRevisions + ctx.cycleTodayQueue(today).waitingErrors, 5, "o extra de outro dia não vale");
  vm.runInContext("cycleUI.extra = null;", ctx);
  st.cycleSettings.capQueue = false;
  const all = ctx.cycleTodayQueue(today);
  assert.strictEqual(all.revisions.length + all.errors.length, 8);
  assert.strictEqual(all.waitingRevisions + all.waitingErrors, 0);
});

test("fila do dia: item atrasado há muito tempo acaba passando na frente de um novo (ninguém fica esquecido)", () => {
  const today = ctx.cycleToday();
  const day = (n) => ctx.cycleAddDays(today, n);
  assert.ok(ctx.cyclePriority("revision", { dueDate: day(-12), stage: 2, kind: "study" }, today) > ctx.cyclePriority("revision", { dueDate: day(0), stage: 0, kind: "study" }, today));
  assert.strictEqual(ctx.cyclePriority("revision", { dueDate: day(-99), stage: 3, kind: "study" }, today), 30, "atraso tem teto de 30");
  assert.ok(ctx.cyclePriority("revision", { dueDate: day(0), stage: 2, kind: "weak" }, today) > ctx.cyclePriority("revision", { dueDate: day(0), stage: 2, kind: "study" }, today), "reforço pesa mais");
});

test("ritmo sustentável: estima as revisões por dia que o ritmo atual vai gerar e avisa quando passa do limite", () => {
  const today = ctx.cycleToday();
  const day = (n) => ctx.cycleAddDays(today, n);
  const st = freshState();
  st.cycleSettings.dailyLimit = 3;
  st.revisions = Array.from({ length: 7 }, (_, i) => normalizeRevision({ id: `n${i}`, kind: "study", subjectId: "s1", topicId: "t1", originKey: `k${i}`, baseDate: day(-i), dueDate: day(10) }));
  st.revisions.push(normalizeRevision({ id: "velha", kind: "study", subjectId: "s1", topicId: "t1", originKey: "kv", baseDate: day(-40), dueDate: day(10) }));
  st.errorNotebook = Array.from({ length: 7 }, (_, i) => normalizeErrorEntry({ id: `x${i}`, subjectId: "s1", statement: `enunciado ${i}`, date: day(-i), dueDate: day(10) }));
  const load = ctx.cycleSteadyLoad(st.revisions, st.errorNotebook, today, { revisionIntervals: [1, 7, 30, 60], errorIntervals: [1, 3, 7, 15, 30] });
  assert.strictEqual(load.newRevisions, 7, "só conta o que abriu nas últimas 2 semanas");
  assert.strictEqual(load.newErrors, 7);
  assert.strictEqual(load.revPerDay, 0.5);
  assert.strictEqual(load.steadyPerDay, 4.5, "0,5 assunto/dia × 4 revisões + 0,5 erro/dia × 5 refações");
  const note = ctx.cycleSustainabilityNote(today);
  assert.ok(note && /4\.5/.test(note.title), "avisa: " + (note && note.title));
  assert.ok(/bola de neve/.test(note.text) && /limite de 3/.test(note.text));
  st.cycleSettings.dailyLimit = 12;
  assert.strictEqual(ctx.cycleSustainabilityNote(today), null, "ritmo cabe no limite e nada aguarda: sem aviso");
  // itens aguardando espaço também viram aviso, mesmo com ritmo ok
  st.cycleSettings.dailyLimit = 1;
  st.revisions.push(normalizeRevision({ id: "d1", kind: "study", subjectId: "s1", topicId: "t1", originKey: "d1", baseDate: day(-60), dueDate: day(0) }), normalizeRevision({ id: "d2", kind: "study", subjectId: "s1", topicId: "t1", originKey: "d2", baseDate: day(-60), dueDate: day(0) }));
  st.revisions = st.revisions.filter((r) => !r.id.startsWith("n"));
  st.errorNotebook = [];
  const waiting = ctx.cycleSustainabilityNote(today);
  assert.ok(waiting && /aguarda/.test(waiting.title), "aviso de espera: " + (waiting && waiting.title));
});


test("erro repetido: reconhece enunciados parecidos, não só idênticos", () => {
  const base = "A tentativa é punível quando o crime não se consuma por circunstâncias alheias à vontade do agente, salvo disposição em contrário.";
  const entries = [
    normalizeErrorEntry({ id: "a", subjectId: "s1", statement: base }),
    normalizeErrorEntry({ id: "b", subjectId: "s1", statement: "A prescrição da pretensão punitiva extingue a punibilidade do réu antes do trânsito em julgado da sentença." }),
    normalizeErrorEntry({ id: "c", subjectId: "s1", statement: "curto demais" }),
  ];
  const sim = ctx.errorStatementSimilarity;
  assert.ok(sim(base, "Tentativa punível quando o crime não se consuma por circunstâncias alheias à vontade do agente, salvo disposição em contrário no Código Penal.") >= 0.7, "mesma questão com palavras a mais");
  assert.ok(sim(base, "Conforme o Código, a tentativa é punível se o crime não se consuma por circunstâncias alheias à vontade do agente, salvo previsão contrária.") >= 0.7, "mesma questão reescrita");
  assert.ok(sim(base, entries[1].statement) < 0.3, "assuntos diferentes não se parecem");
  assert.strictEqual(sim("poucas palavras aqui", "poucas palavras aqui"), 0, "textos com menos de 6 palavras não são comparados por semelhança");
  const found = ctx.errorFindDuplicate(entries, { statement: "Tentativa punível quando o crime não se consuma por circunstâncias alheias à vontade do agente salvo disposição em contrário no Código Penal" });
  assert.strictEqual(found && found.id, "a");
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "Tentativa punível quando o crime não se consuma por circunstâncias alheias à vontade do agente" }, "a"), null, "ignora o próprio registro");
  assert.strictEqual(ctx.errorFindDuplicate(entries, { statement: "A competência para julgar crimes federais é da Justiça Federal, conforme a Constituição da República." }), null, "outra questão");
  // enunciado inteiro contido no outro (com trechos a mais) conta como o mesmo, mesmo abaixo do limite de palavras em comum
  const shortBase = "tentativa punivel quando crime consuma circunstancias alheias vontade agente disposicao";
  const longer = shortBase + " salvo contrario penal codigo artigo";
  assert.ok(sim(shortBase, longer) >= 0.7, "contido: " + sim(shortBase, longer));
  assert.ok(sim(shortBase, shortBase + " um dois tres quatro cinco seis sete oito nove dez") < 0.7, "contido, mas o outro é bem maior: não conta");
});

console.log(`ciclo-tests: ${passed} testes passaram.`);
