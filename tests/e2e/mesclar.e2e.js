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
  page.on("dialog", (d) => d.accept());
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(BASE);
  await page.fill("#profileName", "mesclar");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);

  const modalOpen = () => page.evaluate(() => !document.querySelector("#mergeModal").classList.contains("hidden"));
  const insideModal = () => page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest("#mergeModal")));
  const today = new Date().toLocaleDateString("sv");

  await page.evaluate((d) => {
    state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }, { id: "s2", name: "Língua Portuguesa", color: "#c2410c", goalHours: 5 });
    state.topics.push(
      { id: "t1", subjectId: "s1", name: "Habeas-corpus", priority: "Alta" },
      { id: "t2", subjectId: "s1", name: "Habeas corpus", priority: "Alta" },
      { id: "t3", subjectId: "s2", name: "Crase", priority: "Média" },
      { id: "t4", subjectId: "s1", name: "Crase", priority: "Média" }
    );
    const log = (id, subjectId, topicId, minutes) => ({ id, subjectId, topicId, competitionId: "", minutes, date: d, source: "Manual", note: "", createdAt: new Date().toISOString() });
    state.studyLogs.push(log("L1", "s1", "t1", 30), log("L2", "s1", "t2", 20), log("L3", "s1", "t4", 15), log("L4", "s2", "t3", 25));
    state.errorNotebook.push(normalizeErrorEntry({ id: "E1", subjectId: "s1", topicId: "t1", statement: "Q", correctAnswer: "A" }));
    saveState(); render();
  }, today);
  await page.click('.nav-button[data-view="plano"]');
  await page.waitForTimeout(300);
  assert((await page.textContent("#plano")).includes("Habeas-corpus"), "o assunto aparece na lista de Matérias");
  assert(await page.isVisible('[data-cycle-action="mergeTopic"][data-id="t1"]'), "botão Mesclar no assunto");
  // o nome da matéria não pode ser espremido pelos botões (antes ficava com ~30 px e quebrava letra por letra)
  const titleWidths = await page.evaluate(() => [...document.querySelectorAll("#plano .subject-card")].map((card) => Math.round((card.querySelector("h3, strong") || card).getBoundingClientRect().width)));
  assert(titleWidths.length >= 2 && titleWidths.every((w) => w >= 120), "largura do nome da matéria: " + JSON.stringify(titleWidths));
  assert(await page.isVisible('[data-cycle-action="mergeSubject"][data-id="s1"]'), "botão Mesclar na matéria");

  // ---- abrir: destino sugerido, prévia, acessibilidade
  await page.focus('[data-cycle-action="mergeTopic"][data-id="t1"]');
  await page.click('[data-cycle-action="mergeTopic"][data-id="t1"]');
  await page.waitForTimeout(250);
  assert(await modalOpen());
  assert((await page.textContent("#mergeModalTitle")).includes("«Habeas-corpus»"));
  assert((await page.textContent("#mergeSummary")).includes("passa para o assunto escolhido"), "concordância no texto do assunto");
  assert.strictEqual(await page.evaluate(() => document.querySelector("#mergeTarget option").textContent), "Escolha o assunto de destino");
  assert.strictEqual(await page.inputValue("#mergeTarget"), "t2", "sugere o assunto parecido da mesma matéria");
  assert(!(await page.isDisabled("#mergeConfirmBtn")));
  const preview = await page.textContent("#mergePreview");
  assert(preview.includes("1 registro de estudo") && preview.includes("1 erro do caderno") && preview.includes("«Habeas corpus»"), "prévia: " + preview);
  assert(await insideModal(), "foco dentro da janela");
  assert(await page.evaluate(() => document.querySelector(".app-shell").hasAttribute("inert")), "fundo inerte");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert(await insideModal(), `Tab #${i + 1} escapou da janela`);
  }
  // sem destino, não dá para confirmar
  await page.selectOption("#mergeTarget", "");
  assert(await page.isDisabled("#mergeConfirmBtn"), "confirmar desabilitado sem destino");
  assert((await page.textContent("#mergePreview")).includes("Escolha o destino"));
  // Esc cancela sem alterar nada e devolve o foco
  const before = await page.evaluate(() => JSON.stringify([state.topics, state.studyLogs, state.errorNotebook]));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert(!(await modalOpen()));
  assert.strictEqual(await page.evaluate(() => JSON.stringify([state.topics, state.studyLogs, state.errorNotebook])), before, "Esc não altera nada");
  assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute("data-id")), "t1", "o foco volta ao botão Mesclar");
  assert(!(await page.evaluate(() => document.querySelector(".app-shell").hasAttribute("inert"))));

  // ---- confirmar a mesclagem do assunto
  await page.click('[data-cycle-action="mergeTopic"][data-id="t1"]');
  await page.waitForTimeout(200);
  await page.click("#mergeConfirmBtn");
  await page.waitForTimeout(350);
  assert(!(await modalOpen()));
  const after = await page.evaluate(() => ({ topics: state.topics.map((t) => t.id), l1: state.studyLogs.find((l) => l.id === "L1").topicId, e1: state.errorNotebook[0].topicId, tomb: state.meta.tombstones.topics }));
  console.log("assunto mesclado:", JSON.stringify(after));
  assert.deepStrictEqual(after.topics, ["t2", "t3", "t4"]);
  assert.strictEqual(after.l1, "t2");
  assert.strictEqual(after.e1, "t2");
  assert(after.tomb && after.tomb.t1, "a exclusão da origem foi registrada para a sincronização");
  assert(!(await page.textContent("#plano")).includes("Habeas-corpus"), "some da lista");
  assert(await page.isVisible("#mergeUndoBar"), "barra de desfazer visível");
  assert((await page.textContent("#mergeUndoBar")).includes("«Habeas-corpus» em «Habeas corpus»"));

  // ---- desfazer preserva o que foi feito depois
  await page.evaluate((d) => { state.studyLogs.push({ id: "L9", subjectId: "s1", topicId: "t2", competitionId: "", minutes: 45, date: d, source: "Manual", note: "", createdAt: new Date().toISOString() }); saveState(); render(); }, today);
  await page.click('[data-cycle-action="mergeUndo"]');
  await page.waitForTimeout(300);
  const undone = await page.evaluate(() => ({ topics: state.topics.map((t) => t.id).sort(), l1: state.studyLogs.find((l) => l.id === "L1").topicId, l9: state.studyLogs.find((l) => l.id === "L9").topicId, rev: state.meta.revivals.topics }));
  assert.deepStrictEqual(undone.topics, ["t1", "t2", "t3", "t4"]);
  assert.strictEqual(undone.l1, "t1");
  assert.strictEqual(undone.l9, "t2", "o registro de depois continua no destino");
  assert(undone.rev && undone.rev.t1, "o assunto restaurado foi marcado como revivido (outros aparelhos não o apagam)");
  assert(!(await page.isVisible("#mergeUndoBar")));
  assert((await page.textContent("#plano")).includes("Habeas-corpus"), "voltou para a lista");

  // ---- matéria: une assuntos de mesmo nome
  await page.click('[data-cycle-action="mergeSubject"][data-id="s1"]');
  await page.waitForTimeout(250);
  assert(await modalOpen());
  assert((await page.textContent("#mergeModalTitle")).includes("«Direito Penal»"));
  assert((await page.textContent("#mergeSummary")).includes("passa para a matéria escolhida"), "concordância no texto da matéria");
  const options = await page.evaluate(() => [...document.querySelectorAll("#mergeTarget option")].map((o) => o.textContent));
  assert.deepStrictEqual(options, ["Escolha a matéria de destino", "Língua Portuguesa"], "só as outras matérias aparecem: " + JSON.stringify(options));
  await page.selectOption("#mergeTarget", "s2");
  const subjectPreview = await page.textContent("#mergePreview");
  assert(subjectPreview.includes("1 assunto com o mesmo nome será unido"), "prévia da matéria: " + subjectPreview);
  assert(subjectPreview.includes("passam a pertencer a «Língua Portuguesa»"));
  await page.click("#mergeConfirmBtn");
  await page.waitForTimeout(350);
  const merged = await page.evaluate(() => ({ subjects: state.subjects.map((s) => s.id), topics: state.topics.map((t) => `${t.id}:${t.subjectId}`).sort(), l3: state.studyLogs.find((l) => l.id === "L3") }));
  console.log("matéria mesclada:", JSON.stringify(merged));
  assert.deepStrictEqual(merged.subjects, ["s2"]);
  assert.deepStrictEqual(merged.topics, ["t1:s2", "t2:s2", "t3:s2"]);
  assert.strictEqual(merged.l3.subjectId, "s2");
  assert.strictEqual(merged.l3.topicId, "t3", "a Crase de Penal foi unida à Crase de Português");
  await page.click('[data-cycle-action="mergeUndo"]');
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await page.evaluate(() => state.subjects.map((s) => s.id).sort()), ["s1", "s2"]);
  assert.strictEqual(await page.evaluate(() => state.studyLogs.find((l) => l.id === "L3").topicId), "t4");

  // ---- cancelar pelo botão; sem outra opção, avisa
  await page.click('[data-cycle-action="mergeSubject"][data-id="s2"]');
  await page.waitForTimeout(200);
  await page.click('[data-cycle-action="mergeCancel"]');
  await page.waitForTimeout(200);
  assert(!(await modalOpen()));
  await page.evaluate(() => { state.subjects = state.subjects.filter((s) => s.id === "s1"); state.topics = state.topics.filter((t) => t.subjectId === "s1" && t.id === "t2"); render(); });
  await page.waitForTimeout(200);
  await page.click('[data-cycle-action="mergeTopic"][data-id="t2"]');
  await page.waitForTimeout(200);
  assert(!(await modalOpen()), "sem outro assunto, não abre a janela");
  assert((await page.textContent(".toast")).includes("Não há outro assunto"));

  // ---- a mesclagem persiste ao recarregar
  await page.evaluate(() => { state.subjects = [{ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }]; state.topics = [{ id: "t1", subjectId: "s1", name: "A" }, { id: "t2", subjectId: "s1", name: "A " }]; saveState(); render(); });
  await page.evaluate(() => mesclarTopicInto(state, "t1", "t2") && saveState());
  await page.reload();
  await page.fill("#profileName", "mesclar");
  await page.fill("#profilePin", "1234");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(600);
  assert.deepStrictEqual(await page.evaluate(() => state.topics.map((t) => t.id)), ["t2"], "depois de recarregar, a mesclagem continua");
  assert(await page.evaluate(() => Boolean(state.meta.tombstones.topics && state.meta.tombstones.topics.t1)), "a lápide também foi guardada");

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E MESCLAR OK");
})().catch((e) => { console.error("E2E MESCLAR FALHOU:", e.message); process.exit(1); });
