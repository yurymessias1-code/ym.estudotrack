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

  await page.fill("#profileName", "sessao");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);

  const modalOpen = () => page.evaluate(() => !document.querySelector("#sessionModal").classList.contains("hidden"));
  const finishFocus = (minutes, cycle = 1) =>
    page.evaluate(([m, c]) => {
      timer.mode = "focus";
      timer.cycle = c;
      timer.elapsedFocusSeconds = m * 60;
      finishTimerManually();
    }, [minutes, cycle]);
  const today = () => page.evaluate(() => new Date().toLocaleDateString("sv"));

  // ---- só uma matéria cadastrada, nenhum assunto
  await page.evaluate(() => { state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }); saveState(); render(); });
  await page.click('.nav-button[data-view="pomodoro"]');
  await page.waitForTimeout(300);
  assert((await page.textContent("#pomodoro")).includes("ao terminar o foco você diz o que estudou"), "o Pomodoro explica que dá para escolher depois");
  assert(await page.isChecked("#askAtSave"), "perguntar ao terminar vem ligado");

  // ---- A) terminar o foco abre a janela, com a matéria do início já escolhida; cria assunto na hora
  await finishFocus(25, 2);
  await page.waitForTimeout(300);
  assert(await modalOpen(), "a janela deve abrir ao terminar o foco");
  assert.strictEqual(await page.evaluate(() => state.studyLogs.length), 0, "nada é gravado antes de escolher");
  assert((await page.textContent("#sessionSummary")).includes("25 min de foco (ciclo 2)"));
  assert.strictEqual(await page.inputValue("#ssSubject"), "s1", "matéria escolhida no início vem preenchida");
  assert.strictEqual(await page.inputValue("#ssMinutes"), "25");
  assert(!(await page.isVisible("#ssNewTopicLabel")));
  await page.selectOption("#ssTopic", "__new__");
  assert(await page.isVisible("#ssNewTopicLabel"), "campo do assunto novo aparece");
  await page.fill("#ssNewTopic", "Habeas corpus");
  await page.screenshot({ path: "janela-sessao.png" });
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(350);
  assert(!(await modalOpen()), "janela fecha ao salvar");
  const a = await page.evaluate(() => ({ topics: state.topics.map((t) => ({ id: t.id, name: t.name, subjectId: t.subjectId, priority: t.priority })), logs: state.studyLogs.map((l) => ({ minutes: l.minutes, topicId: l.topicId, subjectId: l.subjectId, note: l.note, source: l.source })), pending: sessionPendingRead().length }));
  console.log("A) assunto criado na hora:", JSON.stringify(a.topics), "| log:", JSON.stringify(a.logs));
  assert.strictEqual(a.topics.length, 1);
  assert.strictEqual(a.topics[0].name, "Habeas corpus");
  assert.strictEqual(a.topics[0].subjectId, "s1");
  assert.strictEqual(a.topics[0].priority, "Média");
  assert.strictEqual(a.logs.length, 1);
  assert.strictEqual(a.logs[0].minutes, 25);
  assert.strictEqual(a.logs[0].topicId, a.topics[0].id);
  assert.strictEqual(a.logs[0].note, "Ciclo 2");
  assert.strictEqual(a.logs[0].source, "Pomodoro");
  assert.strictEqual(a.pending, 0);
  const topicA = a.topics[0].id;
  const chain = await page.evaluate(([id, d]) => state.revisions.some((r) => r.kind === "study" && r.originKey === `study:${id}:${d}`), [topicA, await today()]);
  assert(chain, "estudo de 25 min no assunto novo inicia a trilha de revisão");

  // ---- B) mesmo nome (maiúsculas, acento e espaços) reaproveita o assunto
  await finishFocus(30);
  await page.waitForTimeout(250);
  await page.selectOption("#ssTopic", "__new__");
  await page.fill("#ssNewTopic", "  HABEAS    Corpus ");
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => ({ topics: state.topics.length, ids: state.studyLogs.map((l) => l.topicId) }));
  assert.strictEqual(b.topics, 1, "não cria assunto duplicado");
  assert.strictEqual(b.ids[1], topicA);

  // ---- C) matéria nova e assunto novo na mesma janela
  await finishFocus(40);
  await page.waitForTimeout(250);
  await page.selectOption("#ssSubject", "__new__");
  assert(await page.isVisible("#ssNewSubjectLabel"));
  assert.strictEqual(await page.inputValue("#ssTopic"), "", "ao trocar a matéria o assunto volta ao padrão");
  await page.fill("#ssNewSubject", "Língua Portuguesa");
  await page.selectOption("#ssTopic", "__new__");
  await page.fill("#ssNewTopic", "Crase");
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => {
    const subject = state.subjects.find((s) => s.name === "Língua Portuguesa");
    const topic = state.topics.find((t) => t.name === "Crase");
    const log = state.studyLogs[state.studyLogs.length - 1];
    return { subject: Boolean(subject), color: subject && subject.color, goal: subject && subject.goalHours, topicOk: topic && topic.subjectId === subject.id, logOk: log.subjectId === subject.id && log.topicId === topic.id && log.minutes === 40 };
  });
  console.log("C) matéria + assunto criados:", JSON.stringify(c));
  assert(c.subject && c.topicOk && c.logOk);
  assert(/^#[0-9a-f]{6}$/i.test(c.color) && c.goal > 0);

  // ---- D) validações: mensagens aparecem acima da janela e nada é gravado
  const logsBeforeD = await page.evaluate(() => state.studyLogs.length);
  await finishFocus(20);
  await page.waitForTimeout(250);
  await page.selectOption("#ssTopic", "__new__");
  await page.fill("#ssNewTopic", "   ");
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(200);
  assert(await modalOpen(), "janela continua aberta com erro");
  const toastOnTop = await page.evaluate(() => {
    const toast = document.querySelector(".toast");
    const style = getComputedStyle(toast);
    const modalStyle = getComputedStyle(document.querySelector("#sessionModal"));
    const rect = toast.getBoundingClientRect();
    return { text: toast.textContent, z: Number(style.zIndex), modalZ: Number(modalStyle.zIndex), opacity: Number(style.opacity), position: style.position, inViewport: rect.bottom <= innerHeight && rect.right <= innerWidth && rect.width > 0 };
  });
  assert(toastOnTop.text.includes("Escreva o nome do novo assunto"), toastOnTop.text);
  assert(toastOnTop.position === "fixed" && toastOnTop.z > toastOnTop.modalZ, `o aviso precisa ficar acima da janela (toast z=${toastOnTop.z}, janela z=${toastOnTop.modalZ})`);
  assert(toastOnTop.opacity > 0.5 && toastOnTop.inViewport, "o aviso precisa estar visível na tela");
  await page.selectOption("#ssSubject", "");
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(150);
  assert((await page.textContent(".toast")).includes("Escolha a matéria"));
  assert.strictEqual(await page.evaluate(() => state.studyLogs.length), logsBeforeD, "nada gravado com erro");

  // ---- E) decidir depois: fica pendente, persiste ao recarregar e abre sozinho
  await page.click('[data-cycle-action="sessionLater"]');
  await page.waitForTimeout(200);
  assert(!(await modalOpen()));
  assert(await page.isVisible("#sessionBar"), "barra lembra a sessão pendente");
  assert((await page.textContent("#sessionBar")).includes("1 foco concluído"));
  await page.screenshot({ path: "sessao-pendente.png" });
  await page.reload();
  await page.fill("#profileName", "sessao");
  await page.fill("#profilePin", "1234");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(800);
  assert(await modalOpen(), "sessão pendente reabre depois de recarregar");
  assert.strictEqual(await page.inputValue("#ssMinutes"), "20");
  // ---- F) descartar
  await page.click('[data-cycle-action="sessionDiscard"]');
  await page.waitForTimeout(250);
  assert(!(await modalOpen()));
  assert(!(await page.isVisible("#sessionBar")), "sem pendências, sem barra");
  assert.strictEqual(await page.evaluate(() => sessionPendingRead().length), 0);
  assert.strictEqual(await page.evaluate(() => state.studyLogs.length), logsBeforeD, "descartar não grava");

  // ---- G) duas sessões na fila: a escolha da primeira vem preenchida na segunda
  await page.evaluate(() => {
    sessionAskBeforeSave({ id: "q1", minutes: 25, date: new Date().toLocaleDateString("sv"), cycle: 1, subjectId: "", topicId: "", competitionId: "", source: "Pomodoro", note: "Ciclo 1" });
    sessionAskBeforeSave({ id: "q2", minutes: 25, date: new Date().toLocaleDateString("sv"), cycle: 2, subjectId: "", topicId: "", competitionId: "", source: "Pomodoro", note: "Ciclo 2" });
  });
  await page.waitForTimeout(250);
  assert((await page.textContent("#sessionModalEyebrow")).includes("Sessão 1 de 2"));
  await page.selectOption("#ssSubject", "s1");
  await page.selectOption("#ssTopic", topicA);
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(300);
  assert(await modalOpen(), "a segunda sessão segue na fila");
  assert.strictEqual(await page.inputValue("#ssSubject"), "s1", "preenchida com a escolha anterior");
  assert.strictEqual(await page.inputValue("#ssTopic"), topicA);
  assert((await page.textContent(".toast")).includes("Faltam 1 sessão"));
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(300);
  assert(!(await modalOpen()));

  // ---- H) sem perguntar: com matéria escolhida salva direto; sem matéria ainda pergunta
  await page.click('.nav-button[data-view="pomodoro"]');
  await page.uncheck("#askAtSave");
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.cycleSettings.askAtSave), false);
  const logsBeforeH = await page.evaluate(() => state.studyLogs.length);
  await finishFocus(15);
  await page.waitForTimeout(250);
  assert(!(await modalOpen()), "opção desligada e matéria escolhida: salva direto");
  const h = await page.evaluate(() => state.studyLogs[state.studyLogs.length - 1]);
  assert.strictEqual(await page.evaluate(() => state.studyLogs.length), logsBeforeH + 1);
  assert.strictEqual(h.minutes, 15);
  assert.strictEqual(h.source, "Pomodoro");
  await page.check("#askAtSave");
  await page.waitForTimeout(150);
  assert.strictEqual(await page.evaluate(() => state.cycleSettings.askAtSave), true);

  // ---- I) iniciar o Pomodoro sem nenhuma matéria cadastrada
  await page.evaluate(() => { state.subjects = []; state.topics = []; state.studyLogs = []; state.revisions = []; saveState(); render(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => startTimer());
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => timer.running), true, "inicia mesmo sem matéria");
  assert((await page.textContent(".toast")).includes("ao terminar o foco você diz o que estudou"));
  await page.evaluate(() => { timer.elapsedFocusSeconds = 25 * 60; finishTimerManually(); });
  await page.waitForTimeout(300);
  assert(await modalOpen());
  assert.strictEqual(await page.inputValue("#ssSubject"), "__new__", "sem matérias, já oferece criar");
  assert(await page.isVisible("#ssNewSubjectLabel"));
  await page.fill("#ssNewSubject", "Raciocínio Lógico");
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForTimeout(300);
  const i = await page.evaluate(() => ({ subjects: state.subjects.map((s) => s.name), log: state.studyLogs[0] }));
  assert.strictEqual(i.subjects[0], "Raciocínio Lógico");
  assert.strictEqual(i.log.topicId, "");
  assert.strictEqual(i.log.minutes, 25);
  assert.strictEqual(await page.evaluate(() => timer.running), false);

  // ---- J) registro manual (aba Pomodoro): assunto novo digitado
  await page.click('.nav-button[data-view="pomodoro"]');
  await page.waitForTimeout(250);
  await page.fill("#studyNewTopic", "Equivalências lógicas");
  await page.fill("#studyMinutes", "30");
  await page.click("#studySubmitBtn");
  await page.waitForTimeout(300);
  const j = await page.evaluate(() => ({ topics: state.topics.map((t) => t.name), last: state.studyLogs[state.studyLogs.length - 1], typed: document.querySelector("#studyNewTopic").value }));
  assert.deepStrictEqual(j.topics, ["Equivalências lógicas"]);
  assert.strictEqual(j.last.minutes, 30);
  assert.strictEqual(j.last.source, "Manual");
  assert.strictEqual(j.typed, "", "campo é limpo depois de salvar");
  assert.strictEqual(await page.evaluate(() => state.topics[0].id === state.studyLogs[state.studyLogs.length - 1].topicId), true);

  // ---- K) registro rápido (Hoje): assunto novo digitado, reaproveitando o mesmo nome
  await page.click('.nav-button[data-view="hoje"]');
  await page.click("#quickStudyBtn");
  await page.waitForTimeout(250);
  await page.fill("#qsNewTopic", "equivalencias LOGICAS");
  await page.fill("#qsMinutes", "20");
  await page.click('#quickStudyForm button[type="submit"]');
  await page.waitForTimeout(300);
  const k = await page.evaluate(() => ({ topics: state.topics.length, same: state.studyLogs[state.studyLogs.length - 1].topicId === state.topics[0].id, note: state.studyLogs[state.studyLogs.length - 1].note }));
  assert.strictEqual(k.topics, 1, "reaproveita o assunto de mesmo nome");
  assert(k.same);
  assert.strictEqual(k.note, "Registro rápido (Hoje)");

  // ---- L) celular: a janela cabe na tela
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => sessionAskBeforeSave({ id: "m1", minutes: 25, date: new Date().toLocaleDateString("sv"), cycle: 1, subjectId: "", topicId: "", competitionId: "", source: "Pomodoro", note: "Ciclo 1" }));
  await page.waitForTimeout(400);
  assert(await modalOpen());
  const geometry = await page.evaluate(() => {
    const card = document.querySelector("#sessionForm").getBoundingClientRect();
    return { left: Math.round(card.left), right: Math.round(card.right), bottom: Math.round(card.bottom), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, bodyLocked: document.body.classList.contains("modal-open") };
  });
  console.log("celular:", JSON.stringify(geometry));
  assert(geometry.left >= 0 && geometry.right <= 390, "janela dentro da largura da tela");
  assert(geometry.bottom <= 844, "janela dentro da altura da tela");
  assert.strictEqual(geometry.overflow, 0);
  assert(geometry.bodyLocked, "rolagem do fundo travada com a janela aberta");
  await page.screenshot({ path: "janela-sessao-celular.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  assert(!(await modalOpen()), "Esc equivale a decidir depois");
  assert(!(await page.evaluate(() => document.body.classList.contains("modal-open"))), "rolagem liberada");
  assert.strictEqual(await page.evaluate(() => sessionPendingRead().length), 1, "Esc não descarta");

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E SESSAO OK");
})().catch((e) => { console.error("E2E SESSAO FALHOU:", e.message); process.exit(1); });
