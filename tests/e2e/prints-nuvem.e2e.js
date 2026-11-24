// Prints do caderno de erros na conta online: envio, outro aparelho, exclusão, falha sem internet e backup em arquivo.
const { launchBrowser } = require("./helpers");
const { createFakeSupabase } = require("./fake-supabase");
const assert = require("assert");
const fs = require("fs");
const BASE = process.env.BASE_URL;
const EMAIL = "prints@example.com";
const PASSWORD = "Senha#Forte2026";

async function newDevice(browser, fake, name, { supabase = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const device = { name, context, page, errors: [] };
  page.on("pageerror", (e) => device.errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_|503|internetdisconnected/.test(m.text())) device.errors.push(`${name} console: ${m.text()}`);
  });
  page.on("dialog", (d) => d.accept());
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  if (supabase) await fake.install(context);
  else await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.goto(BASE);
  return device;
}

const settled = (d) => d.page.waitForFunction(() => remoteStore.user && remoteStore.syncStatus === "saved" && !remoteStore.saveTimer && !remoteStore.syncing && !remoteStore.pendingSave, null, { timeout: 12000 });

const pasteImage = (page, selector, label) =>
  page.evaluate(async ({ selector, label }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 500;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff8e1";
    ctx.fillRect(0, 0, 900, 500);
    ctx.fillStyle = "#17202a";
    ctx.font = "bold 60px sans-serif";
    ctx.fillText(label, 40, 200);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "print.png", { type: "image/png" }));
    document.querySelector(selector).dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { selector, label });

const idbRecords = (page) =>
  page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("estudosTrack.erroImagens", 1);
    request.onsuccess = () => {
      const all = request.result.transaction("imagens").objectStore("imagens").getAll();
      all.onsuccess = () => resolve(all.result.map((r) => ({ id: r.id, synced: r.synced, size: r.blob.size })));
    };
    request.onerror = () => resolve([]);
  }));

(async () => {
  const browser = await launchBrowser();
  const fake = createFakeSupabase();
  const A = await newDevice(browser, fake, "A");

  // ---- A: conta, matéria e um erro com print da questão e print dentro do caderno
  await A.page.fill("#profileName", EMAIL);
  await A.page.fill("#profilePin", PASSWORD);
  await A.page.click("#profileSignupBtn");
  await settled(A);
  await A.page.evaluate(() => { state.subjects.push({ id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 }); saveState(); });
  await settled(A);
  await A.page.click('.nav-button[data-view="erros"]');
  await A.page.click("#errorNewBtn");
  await A.page.selectOption("#errorSubject", { label: "Direito Penal" });
  await pasteImage(A.page, "#errorStatement", "QUESTAO NUVEM");
  await A.page.waitForSelector("#errorShotsQuestion .shot img[src^='blob:']");
  await A.page.click("#errorNotes");
  await pasteImage(A.page, "#errorNotes", "PRINT NO CADERNO");
  await A.page.waitForSelector("#errorNotes img[src^='blob:']");
  await A.page.click("#errorSubmitBtn");
  await A.page.waitForFunction(() => state.errorNotebook.length === 1);
  await A.page.waitForFunction(() => erroAllPrintIds(state).length === 2);
  await A.page.waitForFunction(() => !erroCloud.busy);
  await settled(A);
  await A.page.waitForFunction(() => document.getElementById("errorCloudStatus").textContent.includes("guardados na sua conta"), null, { timeout: 8000 });
  assert.strictEqual(fake.storage.size, 2, "os dois prints foram para o bucket, na pasta do usuário: " + [...fake.storage.keys()]);
  assert([...fake.storage.keys()].every((k) => k.startsWith("user-1/")), "pasta = user_id");
  assert((await idbRecords(A.page)).every((r) => r.synced === true), "prints locais marcados como enviados");
  const ids = await A.page.evaluate(() => erroAllPrintIds(state));
  console.log("A) 2 prints na nuvem:", ids.join(", "));

  // ---- B: aparelho novo (IndexedDB vazio) entra na conta e enxerga os prints
  const B = await newDevice(browser, fake, "B");
  await B.page.fill("#profileName", EMAIL);
  await B.page.fill("#profilePin", PASSWORD);
  await B.page.click("#profileAccessBtn");
  await settled(B);
  assert.strictEqual((await idbRecords(B.page)).length, 0, "B começa sem prints locais");
  await B.page.click('.nav-button[data-view="erros"]');
  await B.page.locator("#errorList .error-card").first().scrollIntoViewIfNeeded();
  await B.page.waitForSelector("#errorList .shot img[src^='blob:']", { timeout: 8000 });
  await B.page.waitForSelector("#errorList .error-notes img[src^='blob:']", { timeout: 8000 });
  assert.strictEqual(await B.page.locator("#errorList .is-missing").count(), 0, "nenhum print indisponível no B");
  assert.strictEqual((await idbRecords(B.page)).length, 2, "B guardou os prints baixados no aparelho");
  assert(fake.stats.downloads >= 2, "B baixou da nuvem");
  console.log("B) viu os prints baixados da nuvem");

  // ---- B: apagar o erro remove os prints da nuvem
  await B.page.click('[data-cycle-action="deleteError"]');
  await B.page.waitForFunction(() => state.errorNotebook.length === 0);
  await B.page.waitForFunction(() => erroCloudQueueRead().length === 0 && !erroCloud.busy, null, { timeout: 8000 });
  assert.strictEqual(fake.storage.size, 0, "bucket vazio depois de apagar o erro");
  assert.strictEqual((await idbRecords(B.page)).length, 0, "e o cache local também");
  console.log("B) exclusão limpou aparelho e nuvem");
  await settled(B);

  // ---- C: sem internet no momento de salvar; ao voltar, o envio é retomado
  const C = await newDevice(browser, fake, "C");
  await C.page.fill("#profileName", EMAIL);
  await C.page.fill("#profilePin", PASSWORD);
  await C.page.click("#profileAccessBtn");
  await settled(C);
  await C.page.click('.nav-button[data-view="erros"]');
  fake.storageFailing = true;
  await C.page.click("#errorNewBtn");
  await C.page.selectOption("#errorSubject", { label: "Direito Penal" });
  await pasteImage(C.page, "#errorStatement", "OFFLINE");
  await C.page.waitForSelector("#errorShotsQuestion .shot img[src^='blob:']");
  await C.page.click("#errorSubmitBtn");
  await C.page.waitForFunction(() => state.errorNotebook.length === 1);
  await C.page.waitForTimeout(1200);
  assert.strictEqual(fake.storage.size, 0, "nada foi enviado enquanto estava offline");
  assert.strictEqual((await idbRecords(C.page)).filter((r) => !r.synced).length, 1, "print segue pendente no aparelho");
  fake.storageFailing = false;
  await C.page.evaluate(() => erroCloudKick(10));
  await C.page.waitForFunction(() => !erroCloud.busy && document.getElementById("errorCloudStatus").textContent.includes("guardados na sua conta"), null, { timeout: 8000 });
  assert.strictEqual(fake.storage.size, 1, "envio retomado ao voltar a conexão");
  console.log("C) fila offline retomada");

  // ---- backup em arquivo leva os prints; restaura num navegador sem conta
  const [download] = await Promise.all([C.page.waitForEvent("download"), C.page.evaluate(() => downloadBackupFile())]);
  const file = await download.path();
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(Object.keys(backup.prints || {}).length, 1, "arquivo de backup contém o print");
  assert(/^data:image\//.test(Object.values(backup.prints)[0]), "print em data URL");
  assert(!JSON.stringify(await C.page.evaluate(() => document.getElementById("backupCode").value)).includes("data:image"), "o código para copiar não leva imagens");

  const D = await newDevice(browser, fake, "D", { supabase: false });
  await D.page.fill("#profileName", "offline");
  await D.page.fill("#profilePin", "1234");
  await D.page.click("#profileSignupBtn");
  await D.page.waitForTimeout(400);
  await D.page.click('.nav-button[data-view="erros"]');
  await D.page.evaluate((text) => restoreBackupFromText(text), JSON.stringify(backup));
  await D.page.waitForFunction(() => state.errorNotebook.length === 1);
  await D.page.locator("#errorList .error-card").first().scrollIntoViewIfNeeded();
  await D.page.waitForSelector("#errorList .shot img[src^='blob:']", { timeout: 8000 });
  assert.strictEqual(await D.page.locator("#errorList .is-missing").count(), 0, "print restaurado do backup");
  console.log("D) backup restaurado com o print, sem conta online");

  // ---- conta sem o bucket: mensagem clara em vez de silêncio
  fake.bucketMissing = true;
  await C.page.evaluate(() => { erroCloud.lastError = ""; erroCloudMiss.clear(); });
  await C.page.evaluate(async () => { const id = erroAllPrintIds(state)[0]; const db = await erroImgOpenDB(); await new Promise((r) => { const tx = db.transaction("imagens", "readwrite"); const st = tx.objectStore("imagens"); const g = st.get(id); g.onsuccess = () => st.put({ ...g.result, synced: false }); tx.oncomplete = r; }); erroCloudKick(10); });
  await C.page.waitForFunction(() => erroCloud.lastError === "bucket", null, { timeout: 8000 });
  await C.page.evaluate(() => cycleRefresh());
  await C.page.waitForFunction(() => document.getElementById("errorCloudStatus").textContent.includes("erro-prints"), null, { timeout: 5000 });
  console.log("bucket ausente: aviso mostrado");

  const errors = [A, B, C, D].flatMap((d) => d.errors);
  console.log(errors.length ? "ERROS JS: " + errors.join("\n") : "ERROS JS: nenhum");
  await browser.close();
  if (errors.length) process.exit(1);
  console.log("E2E PRINTS NUVEM OK");
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
