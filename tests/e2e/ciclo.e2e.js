const { launchBrowser } = require("./helpers");
const assert = require("assert");
const BASE = process.env.BASE_URL;
const shots = "";

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push("console: " + m.text()); });
  // modo local: sem Supabase e sem CDNs (rede desligada)
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(BASE);

  // perfil local
  await page.fill("#profileName", "teste");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);
  assert(!(await page.evaluate(() => document.body.classList.contains("profile-locked"))), "perfil não destravou");

  // matéria e assunto
  await page.click('.nav-button[data-view="plano"]');
  await page.fill("#subjectName", "Direito Constitucional");
  await page.click("#subjectSubmitBtn");
  await page.fill("#topicName", "Direitos fundamentais");
  await page.click("#topicSubmitBtn");

  // estudo manual de ontem (30 min) e de hoje (30 min): precisa gerar revisões só após autoSince -> hoje
  await page.click('.nav-button[data-view="pomodoro"]');
  await page.fill("#studyMinutes", "30");
  await page.evaluate(() => { document.querySelector("#studyDate").value = new Date().toISOString().slice(0, 10); });
  await page.selectOption("#studySubject", { index: 0 });
  await page.waitForTimeout(100);
  const studyForm = await page.evaluate(() => document.querySelector("#studyMinutes").closest("form").id);
  await page.evaluate((id) => document.getElementById(id).requestSubmit(), studyForm);
  await page.waitForTimeout(300);

  const revs = await page.evaluate(() => state.revisions.map((r) => ({ kind: r.kind, due: r.dueDate, base: r.baseDate, topic: r.topicId })));
  console.log("revisões geradas:", JSON.stringify(revs));
  assert.strictEqual(revs.length, 1, "deveria ter 1 revisão automática");

  // idempotência: re-render não duplica
  await page.evaluate(() => { render(); render(); });
  assert.strictEqual(await page.evaluate(() => state.revisions.length), 1, "duplicou revisão");

  // aba revisão: forçar vencimento para hoje e rodar sessão
  await page.evaluate(() => { state.revisions[0].dueDate = new Date().toISOString().slice(0, 10); saveState(); });
  await page.click('.nav-button[data-view="revisao"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: shots + "revisao-fila.png", fullPage: true });
  assert((await page.textContent("#revisionQueue")).includes("Direitos fundamentais") || (await page.textContent("#revisionQueue")).includes("Direito Constitucional"));
  await page.click('[data-cycle-action="openRevision"]');
  await page.fill("#revisionRecall", "Direitos individuais, coletivos, sociais...");
  await page.click('[data-cycle-action="revealSession"]');
  await page.screenshot({ path: shots + "revisao-sessao.png", fullPage: true });
  assert((await page.inputValue("#revisionRecall")).startsWith("Direitos"), "texto de lembrança perdido no re-render");
  await page.click('[data-cycle-action="rateRevision"][data-result="ok"]');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ stage: state.revisions[0].stage, due: state.revisions[0].dueDate, hist: state.revisions[0].history.length, note: state.revisions[0].history[0].note }));
  console.log("após 'Bom':", JSON.stringify(after));
  assert.strictEqual(after.stage, 1);
  assert.strictEqual(after.hist, 1);
  assert(after.note.startsWith("Direitos"));

  // revisão manual
  await page.fill("#revisionBaseDate", new Date().toISOString().slice(0, 10));
  await page.check("#revisionToday");
  await page.click('#revisionForm button[type="submit"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.revisions.length), 2);

  // caderno de erros
  await page.click('.nav-button[data-view="erros"]');
  await page.fill("#errorStatement", "O prazo do habeas data é de 10 dias.");
  await page.fill("#errorMyAnswer", "Marquei CERTO");
  await page.fill("#errorCorrect", "Errado: não há prazo; é gratuito.");
  await page.selectOption("#errorReason", "confusao");
  await page.fill("#errorFoundation", "art. 5º, LXXII, CF");
  await page.fill("#errorRule", "Habeas data: gratuito, sem prazo.");
  await page.fill("#errorTags", "#remedios #cf");
  await page.click("#errorSubmitBtn");
  await page.waitForTimeout(200);
  const err = await page.evaluate(() => ({ n: state.errorNotebook.length, due: state.errorNotebook[0].dueDate, tags: state.errorNotebook[0].tags }));
  console.log("erro salvo:", JSON.stringify(err));
  assert.strictEqual(err.n, 1);
  await page.screenshot({ path: shots + "erros.png", fullPage: true });
  // refazer: acertar 5x até dominar
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { state.errorNotebook[0].dueDate = new Date().toISOString().slice(0, 10); });
    await page.evaluate(() => render());
    await page.selectOption("#errorFilterStatus", "all");
    await page.click('[data-cycle-action="retestError"]');
    assert(!(await page.textContent("#errorList")).includes("Resposta correta"), "gabarito apareceu antes da hora");
    await page.click('[data-cycle-action="showErrorAnswer"]');
    if (i === 0) await page.screenshot({ path: shots + "erros-refazer.png", fullPage: true });
    await page.click('[data-cycle-action="errorResult"][data-result="ok"]');
  }
  assert.strictEqual(await page.evaluate(() => state.errorNotebook[0].mastered), true, "erro não foi dominado após 5 acertos");
  // reabrir e gerar flashcard
  await page.selectOption("#errorFilterStatus", "all");
  await page.click('[data-cycle-action="reopenError"]');
  await page.click('[data-cycle-action="errorToFlashcard"]');
  assert.strictEqual(await page.evaluate(() => state.flashcards.length), 1, "flashcard não criado");

  // lei seca
  await page.click('.nav-button[data-view="leiseca"]');
  await page.fill("#lawTitle", "CF/88 — arts. 1º a 100");
  await page.fill("#lawEndUnit", "100");
  await page.fill("#lawEndDate", await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 9); return d.toISOString().slice(0, 10); }));
  await page.check("input[name='lawWeekday'][value='0']");
  await page.click("#lawSubmitBtn");
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.lawPlans.length), 1);
  await page.click('[data-cycle-action="toggleLawSchedule"]');
  await page.screenshot({ path: shots + "leiseca.png", fullPage: true });
  await page.click('[data-cycle-action="lawDone"]');
  await page.waitForTimeout(200);
  const law = await page.evaluate(() => ({ done: state.lawPlans[0].doneWork, revs: state.revisions.filter((r) => r.kind === "law").length, label: state.revisions.find((r) => r.kind === "law")?.label }));
  console.log("lei seca:", JSON.stringify(law));
  assert(law.done > 0 && law.revs === 1);
  await page.fill(`#lawReadInput-${await page.evaluate(() => state.lawPlans[0].id)}`, "40");
  await page.click('[data-cycle-action="lawRegister"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.evaluate(() => state.lawPlans[0].doneWork), 40);
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "law").length), 1, "revisão do mesmo dia deveria ser unificada");
  await page.click('[data-cycle-action="lawUndo"]');
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => state.lawPlans[0].doneWork) < 40, "undo falhou");

  // painel + persistência após recarregar
  await page.click('.nav-button[data-view="dashboard"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: shots + "painel.png", fullPage: true });
  const strip = await page.textContent("#cycleStripDashboard");
  assert(strip.includes("Caderno de erros") && strip.includes("Lei seca"));
  const counts = await page.evaluate(() => [state.revisions.length, state.errorNotebook.length, state.lawPlans.length]);
  await page.reload();
  await page.fill("#profileName", "teste");
  await page.fill("#profilePin", "1234");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(500);
  const counts2 = await page.evaluate(() => [state.revisions.length, state.errorNotebook.length, state.lawPlans.length]);
  console.log("antes/depois do reload:", counts, counts2);
  assert.strictEqual(JSON.stringify(counts), JSON.stringify(counts2), "dados não persistiram");

  // tema escuro e mobile
  await page.click('.nav-button[data-view="revisao"]');
  await page.click("#themeToggleBtn");
  await page.waitForTimeout(150);
  await page.screenshot({ path: shots + "revisao-escuro.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click("#menuToggleBtn");
  await page.waitForTimeout(400);
  await page.click('#sidebarSheet .nav-button[data-view="leiseca"]');
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("overflow horizontal no mobile (px):", overflow);
  await page.screenshot({ path: shots + "leiseca-mobile.png", fullPage: true });

  // busca global
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.fill("#globalSearchInput", "habeas");
  await page.waitForTimeout(250);
  assert((await page.textContent("#globalSearchResults")).includes("Caderno de erros"), "busca global não achou o erro");

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E OK");
})().catch((e) => { console.error("E2E FALHOU:", e.message); process.exit(1); });
