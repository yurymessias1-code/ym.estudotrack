// Dois "aparelhos" (dois navegadores) na mesma conta, contra um Supabase falso em memória.
const { launchBrowser } = require("./helpers");
const { createFakeSupabase } = require("./fake-supabase");
const assert = require("assert");
const BASE = process.env.BASE_URL;
const EMAIL = "estudos@example.com";
const PASSWORD = "Senha#Forte2026";

async function newDevice(browser, fake, name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const device = { name, context, page, errors: [] };
  page.on("pageerror", (e) => device.errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_|503/.test(m.text())) device.errors.push(`${name} console: ${m.text()}`);
  });
  page.on("dialog", (d) => d.accept());
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await fake.install(context);
  await page.goto(BASE);
  await page.evaluate(() => {
    window.__toasts = [];
    const original = showToast;
    showToast = (message) => {
      window.__toasts.push(String(message));
      return original(message);
    };
  });
  return device;
}

let settleStep = 0;
const settled = async (d) => {
  settleStep += 1;
  try {
    await d.page.waitForFunction(() => remoteStore.user && remoteStore.baseUpdatedAt && remoteStore.syncStatus === "saved" && !remoteStore.saveTimer && !remoteStore.syncing && !remoteStore.pendingSave, null, { timeout: 12000 });
  } catch (error) {
    const info = await d.page.evaluate(() => ({ user: Boolean(remoteStore.user), base: remoteStore.baseUpdatedAt, status: remoteStore.syncStatus, timer: Boolean(remoteStore.saveTimer), syncing: remoteStore.syncing, pending: remoteStore.pendingSave, toasts: window.__toasts.slice(-3) }));
    throw new Error(`settled #${settleStep} (${d.name}) não estabilizou: ${JSON.stringify(info)}`);
  }
};
const logIds = (d) => d.page.evaluate(() => state.studyLogs.map((l) => l.id).sort());
const serverIds = (fake, collection = "studyLogs") => ((fake.savedState(EMAIL) || {})[collection] || []).map((l) => l.id).sort();
const toasts = (d) => d.page.evaluate(() => window.__toasts);
const fingerprint = (d) => d.page.evaluate(() => stateFingerprint(state));
const addLog = (d, id, minutes = 30) =>
  d.page.evaluate(([logId, min]) => {
    state.studyLogs.push({ id: logId, subjectId: "s1", topicId: "", competitionId: "", minutes: min, date: new Date().toLocaleDateString("sv"), source: "Manual", note: "", createdAt: new Date().toISOString() });
    saveState();
  }, [id, minutes]);
const equal = (a, b, message) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

(async () => {
  const browser = await launchBrowser();
  const fake = createFakeSupabase();
  const A = await newDevice(browser, fake, "A");
  const B = await newDevice(browser, fake, "B");

  // ---- A cria a conta e registra o primeiro estudo
  await A.page.fill("#profileName", EMAIL);
  await A.page.fill("#profilePin", PASSWORD);
  await A.page.click("#profileSignupBtn");
  await settled(A);
  await A.page.evaluate(() => { state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }); });
  await addLog(A, "L1");
  await settled(A);
  assert.deepStrictEqual(serverIds(fake), ["L1"], "o servidor recebeu o primeiro registro");
  assert(A.page && fake.stats.upserts === 1, "a primeira gravação é uma inserção");
  console.log("A) conta criada e L1 salvo; base do servidor:", await A.page.evaluate(() => remoteStore.baseUpdatedAt));

  // ---- B entra na mesma conta e vê o que A salvou
  await B.page.fill("#profileName", EMAIL);
  await B.page.fill("#profilePin", PASSWORD);
  await B.page.click("#profileAccessBtn");
  await settled(B);
  equal(await logIds(B), ["L1"], "B carregou os dados de A");

  // ---- mudanças ao mesmo tempo: sem a verificação, B apagaria o L2 de A
  await addLog(A, "L2");
  await settled(A);
  equal(serverIds(fake), ["L1", "L2"], "servidor com L1 e L2");
  const conflictsBefore = fake.stats.conflicts;
  await addLog(B, "L3"); // B ainda não viu o L2
  await settled(B);
  equal(await logIds(B), ["L1", "L2", "L3"], "B juntou o que A fez com o que ele fez");
  equal(serverIds(fake), ["L1", "L2", "L3"], "servidor ficou com os três: nada foi sobrescrito");
  assert(fake.stats.conflicts > conflictsBefore, "o conflito foi detectado pela verificação");
  assert((await toasts(B)).some((t) => t.includes("Combinei suas mudanças")), "B é avisado de que juntou as mudanças: " + JSON.stringify(await toasts(B)));
  console.log("conflito resolvido: servidor =", JSON.stringify(serverIds(fake)), "| conflitos detectados:", fake.stats.conflicts);

  // ---- A volta para a aba (evento real) e recebe o que B fez
  await A.page.evaluate(() => { remoteStore.lastRefreshAt = 0; document.dispatchEvent(new Event("visibilitychange")); });
  await A.page.waitForFunction(() => state.studyLogs.some((l) => l.id === "L3"), null, { timeout: 8000 });
  equal(await logIds(A), ["L1", "L2", "L3"], "A recebeu o L3 ao voltar para a aba");
  assert((await toasts(A)).some((t) => t.includes("atualizados com as mudanças feitas em outro aparelho")));
  await settled(A);

  // ---- exclusão: o item apagado em A não volta por causa do B desatualizado
  await A.page.evaluate(() => { state.studyLogs = state.studyLogs.filter((l) => l.id !== "L1"); saveState(); });
  await settled(A);
  equal(serverIds(fake), ["L2", "L3"], "servidor sem o L1");
  assert(fake.savedState(EMAIL).meta.tombstones.studyLogs.L1, "a exclusão foi registrada como lápide");
  equal(await logIds(B), ["L1", "L2", "L3"], "B ainda tem o L1 (não atualizou)");
  await addLog(B, "L4");
  await settled(B);
  equal(await logIds(B), ["L2", "L3", "L4"], "no B, o L1 também sumiu");
  equal(serverIds(fake), ["L2", "L3", "L4"], "o L1 não ressuscitou no servidor");

  // ---- progresso de revisão: o que A avançou não é desfeito pelo B desatualizado
  await A.page.evaluate(() => {
    state.revisions.push(normalizeRevision({ id: "r1", kind: "manual", subjectId: "s1", originKey: "manual:r1", baseDate: new Date().toLocaleDateString("sv"), dueDate: new Date().toLocaleDateString("sv") }));
    saveState();
  });
  await settled(A);
  await B.page.evaluate(() => { remoteStore.lastRefreshAt = 0; return refreshFromRemote({ force: true }); });
  await B.page.waitForFunction(() => state.revisions.some((r) => r.id === "r1"), null, { timeout: 8000 });
  await A.page.evaluate(() => { completeRevision("r1", "ok", "lembrei tudo"); saveState(); });
  await settled(A);
  assert.strictEqual(fake.savedState(EMAIL).revisions.find((r) => r.id === "r1").history.length, 1, "A concluiu a revisão");
  await addLog(B, "L5"); // B ainda vê a revisão em R1
  await settled(B);
  const merged = fake.savedState(EMAIL).revisions.find((r) => r.id === "r1");
  assert.strictEqual(merged.history.length, 1, "o progresso da revisão não foi desfeito");
  assert.strictEqual(merged.stage, 1);
  equal(await B.page.evaluate(() => state.revisions.find((r) => r.id === "r1").stage), 1, "B também passou para R2");

  // ---- ajustes: um aparelho parado adota o que o outro mudou
  await A.page.evaluate(() => { state.edital.weeklyHours = 33; saveState(); });
  await settled(A);
  await B.page.evaluate(() => { remoteStore.lastRefreshAt = 0; return refreshFromRemote({ force: true }); });
  await B.page.waitForFunction(() => state.edital.weeklyHours === 33, null, { timeout: 8000 });

  // ---- falha do servidor: a edição fica local e, ao voltar, junta com o que o outro fez
  fake.failing = true;
  await addLog(B, "L6");
  await B.page.waitForFunction(() => remoteStore.syncStatus === "error", null, { timeout: 8000 });
  equal((await logIds(B)).includes("L6"), true, "o registro ficou salvo no B mesmo sem servidor");
  fake.failing = false;
  await addLog(A, "L7");
  await settled(A);
  equal(serverIds(fake).includes("L7"), true);
  assert.strictEqual(await B.page.evaluate(() => saveRemoteStateNow({ silent: true })), true, "B reenviou");
  const finalIds = ["L2", "L3", "L4", "L5", "L6", "L7"];
  equal(serverIds(fake), finalIds, "servidor com o trabalho dos dois");
  equal(await logIds(B), finalIds, "B com o trabalho dos dois");

  // ---- atualizar não atropela quem está editando
  await B.page.evaluate(() => { state.studyLogs.push({ id: "L8", subjectId: "s1", topicId: "", competitionId: "", minutes: 10, date: new Date().toLocaleDateString("sv"), source: "Manual", note: "", createdAt: new Date().toISOString() }); saveState(); });
  const skipped = await B.page.evaluate(() => refreshFromRemote({ force: true }));
  assert.strictEqual(skipped, false, "com edição pendente, a atualização espera");
  await settled(B);
  await A.page.evaluate(() => { remoteStore.lastRefreshAt = 0; return refreshFromRemote({ force: true }); });
  await A.page.waitForFunction(() => state.studyLogs.some((l) => l.id === "L8"), null, { timeout: 8000 });

  // ---- convergência: os dois com o mesmo conteúdo e sem ficar reenviando um ao outro
  await settled(A);
  await settled(B);
  assert.strictEqual(await fingerprint(A), await fingerprint(B), "A e B com o mesmo conteúdo");
  const writes = fake.stats.patches + fake.stats.upserts;
  for (let i = 0; i < 3; i++) {
    await A.page.evaluate(() => { remoteStore.lastRefreshAt = 0; return refreshFromRemote({ force: true }); });
    await B.page.evaluate(() => { remoteStore.lastRefreshAt = 0; return refreshFromRemote({ force: true }); });
    await A.page.waitForTimeout(700);
  }
  assert.strictEqual(fake.stats.patches + fake.stats.upserts, writes, "sem vai-e-vem: nenhuma gravação nova enquanto ninguém edita");
  console.log("convergiu; gravações totais:", fake.stats.patches + fake.stats.upserts, "| conflitos:", fake.stats.conflicts);

  // ---- login com dados locais pendentes: junta em vez de escolher um lado
  await B.page.evaluate(() => { try { localStorage.setItem("probe", "1"); } catch {} });
  const C = await newDevice(browser, fake, "C"); // aparelho novo: só baixa
  await C.page.fill("#profileName", EMAIL);
  await C.page.fill("#profilePin", PASSWORD);
  await C.page.click("#profileAccessBtn");
  await settled(C);
  equal(await logIds(C), [...finalIds, "L8"], "um aparelho novo recebe tudo");
  assert.strictEqual(await fingerprint(C), await fingerprint(A));

  const errors = [...A.errors, ...B.errors, ...C.errors];
  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E SYNC OK");
})().catch((e) => { console.error("E2E SYNC FALHOU:", e.message); process.exit(1); });
