const { launchBrowser } = require("./helpers");
const assert = require("assert");
const shots = "";
const URL_ = process.env.BASE_URL;

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(URL_);

  // ---- celular, sem login: o acesso precisa continuar visível
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert(await page.isVisible("#profileName"), "formulário de acesso deve aparecer no celular antes do login");
  assert(!(await page.isVisible(".bottom-nav")), "barra inferior não deve aparecer antes do login");
  await page.screenshot({ path: shots + "m-login.png" });
  console.log("celular sem login: acesso visível, sem barra inferior");
  await page.setViewportSize({ width: 1360, height: 900 });

  // ---- login e início em Hoje
  await page.fill("#profileName", "hoje");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);
  assert.strictEqual(await page.evaluate(() => state.ui.view), "hoje", "deve iniciar em Hoje");
  assert(await page.isVisible("#hoje"), "tela Hoje visível");
  assert((await page.textContent(".nav-button.active")).includes("Hoje"));
  assert((await page.locator(".nav-group-title").count()) >= 5, "menu agrupado");
  assert(!(await page.isVisible(".bottom-nav")), "barra inferior só no celular");
  console.log("inicia em Hoje; menu agrupado com", await page.locator(".nav-group-title").count(), "grupos");

  // ---- dados
  await page.evaluate(() => {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv"); };
    state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }, { id: "s2", name: "Língua Portuguesa", color: "#c2410c", goalHours: 5 });
    state.topics.push({ id: "t1", subjectId: "s1", name: "Teoria do crime", priority: "Alta", total: 0, correct: 0, wrong: 0 }, { id: "t2", subjectId: "s2", name: "Crase", priority: "Alta", total: 0, correct: 0, wrong: 0 });
    state.cycleSettings.studyWeekdays = [0, 1, 2, 3, 4, 5, 6];
    state.revisions.push(
      normalizeRevision({ kind: "manual", subjectId: "s1", topicId: "t1", originKey: "e2e:1", baseDate: d(-3), dueDate: d(0) }),
      normalizeRevision({ kind: "manual", subjectId: "s2", topicId: "t2", originKey: "e2e:2", baseDate: d(-3), dueDate: d(-1) })
    );
    state.errorNotebook.push(
      normalizeErrorEntry({ subjectId: "s1", topicId: "t1", date: d(-2), statement: "Dolo eventual exige vontade de produzir o resultado.", correctAnswer: "Errado: aceita o risco.", reason: "confusao", dueDate: d(0) }),
      normalizeErrorEntry({ subjectId: "s2", topicId: "t2", date: d(-2), statement: "Há crase antes de verbo.", correctAnswer: "Não há crase antes de verbo.", reason: "atencao", dueDate: d(0) })
    );
    state.lawPlans.push(normalizeLawPlan({ title: "CP, arts. 1º a 120", subjectId: "s1", unitLabel: "artigos", startUnit: 1, endUnit: 120, startDate: d(-1), endDate: d(10), weekdays: [0, 1, 2, 3, 4, 5, 6] }));
    state.flashcards.push(
      normalizeFlashcard({ subjectId: "s1", topicId: "t1", front: "Pergunta 1", back: "Resposta 1" }),
      normalizeFlashcard({ subjectId: "s1", topicId: "t1", front: "Pergunta 2", back: "Resposta 2" })
    );
    state.profile.createdAt = new Date(Date.now() - 20 * 86400000).toISOString();
    saveState(); render();
  });
  await page.waitForTimeout(300);

  // ---- Hoje: cartões e progresso
  const cards = await page.locator(".today-card").count();
  assert.strictEqual(cards, 5, "5 cartões: revisões, flashcards, erros, lei seca e estudo");
  const startText = await page.textContent("#startDayBtn");
  assert(startText.includes("Começar o dia"));
  const progress0 = await page.evaluate(() => cycleUI.todayData.progress);
  console.log("progresso inicial:", JSON.stringify(progress0), "| pendentes:", await page.evaluate(() => cycleUI.todayData.pending));
  assert.strictEqual(progress0.done, 0);
  assert(progress0.total >= 9, "2 rev + 2 flashcards + 2 erros + 1 lei + 2 estudo");
  // contadores no menu
  assert.strictEqual((await page.textContent('[data-nav-count="revisao"]')).trim(), "2");
  assert.strictEqual((await page.textContent('[data-nav-count="erros"]')).trim(), "2");
  assert.strictEqual((await page.textContent('[data-nav-count="flashcards"]')).trim(), "2", "contador dos flashcards no menu");

  // ---- registro rápido: o botão "Registrar" da linha abre o formulário já preenchido
  const pendingS1 = await page.evaluate(() => cycleUI.todayData.study.items.find((row) => row.subjectId === "s1").todayPending);
  await page.click('[data-cycle-action="quickStudy"][data-id="s1"]');
  await page.waitForTimeout(250);
  assert(await page.isVisible("#quickStudyForm"), "formulário de registro rápido abre");
  assert.strictEqual(await page.inputValue("#qsSubject"), "s1", "matéria pré-selecionada");
  assert.strictEqual(Number(await page.inputValue("#qsMinutes")), pendingS1, "minutos sugeridos pelo plano");
  await page.click('[data-cycle-action="quickStudyClose"]');
  await page.waitForTimeout(200);
  assert(!(await page.isVisible("#quickStudyForm")), "cancelar fecha o formulário");
  assert.strictEqual(await page.evaluate(() => state.studyLogs.length), 0, "cancelar não registra nada");
  await page.screenshot({ path: shots + "hoje-inicio.png", fullPage: true });

  // ---- Começar o dia: revisões -> erros -> lei -> estudo
  await page.click("#startDayBtn");
  await page.waitForTimeout(350);
  assert.strictEqual(await page.evaluate(() => state.ui.view), "revisao");
  assert((await page.textContent("#revisionSession")).includes("Revisão 1 de 2") || (await page.textContent("#revisionSession")).includes("revisão 1 de 2"), "sessão abre na primeira revisão");
  for (let i = 0; i < 2; i++) {
    await page.click('[data-cycle-action="revealSession"]');
    await page.click('[data-cycle-action="rateRevision"][data-result="ok"]');
    await page.waitForTimeout(250);
  }
  assert.strictEqual(await page.evaluate(() => state.ui.view), "flashcards", "após as revisões, segue para os flashcards");
  for (let i = 0; i < 2; i++) {
    await page.click('[data-action="showFlashcardAnswer"]');
    await page.click('[data-action="reviewFlashcard"][data-result="correct"]');
    await page.waitForTimeout(250);
  }
  assert.strictEqual(await page.evaluate(() => state.ui.view), "erros", "após os flashcards, segue para o caderno de erros");
  assert((await page.textContent("#errorList")).includes("Mostrar gabarito"), "erro abre em modo refazer");
  for (let i = 0; i < 2; i++) {
    await page.click('[data-cycle-action="showErrorAnswer"]');
    await page.click('[data-cycle-action="errorResult"][data-result="ok"]');
    await page.waitForTimeout(250);
  }
  assert.strictEqual(await page.evaluate(() => state.ui.view), "leiseca", "após os erros, segue para a lei seca");
  await page.click('#leiseca [data-cycle-action="lawDone"]');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => state.ui.view), "pomodoro", "após a lei seca, segue para o estudo do dia");
  const timerSubject = await page.inputValue("#timerSubject");
  console.log("fluxo guiado ok; Pomodoro abriu com matéria:", timerSubject);
  assert(["s1", "s2"].includes(timerSubject), "Pomodoro deve abrir com a matéria sugerida");

  // ---- registrar o estudo sugerido -> dia concluído
  await page.evaluate(() => {
    const today = new Date().toLocaleDateString("sv");
    cycleUI.todayData.study.items.forEach((row, i) => state.studyLogs.push({ id: "sl" + i, subjectId: row.subjectId, topicId: "", minutes: row.todayTarget, date: today, source: "Manual" }));
    saveState(); setView("hoje");
  });
  await page.waitForTimeout(300);
  const finished = await page.evaluate(() => ({ progress: cycleUI.todayData.progress, pending: cycleUI.todayData.pending }));
  console.log("depois do estudo:", JSON.stringify(finished));
  assert.strictEqual(finished.pending, 0);
  assert.strictEqual(finished.progress.pct, 100);
  assert(await page.isDisabled("#startDayBtn"), "botão desabilitado com o dia concluído");
  assert((await page.textContent("#startDayBtn")).includes("Dia concluído"));
  await page.screenshot({ path: shots + "hoje-concluido.png", fullPage: true });

  // ---- reforço automático por desempenho
  await page.evaluate(() => {
    state.questionLogs.push({ id: "qa", subjectId: "s2", topicId: "t2", correct: 5, wrong: 8, date: new Date().toLocaleDateString("sv"), source: "Simulado" });
    saveState(); render();
  });
  await page.waitForTimeout(300);
  let weak = await page.evaluate(() => state.revisions.filter((r) => r.kind === "weak").map((r) => ({ topic: r.topicId, due: r.dueDate })));
  console.log("reforço criado:", JSON.stringify(weak));
  assert.strictEqual(weak.length, 1, "deveria criar 1 reforço");
  await page.evaluate(() => { render(); render(); });
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "weak").length), 1, "não duplica");
  const insights = await page.textContent("#todayInsights");
  assert(insights.includes("Crase") && insights.includes("38%"), "insight do assunto fraco: " + insights);
  assert((await page.textContent('[data-nav-count="revisao"]')).trim() === "1", "o reforço aparece como revisão pendente");
  assert((await page.textContent("#todayTasks")).includes("Reforço: Língua Portuguesa"), "cartão de revisões mostra o reforço");
  await page.screenshot({ path: shots + "hoje-reforco.png", fullPage: true });
  // desligar nas configurações impede novos reforços
  await page.evaluate(() => { state.cycleSettings.autoWeak = false; state.revisions = state.revisions.filter((r) => r.kind !== "weak"); saveState(); render(); });
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "weak").length), 0, "autoWeak desligado não recria");
  await page.evaluate(() => { state.cycleSettings.autoWeak = true; });

  // ---- registro rápido: grava o estudo e inicia a trilha de revisão do assunto
  await page.click('.nav-button[data-view="hoje"]');
  await page.click("#quickStudyBtn");
  await page.waitForTimeout(250);
  await page.selectOption("#qsSubject", "s1");
  await page.selectOption("#qsTopic", "t1");
  await page.click('[data-cycle-action="qsMinutes"][data-min="45"]');
  assert.strictEqual(await page.inputValue("#qsMinutes"), "45");
  const logsBefore = await page.evaluate(() => state.studyLogs.length);
  await page.click('#quickStudyForm button[type="submit"]');
  await page.waitForTimeout(300);
  const quick = await page.evaluate(() => {
    const log = state.studyLogs[state.studyLogs.length - 1];
    return { n: state.studyLogs.length, minutes: log.minutes, subject: log.subjectId, topic: log.topicId, note: log.note, date: log.date, source: log.source, chain: state.revisions.some((r) => r.kind === "study" && r.originKey === `study:t1:${log.date}`) };
  });
  console.log("registro rápido:", JSON.stringify(quick));
  assert.strictEqual(quick.n, logsBefore + 1);
  assert.strictEqual(quick.minutes, 45);
  assert.strictEqual(quick.subject, "s1");
  assert.strictEqual(quick.topic, "t1");
  assert.strictEqual(quick.note, "Registro rápido (Hoje)");
  assert.strictEqual(quick.source, "Manual");
  assert(quick.chain, "estudo de 45 min deve iniciar a trilha de revisão do assunto");
  assert(!(await page.isVisible("#quickStudyForm")), "formulário fecha depois de registrar");

  // ---- push: sem configuração, a tela explica e não deixa ativar
  await page.click('.nav-button[data-view="revisao"]');
  await page.waitForTimeout(400);
  assert((await page.textContent("#pushStatus")).includes("PUSH-SETUP"), "mensagem de push não configurado");
  assert(await page.isDisabled("#pushToggleBtn"), "ativar push fica desabilitado sem configuração");
  assert(await page.isDisabled("#pushTestBtn"));

  // ---- plano semanal
  await page.click('.nav-button[data-view="semana"]');
  await page.waitForTimeout(250);
  assert((await page.textContent("#weekTable")).includes("Direito Penal"));
  await page.evaluate(() => {
    state.edital.items.push(...Array.from({ length: 6 }, (_, i) => ({ id: "ed" + i, subjectName: "Direito Penal", topicName: "t" + i })), ...Array.from({ length: 2 }, (_, i) => ({ id: "ep" + i, subjectName: "Lingua Portuguesa", topicName: "p" + i })));
    saveState(); render();
  });
  await page.click('[data-cycle-action="weekImport"]');
  await page.waitForTimeout(250);
  const w = await page.evaluate(() => state.cycleSettings.weights);
  console.log("pesos do edital:", JSON.stringify(w));
  assert.strictEqual(w.s1, 6); assert.strictEqual(w.s2, 2);
  await page.fill("#weekHours", "20");
  await page.click('#weekForm button[type="submit"]');
  await page.waitForTimeout(250);
  assert.strictEqual(await page.evaluate(() => state.edital.weeklyHours), 20);
  const plan = await page.evaluate(() => getWeeklyPlanData().rows.map((r) => ({ id: r.subjectId, target: r.targetMin })));
  console.log("metas da semana:", JSON.stringify(plan));
  assert.strictEqual(plan.find((r) => r.id === "s1").target, 900); // 1200 * 6/8
  assert.strictEqual(plan.find((r) => r.id === "s2").target, 300);
  // editar peso na tabela
  await page.fill('[data-week-weight="s2"]', "0");
  await page.dispatchEvent('[data-week-weight="s2"]', "change");
  await page.waitForTimeout(250);
  assert.strictEqual(await page.evaluate(() => state.cycleSettings.weights.s2), 0);
  assert.strictEqual(await page.evaluate(() => getWeeklyPlanData().rows.find((r) => r.subjectId === "s2").targetMin), 0, "peso 0 tira do plano");
  await page.fill('[data-week-weight="s2"]', "2");
  await page.dispatchEvent('[data-week-weight="s2"]', "change");
  await page.waitForTimeout(200);
  await page.screenshot({ path: shots + "semana.png", fullPage: true });

  // ---- backup semanal
  await page.click('.nav-button[data-view="hoje"]');
  await page.waitForTimeout(250);
  assert(await page.isVisible("#todayBackup"), "lembrete de backup deve aparecer (conta antiga, sem backup)");
  assert((await page.textContent("#todayBackup")).includes("ainda não baixou"));
  await page.screenshot({ path: shots + "hoje-backup.png", fullPage: true });
  await page.click('[data-cycle-action="snoozeBackup"]');
  await page.waitForTimeout(200);
  assert(!(await page.isVisible("#todayBackup")), "adiar esconde");
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("ymEstudos.cycleBackup.")); localStorage.removeItem(k); render(); });
  assert(await page.isVisible("#todayBackup"));
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('#todayBackup [data-action="downloadBackup"]')]);
  assert(download.suggestedFilename().includes("backup"));
  await page.waitForTimeout(300);
  assert(!(await page.isVisible("#todayBackup")), "depois do backup o lembrete some");
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((x) => x.startsWith("ymEstudos.cycleBackup.")))).last);
  assert.strictEqual(last, await page.evaluate(() => new Date().toLocaleDateString("sv")));
  // lembrete de backup entra na notificação; 0 desliga
  assert.strictEqual(await page.evaluate(() => backupIsDue().due), false);
  await page.evaluate(() => { state.cycleSettings.backupDays = 0; localStorage.removeItem(Object.keys(localStorage).find((x) => x.startsWith("ymEstudos.cycleBackup."))); render(); });
  assert(!(await page.isVisible("#todayBackup")), "0 dias desliga o lembrete");
  await page.evaluate(() => { state.cycleSettings.backupDays = 7; });

  // ---- celular: barra inferior e painel Mais
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { setView("hoje"); window.scrollTo(0, 0); });
  await page.waitForTimeout(350);
  assert(await page.isVisible(".bottom-nav"), "barra inferior visível no celular");
  assert(!(await page.isVisible("#sidebarSheet")), "menu completo fechado por padrão");
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.strictEqual(hasOverflow, 0, "sem rolagem horizontal");
  // o conteúdo aparece logo no topo (antes ficava ~1500px abaixo do menu)
  const heroTop = await page.evaluate(() => document.querySelector("#hoje .today-hero").getBoundingClientRect().top);
  console.log("topo da tela Hoje no celular (px):", Math.round(heroTop));
  assert(heroTop < 320, "conteúdo deve começar no topo no celular");
  await page.screenshot({ path: shots + "m-hoje.png" });
  await page.click("#menuToggleBtn");
  await page.waitForTimeout(450);
  assert(await page.isVisible("#sidebarSheet"), "painel Mais abre");
  assert.strictEqual(await page.getAttribute("#menuToggleBtn", "aria-expanded"), "true");
  assert((await page.textContent("#menuToggleBtn")).includes("Fechar"));
  assert(await page.evaluate(() => document.body.classList.contains("menu-open")));
  await page.screenshot({ path: shots + "m-menu.png" });
  await page.click('#sidebarSheet .nav-button[data-view="leiseca"]');
  await page.waitForTimeout(450);
  assert.strictEqual(await page.evaluate(() => state.ui.view), "leiseca");
  assert(!(await page.isVisible("#sidebarSheet")), "painel fecha ao navegar");
  assert(!(await page.evaluate(() => document.body.classList.contains("menu-open"))), "rolagem do corpo liberada");
  // atalhos da barra
  await page.click('.bottom-nav-item[data-view="erros"]');
  await page.waitForTimeout(250);
  assert.strictEqual(await page.evaluate(() => state.ui.view), "erros");
  assert((await page.getAttribute('.bottom-nav-item[data-view="erros"]', "class")).includes("active"));
  // Esc fecha o painel
  await page.click("#menuToggleBtn");
  await page.waitForTimeout(350);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  assert(!(await page.isVisible("#sidebarSheet")), "Esc fecha o painel");
  // girar/ampliar para desktop com painel aberto não trava a rolagem
  await page.click("#menuToggleBtn");
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.waitForTimeout(400);
  assert(!(await page.evaluate(() => document.body.classList.contains("menu-open"))), "ao ampliar, o painel fecha");
  assert(await page.isVisible(".sidebar") && !(await page.isVisible(".bottom-nav")), "desktop volta ao menu lateral");

  // ---- reabrir o site: sempre começa em Hoje
  await page.evaluate(() => { setView("relatorios"); });
  await page.reload();
  await page.fill("#profileName", "hoje");
  await page.fill("#profilePin", "1234");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(700);
  assert.strictEqual(await page.evaluate(() => state.ui.view), "hoje", "ao reabrir, começa em Hoje");

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E 3 OK");
})().catch((e) => { console.error("E2E 3 FALHOU:", e.message); process.exit(1); });
