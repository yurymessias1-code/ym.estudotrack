// Proteção dos dados: restauração de backup (validação, confirmação, cópia de segurança antes),
// sessões pendentes dentro do estado e refação de erros com 4 notas.
const { launchBrowser } = require("./helpers");
const assert = require("assert");
const BASE = process.env.BASE_URL;

const auxRecords = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("estudosTrackAuxiliaryBackups", 1);
        request.onsuccess = () => {
          const all = request.result.transaction("snapshots").objectStore("snapshots").getAll();
          all.onsuccess = () => resolve(all.result.map((record) => ({ kind: record.kind || "auto", total: record.total })));
        };
        request.onerror = () => resolve([]);
      })
  );

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const dialogs = [];
  let answer = true;
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => { dialogs.push(d.message()); return answer ? d.accept() : d.dismiss(); });
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(BASE);
  await page.fill("#profileName", "protecao");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);

  // dados de partida
  await page.evaluate(() => {
    state.subjects.push({ id: "s1", name: "Penal", color: "#0f766e", goalHours: 5 });
    state.topics.push({ id: "t1", subjectId: "s1", name: "HC", priority: "Média" });
    state.errorNotebook.push(normalizeErrorEntry({ id: "e1", subjectId: "s1", topicId: "t1", statement: "Questão de teste", correctAnswer: "C", rule: "", stage: 1, dueDate: new Date().toLocaleDateString("sv") }));
    saveState();
    render();
  });

  // 1) JSON que não é backup é recusado sem mexer em nada
  const before = await page.evaluate(() => JSON.stringify([state.subjects.length, state.errorNotebook.length]));
  await page.evaluate(() => restoreBackupFromText('{"foo": 1}'));
  await page.evaluate(() => restoreBackupFromText("isto não é json"));
  await page.evaluate(() => restoreBackupFromText("[1,2,3]"));
  assert.strictEqual(await page.evaluate(() => JSON.stringify([state.subjects.length, state.errorNotebook.length])), before, "recusar não pode apagar nada");
  assert.strictEqual(dialogs.length, 0, "backup inválido nem chega a perguntar");

  // 2) cancelar a confirmação não muda nada e mostra o conteúdo do backup
  const backup = { app: "estudos-track", version: 2, exportedAt: "2026-11-01T10:00:00.000Z", data: { subjects: [{ id: "x1", name: "Outra" }, { id: "x2", name: "Mais uma" }], topics: [], studyLogs: [{ id: "l1", subjectId: "x1", minutes: 30, date: "2026-11-01" }] } };
  answer = false;
  await page.evaluate((text) => restoreBackupFromText(text), JSON.stringify(backup));
  assert.strictEqual(await page.evaluate(() => state.subjects.length), 1, "cancelou: continua com os dados atuais");
  assert.ok(/materias: 2/.test(dialogs[0]) && /estudos: 1/.test(dialogs[0]), "a confirmação mostra o que vai entrar: " + dialogs[0]);
  assert.ok(/cofre automatico/.test(dialogs[0]));
  assert.strictEqual((await auxRecords(page)).filter((r) => r.kind === "antes-de-restaurar").length, 0, "cancelou: nenhuma cópia criada");

  // 3) confirmar guarda a cópia dos dados atuais e só então troca
  answer = true;
  await page.evaluate((text) => restoreBackupFromText(text), JSON.stringify(backup));
  assert.strictEqual(await page.evaluate(() => state.subjects.map((s) => s.name).join(",")), "Outra,Mais uma");
  const records = await auxRecords(page);
  assert.strictEqual(records.filter((r) => r.kind === "antes-de-restaurar").length, 1, "cópia de segurança antes de restaurar");
  const safety = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("estudosTrackAuxiliaryBackups", 1);
        request.onsuccess = () => {
          const all = request.result.transaction("snapshots").objectStore("snapshots").getAll();
          all.onsuccess = () => {
            const record = all.result.find((item) => item.kind === "antes-de-restaurar");
            resolve({ subjects: record.state.subjects.map((s) => s.name), errors: record.state.errorNotebook.length });
          };
        };
      })
  );
  assert.strictEqual(JSON.stringify(safety), JSON.stringify({ subjects: ["Penal"], errors: 1 }), "a cópia guarda o estado de antes");
  // e dá para voltar: a cópia aparece na lista de recuperação
  const candidates = await page.evaluate(async () => (await getIndexedRecoveryCandidates()).map((c) => c.sourceLabel));
  assert.ok(candidates.some((label) => /antes de restaurar/.test(label)), "aparece na recuperação: " + candidates.join("|"));

  // 4) o localStorage não guarda mais cópias auxiliares (só o IndexedDB)
  const localAux = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ymEstudos.auxBackup.")));
  assert.strictEqual(localAux.length, 0, "sem cópias auxiliares no localStorage: " + localAux.join(","));

  // 5) migração: cópia antiga do localStorage vai para o IndexedDB e o espaço é liberado
  await page.evaluate(async () => {
    const old = JSON.parse(JSON.stringify(state));
    old.subjects = [{ id: "velha", name: "Cópia antiga" }];
    const profileId = state.profile.id;
    const key = `ymEstudos.auxBackup.${profileId}.1700000000000.v1`;
    localStorage.setItem(key, JSON.stringify(old));
    localStorage.setItem("ymEstudos.auxBackup.index.v1", JSON.stringify({ version: 1, items: [{ key, profileId, label: "x", updatedAt: "2023-11-14T22:13:20.000Z", createdMs: 1700000000000, total: 1 }] }));
    await migrateAuxiliaryBackupsToIndexedDB();
  });
  assert.strictEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ymEstudos.auxBackup.")).length), 0, "cópias antigas saíram do localStorage");
  assert.ok((await page.evaluate(async () => (await getIndexedRecoveryCandidates()).some((c) => c.state.subjects.some((s) => s.name === "Cópia antiga")))), "e estão no IndexedDB");

  // 6) sessão pendente fica no estado (e portanto vai para a conta e para o backup)
  await page.evaluate(() => sessionAskBeforeSave({ id: "sess1", minutes: 25, date: new Date().toLocaleDateString("sv"), cycle: 1, subjectId: "", topicId: "", source: "Pomodoro", note: "" }));
  assert.strictEqual(await page.evaluate(() => state.pendingSessions.length), 1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(profileStorageKey(state.profile.id))).pendingSessions.length);
  assert.strictEqual(stored, 1, "gravada junto com o estado");
  assert.strictEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ymEstudos.pendingSessions.")).length), 0, "nada da fila só no aparelho");
  const exported = await page.evaluate(() => JSON.parse(createBackupPayload()).data.pendingSessions.length);
  assert.strictEqual(exported, 1, "entra no backup em arquivo");
  await page.evaluate(() => sessionPendingWrite([]));
  assert.strictEqual(await page.evaluate(() => sessionPendingRead().length), 0);
  await page.evaluate(() => { cycleUI.sessionModalOpen = false; renderSessionUI(); });

  // 7) caderno de erros: quatro notas e reincidente
  await page.evaluate(() => {
    // a restauração do passo 3 trocou as matérias: recria a que os próximos passos usam
    state.subjects = [{ id: "s1", name: "Penal", color: "#0f766e", goalHours: 5 }];
    state.topics = [{ id: "t1", subjectId: "s1", name: "HC", priority: "Média" }];
    state.errorNotebook = [normalizeErrorEntry({ id: "e9", subjectId: "s1", statement: "Questão difícil", correctAnswer: "C", stage: 1, lapses: 2, dueDate: new Date().toLocaleDateString("sv") })];
    saveState();
    setView("erros");
  });
  await page.waitForTimeout(200);
  await page.click('[data-cycle-action="retestError"][data-id="e9"]');
  await page.click('[data-cycle-action="showErrorAnswer"][data-id="e9"]');
  const results = await page.$$eval('[data-cycle-action="errorResult"]', (buttons) => buttons.map((b) => b.dataset.result));
  assert.strictEqual(JSON.stringify(results), JSON.stringify(["forgot", "hard", "ok", "easy"]));
  await page.click('[data-cycle-action="errorResult"][data-result="forgot"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.errorNotebook[0].lapses), 3);
  assert.ok(await page.isVisible(".leech-tag"), "selo de reincidente aparece");
  assert.ok(await page.isVisible('[data-cycle-action="errorReinforce"][data-id="e9"]'));
  await page.click('[data-cycle-action="errorReinforce"][data-id="e9"]');
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "weak" && r.status === "pending").length), 1, "reforço criado");
  await page.click('[data-cycle-action="errorReinforce"][data-id="e9"]');
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "weak").length), 1, "segundo clique não duplica");
  await page.click('[data-cycle-action="retestError"][data-id="e9"]');
  await page.click('[data-cycle-action="showErrorAnswer"][data-id="e9"]');
  await page.click('[data-cycle-action="errorResult"][data-result="hard"]');
  const after = await page.evaluate(() => ({ lapses: state.errorNotebook[0].lapses, last: state.errorNotebook[0].lastResult }));
  assert.strictEqual(JSON.stringify(after), JSON.stringify({ lapses: 3, last: "hard" }), "acertar com dúvida não conta como erro");

  // 8) uma cadeia por assunto na tela de revisão
  await page.evaluate(() => {
    state.revisions = [];
    const today = new Date().toLocaleDateString("sv");
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("sv"); };
    state.studyLogs = [3, 2, 1].map((n) => ({ id: `lg${n}`, subjectId: "s1", topicId: "t1", minutes: 30, date: day(n), createdAt: new Date().toISOString() }));
    state.cycleSettings.autoSince = day(10);
    state.cycleSettings.autoFromStudy = true;
    syncAutoRevisions();
    // simula o legado: duas cadeias repetidas do mesmo assunto
    state.revisions.push(normalizeRevision({ id: "dup1", kind: "study", subjectId: "s1", topicId: "t1", originKey: `study:t1:${day(2)}`, baseDate: day(2) }));
    state.revisions.push(normalizeRevision({ id: "dup2", kind: "study", subjectId: "s1", topicId: "t1", originKey: `study:t1:${day(1)}`, baseDate: day(1) }));
    saveState();
    setView("revisao");
  });
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "study").length), 3, "1 nova + 2 repetidas do legado");
  assert.ok(await page.isVisible('[data-cycle-action="consolidateRevisions"]'), "botão para unificar aparece");
  await page.click('[data-cycle-action="consolidateRevisions"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.revisions.filter((r) => r.kind === "study").length), 1, "ficou uma cadeia por assunto");
  assert.ok(!(await page.isVisible('[data-cycle-action="consolidateRevisions"]')), "botão some depois");
  assert.strictEqual(await page.evaluate(() => { syncAutoRevisions(); return state.revisions.filter((r) => r.kind === "study").length; }), 1, "e não volta a criar repetidas");

  // 9) erro repetido: pergunta e soma na contagem em vez de duplicar
  await page.evaluate(() => { state.errorNotebook = []; saveState(); setView("erros"); errorFormSet(true); });
  const submitError = async (statement) => {
    await page.evaluate((text) => {
      document.querySelector("#errorSubject").value = "s1";
      document.querySelector("#errorStatement").value = text;
      document.querySelector("#errorForm").requestSubmit();
    }, statement);
    await page.waitForTimeout(400);
  };
  await submitError("A súmula 568 do STJ permite decisão monocrática do relator.");
  assert.strictEqual(await page.evaluate(() => state.errorNotebook.length), 1);
  const dialogsBefore = dialogs.length;
  answer = true;
  await submitError("a SUMULA 568 do stj permite decisao monocratica do relator");
  assert.strictEqual(await page.evaluate(() => state.errorNotebook.length), 1, "mesmo enunciado: não duplica");
  assert.strictEqual(await page.evaluate(() => state.errorNotebook[0].lapses), 1, "e soma um erro");
  assert.ok(/já estar no caderno/.test(dialogs[dialogsBefore] || ""), "pergunta antes: " + dialogs[dialogsBefore]);
  answer = false;
  await submitError("A súmula 568 do STJ permite decisão monocrática do relator!");
  assert.strictEqual(await page.evaluate(() => state.errorNotebook.length), 2, "recusando a soma, salva como registro novo");
  answer = true;

  // 10) data da prova: a opção encurta o intervalo e pode ser desligada na tela
  await page.evaluate(() => {
    const day = new Date();
    day.setDate(day.getDate() + 20);
    state.competitions = [{ id: "cp1", name: "Prova teste", date: day.toLocaleDateString("sv"), subjectIds: ["s1"] }];
    saveState();
    renderCycle();
  });
  assert.strictEqual(await page.evaluate(() => cycleScheduledStep(2, "ok", [1, 7, 30, 60], "s1").gap), 10, "faltam 20 dias: o intervalo de 60 vira 10");
  assert.strictEqual(await page.evaluate(() => document.querySelector("#cycleExamAdapt").checked), true, "opção ligada por padrão");
  await page.evaluate(() => {
    document.querySelector("#cycleExamAdapt").checked = false;
    document.querySelector("#cycleSettingsForm").requestSubmit();
  });
  assert.strictEqual(await page.evaluate(() => state.cycleSettings.examAdapt), false);
  assert.strictEqual(await page.evaluate(() => cycleScheduledStep(2, "ok", [1, 7, 30, 60], "s1").gap), 60, "desligada: o intervalo volta ao normal");

  // 11) carga do dia: erros atrasados entram na redistribuição e no limite por dia
  await page.evaluate(() => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv"); };
    state.cycleSettings.dailyLimit = 2;
    state.revisions = [];
    state.errorNotebook = [1, 2, 3].map((i) => normalizeErrorEntry({ id: `od${i}`, subjectId: "s1", statement: `Enunciado atrasado número ${i} com texto suficiente`, dueDate: day(-i) }));
    saveState();
    setView("erros");
  });
  await page.waitForTimeout(250);
  assert.ok(await page.isVisible("#errorRedistribute button"), "botão de redistribuir aparece na tela de erros");
  assert.ok(/3 erros atrasados/.test(await page.textContent("#errorRedistribute")));
  await page.click("#errorRedistribute button");
  await page.waitForTimeout(250);
  const spread = await page.evaluate(() => {
    const today = cycleToday();
    const perDay = {};
    state.errorNotebook.forEach((entry) => (perDay[entry.dueDate] = (perDay[entry.dueDate] || 0) + 1));
    return { overdue: state.errorNotebook.filter((entry) => entry.dueDate < today).length, max: Math.max(...Object.values(perDay)), oldestFirst: state.errorNotebook.find((entry) => entry.id === "od3").dueDate === today };
  });
  assert.strictEqual(spread.overdue, 0, "nenhum erro continua atrasado");
  assert.ok(spread.max <= 2, "no máximo 2 por dia (o limite)");
  assert.ok(spread.oldestFirst, "o mais antigo vem primeiro");
  assert.ok(!(await page.isVisible("#errorRedistribute button")), "botão some depois");
  assert.strictEqual(await page.evaluate(() => document.querySelector("#cycleLevelLoad").checked), true, "nivelar a carga: ligado por padrão");
  await page.evaluate(() => {
    document.querySelector("#cycleLevelLoad").checked = false;
    document.querySelector("#cycleSettingsForm").requestSubmit();
  });
  assert.strictEqual(await page.evaluate(() => state.cycleSettings.levelLoad), false, "a opção é salva");

  assert.strictEqual(errors.length, 0, "erros de JS: " + errors.join(" | "));
  console.log("ERROS JS: nenhum");
  console.log("E2E PROTECAO OK");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
