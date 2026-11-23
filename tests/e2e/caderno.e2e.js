// Caderno de erros: colar prints, menu por matéria/assunto, persistência dos prints e limpeza ao excluir.
const { launchBrowser } = require("./helpers");
const assert = require("assert");
const BASE = process.env.BASE_URL;
const shots = "";

// Cola uma imagem desenhada na hora (como um print) no elemento indicado, com um ClipboardEvent de verdade.
async function pasteImage(page, selector, label) {
  await page.evaluate(
    async ({ selector, label }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 2400; // maior que o limite: precisa ser reduzido
      canvas.height = 1200;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff8e1";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#17202a";
      ctx.font = "bold 90px sans-serif";
      ctx.fillText(label, 80, 200);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "print.png", { type: "image/png" }));
      const target = selector === "body" ? document.body : document.querySelector(selector);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { selector, label }
  );
}

const idbCount = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("estudosTrack.erroImagens", 1);
        request.onsuccess = () => {
          const count = request.result.transaction("imagens").objectStore("imagens").count();
          count.onsuccess = () => resolve(count.result);
        };
        request.onerror = () => resolve(-1);
      })
  );

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push("console: " + m.text()); });
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(BASE);

  await page.fill("#profileName", "teste");
  await page.fill("#profilePin", "1234");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);

  // duas matérias, com assuntos
  await page.click('.nav-button[data-view="plano"]');
  for (const [subject, topics] of [["Direito Constitucional", ["Direitos fundamentais", "Poder Legislativo"]], ["Português", ["Crase"]]]) {
    await page.fill("#subjectName", subject);
    await page.click("#subjectSubmitBtn");
    for (const topic of topics) {
      await page.selectOption("#topicSubject", { label: subject });
      await page.fill("#topicName", topic);
      await page.click("#topicSubmitBtn");
    }
  }

  await page.click('.nav-button[data-view="erros"]');
  assert(await page.locator("#errorForm").evaluate((el) => el.classList.contains("hidden")), "formulário deveria começar fechado");

  // ---- 1) erro com print da questão e do gabarito ----
  await page.click("#errorNewBtn");
  await page.selectOption("#errorSubject", { label: "Direito Constitucional" });
  await page.selectOption("#errorTopic", { label: "Direitos fundamentais" });
  await page.fill("#errorSource", "Cebraspe 2024");
  await pasteImage(page, "#errorStatement", "QUESTAO 1: habeas data");
  await page.waitForSelector("#errorShotsQuestion .shot img[src^='blob:']");
  await pasteImage(page, "#errorCorrect", "GABARITO 1");
  await page.waitForSelector("#errorShotsAnswer .shot img[src^='blob:']");
  const draftSize = await page.evaluate(() => ({ q: { w: erroDraft.question[0].w, h: erroDraft.question[0].h, size: erroDraft.question[0].blob.size }, a: erroDraft.answer.length }));
  assert(draftSize.q.w <= 1600 && draftSize.q.h <= 1600, "print não foi reduzido: " + JSON.stringify(draftSize.q));
  assert(draftSize.q.size < 400_000, "print ficou pesado: " + draftSize.q.size);
  assert.strictEqual(draftSize.a, 1);
  await page.fill("#errorRule", "Habeas data: gratuito.");
  await page.screenshot({ path: shots + "caderno-form.png", fullPage: true });
  await page.click("#errorSubmitBtn");
  await page.waitForFunction(() => state.errorNotebook.length === 1);
  const first = await page.evaluate(() => JSON.parse(JSON.stringify(state.errorNotebook[0])));
  assert.strictEqual(first.images.length, 1);
  assert.strictEqual(first.answerImages.length, 1);
  assert.strictEqual(first.statement, "", "enunciado só em print deve ser aceito");
  assert(!JSON.stringify(first).includes("data:image"), "imagem não pode ir em base64 para o estado");
  assert.strictEqual(await idbCount(page), 2, "os dois prints deveriam estar no IndexedDB");
  // formulário continua aberto, na mesma matéria/assunto/fonte, sem prints
  assert.strictEqual(await page.inputValue("#errorSource"), "Cebraspe 2024");
  assert.strictEqual(await page.locator("#errorShotsQuestion .shot").count(), 0);
  assert.strictEqual(await page.locator("#errorTopic option:checked").textContent().then((t) => t.trim()), "Direitos fundamentais");

  // ---- 2) erro só de texto em outra matéria ----
  await page.selectOption("#errorSubject", { label: "Português" });
  await page.selectOption("#errorTopic", { label: "Crase" });
  await page.fill("#errorStatement", "Fui a pé até a casa.");
  await page.fill("#errorCorrect", "Sem crase antes de palavra masculina.");
  await page.click("#errorSubmitBtn");
  await page.waitForFunction(() => state.errorNotebook.length === 2);

  // ---- 3) colar com o formulário fechado abre o formulário (captura rápida) ----
  await page.click("#errorCancelBtn");
  assert(await page.locator("#errorForm").evaluate((el) => el.classList.contains("hidden")), "formulário deveria fechar");
  await page.click('#errorNav .error-nav-item.is-subject:has-text("Direito Constitucional")');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await pasteImage(page, "body", "QUESTAO 3 colada fora");
  await page.waitForSelector("#errorShotsQuestion .shot img[src^='blob:']");
  assert(!(await page.locator("#errorForm").evaluate((el) => el.classList.contains("hidden"))), "formulário deveria abrir ao colar");
  assert.strictEqual(await page.locator("#errorSubject option:checked").textContent(), "Direito Constitucional", "matéria do menu deveria vir preenchida");
  await page.fill("#errorCorrect", "Certo.");
  await page.selectOption("#errorTopic", { label: "Poder Legislativo" });
  await page.click("#errorSubmitBtn");
  await page.waitForFunction(() => state.errorNotebook.length === 3);
  await page.click("#errorCancelBtn");

  // ---- 4) menu por matéria/assunto ----
  await page.click('#errorNav .error-nav-item.is-all');
  let nav = await page.textContent("#errorNav");
  assert(nav.includes("Direito Constitucional") && nav.includes("Português"), "menu sem as matérias");
  assert.strictEqual(await page.locator(".error-group-title").count(), 2, "lista deveria ser agrupada por matéria");
  await page.click('#errorNav .error-nav-item.is-subject:has-text("Direito Constitucional")');
  assert.strictEqual(await page.locator("#errorList .error-card").count(), 2);
  assert(!(await page.textContent("#errorList")).includes("Fui a pé"), "erro de Português apareceu no filtro de Direito");
  const groupTitles = await page.locator(".error-group-title").allTextContents();
  assert(groupTitles.some((t) => t.includes("Direitos fundamentais")) && groupTitles.some((t) => t.includes("Poder Legislativo")), "agrupamento por assunto ausente: " + groupTitles);
  await page.click('#errorNav .error-nav-item.is-topic:has-text("Poder Legislativo")');
  assert.strictEqual(await page.locator("#errorList .error-card").count(), 1);
  assert((await page.textContent("#errorCrumb")).includes("Poder Legislativo"), "caminho (breadcrumb) ausente");
  await page.screenshot({ path: shots + "caderno-menu.png", fullPage: true });
  await page.click('#errorCrumb .crumb-link:has-text("Todas")');
  assert.strictEqual(await page.locator("#errorList .error-card").count(), 3);

  // ---- 5) prints aparecem no card; ampliar ----
  await page.click('#errorNav .error-nav-item.is-topic:has-text("Direitos fundamentais"), #errorNav .error-nav-item.is-subject:has-text("Direito Constitucional")');
  await page.waitForSelector("#errorList .shot img[src^='blob:']");
  await page.click("#errorList .shot-open >> nth=0");
  await page.waitForSelector("#shotViewer:not(.hidden) #shotViewerImg[src^='blob:']");
  const natural = await page.evaluate(() => document.getElementById("shotViewerImg").naturalWidth);
  assert(natural > 0 && natural <= 1600, "largura natural do print: " + natural);
  await page.screenshot({ path: shots + "caderno-viewer.png" });
  await page.keyboard.press("Escape");
  assert(await page.locator("#shotViewer").evaluate((el) => el.classList.contains("hidden")), "Esc deveria fechar o visualizador");

  // ---- 6) gabarito em print fica escondido ao refazer ----
  await page.selectOption("#errorFilterStatus", "all");
  const answerImgs = await page.locator("#errorList .error-block.right .shot").count();
  assert(answerImgs >= 1, "print do gabarito deveria aparecer no card");
  await page.click('#errorNav .error-nav-item.is-all');
  await page.evaluate(() => { cycleUI.errorRetest = { id: state.errorNotebook[0].id, open: false }; renderCycle(); });
  assert.strictEqual(await page.locator("#errorList .error-card:has(.retest-box) .error-block.right").count(), 0, "gabarito (texto ou print) apareceu antes da hora");
  assert.strictEqual(await page.locator("#errorList .error-card:has(.retest-box) .error-block .shot").count() >= 1, true, "print da questão deveria continuar visível ao refazer");
  await page.click('[data-cycle-action="showErrorAnswer"]');
  await page.waitForSelector("#errorList .error-card:has(.retest-box) .error-block.right .shot");

  // ---- 7) persistência: recarregar a página ----
  await page.reload();
  await page.fill("#profileName", "teste");
  await page.fill("#profilePin", "1234");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(500);
  await page.click('.nav-button[data-view="erros"]');
  await page.selectOption("#errorFilterStatus", "all");
  await page.waitForSelector("#errorList .shot img[src^='blob:']");
  assert.strictEqual(await page.locator("#errorList .shot.is-missing").count(), 0, "prints sumiram após recarregar");

  // ---- 8) editar: remover um print; excluir: apaga do IndexedDB ----
  await page.evaluate(() => { cycleUI.errorRetest = { id: "", open: false }; });
  const withShots = await page.evaluate(() => state.errorNotebook.find((e) => e.images.length && e.answerImages.length).id);
  await page.click(`[data-cycle-action="editError"][data-id="${withShots}"]`);
  await page.waitForSelector("#errorShotsQuestion .shot");
  assert.strictEqual(await page.locator("#errorShotsAnswer .shot").count(), 1);
  await page.click("#errorShotsAnswer .shot-remove");
  // gabarito é opcional: com a questão preenchida, o erro salva sem resposta correta
  await page.click("#errorSubmitBtn");
  await page.waitForFunction((id) => state.errorNotebook.find((e) => e.id === id).answerImages.length === 0, withShots);
  assert.strictEqual(await idbCount(page), 2, "print removido deveria sair do IndexedDB (3 -> 2)");
  page.on("dialog", (d) => d.accept());
  await page.click(`[data-cycle-action="deleteError"][data-id="${withShots}"]`);
  await page.waitForFunction(() => state.errorNotebook.length === 2);
  await page.waitForTimeout(200);
  assert.strictEqual(await idbCount(page), 1, "excluir o erro deveria apagar o print (2 -> 1)");

  // ---- 9) mobile sem rolagem lateral ----
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: shots + "caderno-mobile.png", fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, "overflow horizontal no mobile (px): " + overflow);

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
