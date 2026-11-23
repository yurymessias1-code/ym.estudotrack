const { launchBrowser } = require("./helpers");
const assert = require("assert");
const BASE = process.env.BASE_URL;

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push("console: " + m.text()); });
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(BASE);
  await page.fill("#profileName", "relatorios");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv"); };
    state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }, { id: "s2", name: "Língua Portuguesa", color: "#c2410c", goalHours: 5 });
    state.edital.weeklyHours = 10;
    // 5 dias seguidos (hoje e os 4 anteriores), um dia de folga e mais 4 dias
    [[0, 90], [-1, 45], [-2, 30], [-3, 130], [-4, 20], [-6, 60], [-7, 60], [-8, 25], [-9, 40]].forEach(([offset, minutes], i) => {
      state.studyLogs.push({ id: `L${i}`, subjectId: i % 2 ? "s2" : "s1", topicId: "", competitionId: "", minutes, date: d(offset), source: "Manual", note: "", createdAt: new Date().toISOString() });
    });
    const history = (list) => list.map(([offset, result]) => ({ date: d(offset), stage: 0, result, note: "" }));
    state.revisions.push(
      normalizeRevision({ id: "r1", kind: "manual", subjectId: "s1", originKey: "m1", baseDate: d(-10), dueDate: d(3), stage: 2, history: history([[-5, "ok"], [-2, "easy"], [-1, "ok"]]) }),
      normalizeRevision({ id: "r2", kind: "manual", subjectId: "s2", originKey: "m2", baseDate: d(-10), dueDate: d(0), stage: 0, history: history([[-3, "forgot"], [-1, "hard"], [0, "ok"]]) }),
      normalizeRevision({ id: "r3", kind: "manual", subjectId: "s2", originKey: "m3", baseDate: d(-3), dueDate: d(-2), stage: 0 })
    );
    state.errorNotebook.push(
      normalizeErrorEntry({ id: "e1", subjectId: "s1", date: d(-1), statement: "Q1", correctAnswer: "A", reason: "confusao", dueDate: d(1) }),
      normalizeErrorEntry({ id: "e2", subjectId: "s1", date: d(-3), statement: "Q2", correctAnswer: "A", reason: "confusao", mastered: true, dueDate: "" }),
      normalizeErrorEntry({ id: "e3", subjectId: "s2", date: d(-20), statement: "Q3", correctAnswer: "A", reason: "atencao", dueDate: d(0) })
    );
    saveState();
    render();
  });

  // ---- tela Hoje mostra a sequência
  await page.waitForTimeout(250);
  assert((await page.textContent("#todaySub")).includes("Sequência de 5 dias"), "Hoje: " + (await page.textContent("#todaySub")));

  // ---- relatórios
  await page.click('.nav-button[data-view="relatorios"]');
  await page.waitForTimeout(400);
  assert(await page.isVisible("#reportCycle"), "painel visível");
  const text = await page.textContent("#reportCycle");
  assert(text.includes("O método está funcionando?"));
  const stats = await page.evaluate(() => [...document.querySelectorAll("#reportCycle .stat-card")].map((card) => card.textContent.replace(/\s+/g, " ").trim()));
  console.log("cartões:", JSON.stringify(stats));
  assert(stats[0].includes("Sequência atual") && stats[0].includes("5 dias"), stats[0]);
  assert(stats[1].includes("Melhor sequência") && stats[1].includes("5 dias"), stats[1]);
  assert(stats[2].includes("Dias estudados") && stats[2].includes("9 de 30"), stats[2]);
  assert(stats[4].includes("Retenção") && stats[4].includes("67%"), "4 de 6 revisões lembradas: " + stats[4]);
  assert(stats[5].includes("Revisões feitas") && stats[5].includes("6") && stats[5].includes("1 marcadas como Esqueci"), stats[5]);

  const counts = await page.evaluate(() => ({
    cells: document.querySelectorAll("#reportCycle .heatmap > .heat").length,
    active: document.querySelectorAll("#reportCycle .heatmap > .heat:not(.heat-0):not(.future)").length,
    future: document.querySelectorAll("#reportCycle .heatmap > .heat.future").length,
    aria: document.querySelector("#reportCycle .heatmap").getAttribute("aria-label"),
    adherenceRows: document.querySelectorAll("#reportCycle .insight-list")[0].querySelectorAll(".performance-row").length,
    loadBars: document.querySelectorAll("#reportCycle .load-bar").length,
    weakRows: [...document.querySelectorAll("#reportCycle tr.weak-row td:first-child")].map((td) => td.textContent),
    reasonRows: document.querySelectorAll("#reportCycle .insight-list")[1].querySelectorAll(".performance-row").length,
    miniBars: document.querySelectorAll("#reportCycle .mini-bars")[0].children.length,
  }));
  console.log("estrutura:", JSON.stringify(counts));
  assert.strictEqual(counts.cells, 84, "12 semanas × 7 dias");
  assert.strictEqual(counts.active, 9, "um quadrado por dia estudado");
  assert(counts.future >= 0 && counts.future <= 6);
  assert(counts.aria.includes("9 dias estudados"), counts.aria);
  assert.strictEqual(counts.adherenceRows, 8, "8 semanas de aderência");
  assert.strictEqual(counts.loadBars, 14, "14 dias de carga");
  assert.deepStrictEqual(counts.weakRows, ["Língua Portuguesa"], "matéria com retenção abaixo de 70% destacada");
  assert.strictEqual(counts.reasonRows, 2, "'confusão' (2 erros) e 'atenção' (o de 20 dias atrás também está nos 90 dias)");
  assert.strictEqual(counts.miniBars, 8);
  assert((await page.textContent("#reportCycle")).includes("meta atual: 10h"), "meta semanal vem das horas do edital");
  assert((await page.textContent("#reportCycle")).includes("1 de 3 dominados (33%)"), "dominados: " + (await page.textContent("#reportCycle")).slice(-400));
  // carga de hoje inclui atrasadas
  const todayLoad = await page.evaluate(() => document.querySelector("#reportCycle .load-bar").getAttribute("title"));
  assert(todayLoad.includes("inclui atrasadas"), todayLoad);
  await page.screenshot({ path: "relatorios-ciclo.png", fullPage: true });

  // ---- celular: sem rolagem horizontal na página
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.strictEqual(overflow, 0, "sem rolagem horizontal no celular");
  await page.screenshot({ path: "relatorios-ciclo-celular.png" });

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E RELATORIOS OK");
})().catch((e) => { console.error("E2E RELATORIOS FALHOU:", e.message); process.exit(1); });
