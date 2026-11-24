// Versões na nuvem: lista do histórico e volta a uma versão anterior, que também vale para o outro aparelho.
const { launchBrowser } = require("./helpers");
const { createFakeSupabase } = require("./fake-supabase");
const assert = require("assert");
const BASE = process.env.BASE_URL;
const EMAIL = "historico@example.com";
const PASSWORD = "Senha#Forte2026";

async function newDevice(browser, fake, name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const device = { name, context, page, errors: [] };
  page.on("pageerror", (e) => device.errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_|503|404/.test(m.text())) device.errors.push(`${name} console: ${m.text()}`);
  });
  page.on("dialog", (d) => d.accept());
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await fake.install(context);
  await page.goto(BASE);
  return device;
}
const settled = (d) => d.page.waitForFunction(() => remoteStore.user && remoteStore.baseUpdatedAt && remoteStore.syncStatus === "saved" && !remoteStore.saveTimer && !remoteStore.syncing && !remoteStore.pendingSave, null, { timeout: 12000 });
const logIds = (d) => d.page.evaluate(() => state.studyLogs.map((l) => l.id).sort());
const serverIds = (fake) => ((fake.savedState(EMAIL) || {}).studyLogs || []).map((l) => l.id).sort();
const equal = (a, b, message) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const addLog = (d, id) =>
  d.page.evaluate((logId) => {
    state.studyLogs.push({ id: logId, subjectId: "s1", topicId: "", competitionId: "", minutes: 30, date: new Date().toLocaleDateString("sv"), source: "Manual", note: "", createdAt: new Date().toISOString() });
    saveState();
  }, id);
const removeLog = (d, id) => d.page.evaluate((logId) => { state.studyLogs = state.studyLogs.filter((l) => l.id !== logId); saveState(); }, id);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await launchBrowser();
  const fake = createFakeSupabase();
  const A = await newDevice(browser, fake, "A");
  const B = await newDevice(browser, fake, "B");

  // A cria a conta e usa o site: o "servidor" guarda a versão anterior a cada gravação (janela 0 no teste)
  await A.page.fill("#profileName", EMAIL);
  await A.page.fill("#profilePin", PASSWORD);
  await A.page.click("#profileSignupBtn");
  await settled(A);
  await A.page.evaluate(() => { state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }); });
  await addLog(A, "L1");
  await settled(A);
  await pause(30);
  await addLog(A, "L2");
  await settled(A);
  await pause(30);
  await removeLog(A, "L1"); // L1 vira exclusão lembrada (lápide)
  await settled(A);
  await pause(30);
  await addLog(A, "L3");
  await settled(A);
  equal(serverIds(fake), ["L2", "L3"], "servidor hoje");
  assert(fake.history.length >= 3, "o servidor guardou versões: " + fake.history.length);

  // B entra e fica com L2 e L3
  await B.page.fill("#profileName", EMAIL);
  await B.page.fill("#profilePin", PASSWORD);
  await B.page.click("#profileAccessBtn");
  await settled(B);
  equal(await logIds(B), ["L2", "L3"], "B tem os dados de hoje");

  // lista de versões na tela da conta
  await A.page.click('.nav-button[data-view="conta"]').catch(() => {});
  await A.page.evaluate(() => loadCloudVersions());
  const cards = await A.page.$$eval("#cloudVersionsList .local-recovery-card", (els) => els.length);
  assert.strictEqual(cards, fake.history.length, "a tela lista as versões guardadas");
  assert.ok(await A.page.isVisible('[data-action="restoreCloudVersion"]'));

  // versão que tinha L1 e L2 (antes da exclusão do L1)
  const target = fake.history.find((h) => JSON.stringify((h.state.studyLogs || []).map((l) => l.id).sort()) === JSON.stringify(["L1", "L2"]));
  assert.ok(target, "existe a versão com L1 e L2");
  const historyBefore = fake.history.length;
  await A.page.evaluate((id) => restoreCloudVersion(id), target.id);
  await settled(A);
  equal(await logIds(A), ["L1", "L2"], "A voltou à versão antiga: L1 revivido, L3 removido");
  equal(serverIds(fake), ["L1", "L2"], "a nuvem também voltou");
  const safety = fake.history.filter((h) => h.kind === "antes-de-restaurar");
  assert.strictEqual(safety.length, 1, "cópia de segurança na nuvem antes de restaurar");
  equal((safety[0].state.studyLogs || []).map((l) => l.id).sort(), ["L2", "L3"], "a cópia guarda o que estava aberto");
  assert.ok(fake.history.length > historyBefore);
  const cofre = await A.page.evaluate(async () => (await getIndexedRecoveryCandidates()).filter((c) => /antes de restaurar/.test(c.sourceLabel)).length);
  assert.strictEqual(cofre, 1, "e no cofre do navegador");
  const meta = fake.savedState(EMAIL).meta;
  assert.ok(meta.tombstones.studyLogs.L3, "L3 virou exclusão lembrada");
  assert.ok(meta.revivals.studyLogs.L1 > meta.tombstones.studyLogs.L1, "L1 foi revivido depois da exclusão");

  // o outro aparelho recebe a volta e não recoloca o que saiu
  await B.page.evaluate(() => { remoteStore.lastRefreshAt = 0; document.dispatchEvent(new Event("visibilitychange")); });
  await B.page.waitForFunction(() => state.studyLogs.some((l) => l.id === "L1"), null, { timeout: 8000 });
  await settled(B);
  equal(await logIds(B), ["L1", "L2"], "B também voltou: L3 saiu e L1 voltou");
  equal(serverIds(fake), ["L1", "L2"], "e não desfez a restauração no servidor");

  // B continua usando normalmente e nada se perde nem volta
  await addLog(B, "L4");
  await settled(B);
  equal(serverIds(fake), ["L1", "L2", "L4"], "depois da restauração o uso segue normal");
  await A.page.evaluate(() => { remoteStore.lastRefreshAt = 0; document.dispatchEvent(new Event("visibilitychange")); });
  await A.page.waitForFunction(() => state.studyLogs.some((l) => l.id === "L4"), null, { timeout: 8000 });
  equal(await logIds(A), ["L1", "L2", "L4"], "A recebe o L4 e continua sem o L3");

  // histórico não ativado: mensagem clara
  fake.historyMissing = true;
  await A.page.evaluate(() => loadCloudVersions());
  const text = await A.page.textContent("#cloudVersionsList");
  assert.ok(/supabase-history\.sql/.test(text), "avisa para rodar o SQL: " + text);
  fake.historyMissing = false;

  const errors = [...A.errors, ...B.errors];
  assert.strictEqual(errors.length, 0, "erros de JS: " + errors.join(" | "));
  console.log("ERROS JS: nenhum");
  console.log("E2E HISTORICO OK");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
