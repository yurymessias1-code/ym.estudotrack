// Jurisprudências e Flashcards: menu "Matérias e assuntos", janela de cadastro e busca da própria aba.
const { launchBrowser } = require("./helpers");
const assert = require("assert");
const BASE = process.env.BASE_URL;

const isHidden = (page, selector) => page.locator(selector).evaluate((el) => el.classList.contains("hidden"));
const typeInEditor = async (page, selector, text) => {
  await page.click(selector);
  await page.keyboard.type(text);
};

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

  // matérias e assuntos
  await page.click('.nav-button[data-view="plano"]');
  for (const [subject, topics] of [["Direito Constitucional", ["Direitos fundamentais", "Poder Legislativo"]], ["Direito Administrativo", ["Improbidade"]]]) {
    await page.fill("#subjectName", subject);
    await page.click("#subjectSubmitBtn");
    for (const topic of topics) {
      await page.selectOption("#topicSubject", { label: subject });
      await page.fill("#topicName", topic);
      await page.click("#topicSubmitBtn");
    }
  }

  // ---------------- Jurisprudências ----------------
  await page.click('.nav-button[data-view="jurisprudencias"]');
  assert(await isHidden(page, "#caseModal"), "janela de cadastro deveria começar fechada");
  assert(await page.locator("#jurisNav .empty-state").count(), "menu vazio deveria avisar que aparece com itens");

  async function addCase({ court, subject, topic, title, text }) {
    await page.click("#jurisAddBtn");
    assert(!(await isHidden(page, "#caseModal")), "botão Adicionar deveria abrir a janela");
    await page.selectOption("#caseCourtSelect", court);
    await page.selectOption("#caseSubject", { label: subject });
    if (topic) await page.selectOption("#caseTopic", { label: topic });
    await page.fill("#caseTitle", title);
    await typeInEditor(page, "#caseSummaryEditor", text);
    await page.click("#caseSubmitBtn");
    await page.waitForSelector("#caseModal.hidden", { state: "attached" });
  }
  await addCase({ court: "STJ", subject: "Direito Administrativo", topic: "Improbidade", title: "Tema 1199 dolo", text: "Exige dolo especifico" });
  await addCase({ court: "STJ", subject: "Direito Constitucional", topic: "Direitos fundamentais", title: "REsp sobre sigilo", text: "Sigilo bancario e reserva de jurisdicao" });
  await addCase({ court: "STF", subject: "Direito Constitucional", topic: "Poder Legislativo", title: "ADI imunidade", text: "Imunidade parlamentar material" });
  assert.deepStrictEqual(await page.evaluate(() => [state.cases.STJ.length, state.cases.STF.length]), [2, 1]);

  // aba STJ: só 2 julgados, agrupados por matéria, com contagem no menu
  await page.click('[data-case-tab="STJ"]');
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 2);
  assert.strictEqual(await page.locator("#caseList .error-group-title").count(), 2, "um bloco por matéria");
  await page.screenshot({ path: "estrutura-juris.png", fullPage: false });
  assert((await page.locator("#jurisNav .is-all .nav-num").textContent()).trim() === "2");

  // menu: escolher matéria > assunto
  await page.click('#jurisNav .is-subject[data-subject]:has-text("Direito Constitucional")');
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 1);
  assert((await page.locator("#jurisCrumb").textContent()).includes("Direito Constitucional"));
  await page.click('#jurisNav .is-all');
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 2);

  // busca só da aba (STJ): a ADI do STF não aparece, e o menu acompanha a busca
  await page.fill("#caseSearch", "imunidade");
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 0, "ADI é do STF; busca da aba atual não pode achar");
  await page.click('[data-estrutura="courtAll"]');
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 1, "escopo STJ + STF acha a ADI");
  await page.click('[data-estrutura="clearJuris"] >> nth=0');
  await page.click('[data-case-tab="STJ"]');
  assert.strictEqual(await page.inputValue("#caseSearch"), "");

  // editar: abre a janela já preenchida; Esc fecha
  await page.click('#caseList [data-action="editCase"] >> nth=0');
  assert(!(await isHidden(page, "#caseModal")));
  assert((await page.inputValue("#caseTitle")).length > 0);
  await page.screenshot({ path: "estrutura-modal.png", fullPage: false });
  await page.keyboard.press("Escape");
  assert(await isHidden(page, "#caseModal"), "Esc deve fechar a janela");

  // com matéria selecionada no menu, "Adicionar" já vem com ela escolhida
  await page.click('#jurisNav .is-subject[data-subject]:has-text("Direito Administrativo")');
  await page.click("#jurisAddBtn");
  assert.strictEqual(await page.locator("#caseSubject option:checked").textContent().then((t) => t.trim()), "Direito Administrativo");
  await page.click('#caseModal [data-estrutura="close"]');
  assert(await isHidden(page, "#caseModal"));
  await page.click('#jurisNav .is-all');

  // ---------------- Julgados antigos, sem matéria/assunto ----------------
  await page.click('[data-estrutura="courtAll"]');
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 3, "Todos mostra STJ e STF juntos");
  assert((await page.locator('[data-court-count="ALL"]').textContent()).trim() === "3");
  await page.evaluate(() => {
    state.cases.STJ.push(normalizeCaseItem({ title: "Julgado antigo sobre improbidade", summary: "<p>texto qualquer</p>" }), normalizeCaseItem({ title: "Sem pista nenhuma" }));
    state.cases.STF.push(normalizeCaseItem({ title: "ADI antiga", theme: "Poder Legislativo" }));
    saveState();
    renderCases();
  });
  assert.strictEqual(await page.locator("#caseList .case-card").count(), 6, "julgados antigos aparecem mesmo sem vínculo");
  assert((await page.locator("#caseList .error-group-title").allTextContents()).join("|").includes("Sem matéria"));
  assert((await page.locator("#jurisOrganizeBar").textContent()).includes("3"), "aviso conta os 3 sem matéria");
  await page.click('#jurisOrganizeBar [data-estrutura="organize"]');
  assert(!(await isHidden(page, "#organizeModal")));
  assert.strictEqual(await page.locator("#organizeList .organize-row").count(), 3);
  const rowInfo = await page.evaluate(() =>
    [...document.querySelectorAll("#organizeList .organize-row")].map((row) => [
      row.querySelector("strong").textContent,
      row.querySelector(".organize-subject option:checked").textContent.trim(),
      row.querySelector(".organize-topic option:checked").textContent.trim(),
    ])
  );
  const byTitle = Object.fromEntries(rowInfo.map(([title, subject, topic]) => [title, [subject, topic]]));
  assert.deepStrictEqual(byTitle["Julgado antigo sobre improbidade"], ["Direito Administrativo", "Improbidade"]);
  assert.deepStrictEqual(byTitle["ADI antiga"], ["Direito Constitucional", "Poder Legislativo"]);
  assert.deepStrictEqual(byTitle["Sem pista nenhuma"], ["— sem matéria —", "— sem assunto —"]);
  await page.screenshot({ path: "estrutura-organizar.png", fullPage: false });
  // o usuário ajusta o que não tinha pista e aplica
  await page.locator('#organizeList .organize-row:has-text("Sem pista nenhuma") .organize-subject').selectOption({ label: "Direito Constitucional" });
  await page.click('[data-estrutura="organizeApply"]');
  assert(await isHidden(page, "#organizeModal"));
  const linked = await page.evaluate(() => {
    const all = [...state.cases.STJ, ...state.cases.STF];
    const topicName = (id) => state.topics.find((t) => t.id === id)?.name || "";
    const subjectName = (id) => state.subjects.find((x) => x.id === id)?.name || "";
    return all.filter((item) => /antig|pista/.test(item.title)).map((item) => [item.title, subjectName(item.subjectId), topicName(item.topicId)]);
  });
  assert.deepStrictEqual(linked.find(([title]) => title.startsWith("Julgado antigo")), ["Julgado antigo sobre improbidade", "Direito Administrativo", "Improbidade"]);
  assert.deepStrictEqual(linked.find(([title]) => title === "Sem pista nenhuma"), ["Sem pista nenhuma", "Direito Constitucional", ""]);
  assert((await page.locator("#caseList .error-group-title").allTextContents()).join("|").includes("Sem matéria") === false, "nada mais sem matéria");
  // Matéria aberta: o que está direto nela vem primeiro; assuntos viram tópicos depois
  await page.click('#jurisNav .is-subject[data-subject]:has-text("Direito Constitucional")');
  const titles = await page.locator("#caseList .error-group-title").allTextContents();
  assert(titles[0].startsWith("Direto na matéria"), "primeiro grupo: sem assunto. Veio: " + titles.join("|"));
  assert(titles.length > 1, "assuntos aparecem depois, como tópicos");
  assert((await page.locator("#caseList .error-group").first().textContent()).includes("Sem pista nenhuma"));
  await page.click('#jurisNav .is-all');
  await page.click('[data-case-tab="STJ"]');

  // ---------------- Leis e tabelas ----------------
  await page.click('[data-juris-section="material"]');
  assert(!(await isHidden(page, "#jurisMaterialPane")) && (await isHidden(page, "#jurisCasesPane")));
  assert((await page.locator("#jurisAddBtn").textContent()).includes("material"));
  await page.click("#jurisAddBtn");
  assert(!(await isHidden(page, "#legalMaterialModal")));
  await page.selectOption("#legalMaterialType", "table");
  await page.selectOption("#legalMaterialSubject", { label: "Direito Administrativo" });
  await page.fill("#legalMaterialTitle", "Prazos prescricionais");
  await page.evaluate(() => {
    const editor = document.querySelector("#legalMaterialContentEditor");
    editor.innerHTML = "<table><tr><td>Ato</td><td>Prazo</td></tr><tr><td>Improbidade</td><td>8 anos</td></tr></table>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#legalMaterialSubmitBtn");
  await page.waitForSelector("#legalMaterialModal.hidden", { state: "attached" });
  await page.selectOption("#legalMaterialType", "law").catch(() => {});
  assert.strictEqual(await page.evaluate(() => state.legalMaterials.length), 1);
  assert.strictEqual(await page.locator("#legalMaterialList .legal-material-card").count(), 1);
  assert((await page.locator("#legalMaterialList .error-group-title").textContent()).includes("Direito Administrativo"));
  await page.click('#jurisMaterialTypes [data-type="law"]');
  assert.strictEqual(await page.locator("#legalMaterialList .legal-material-card").count(), 0, "filtro por tipo Lei esconde a tabela");
  await page.click('#jurisMaterialTypes [data-type="table"]');
  assert.strictEqual(await page.locator("#legalMaterialList .legal-material-card").count(), 1);
  await page.fill("#legalMaterialSearch", "inexistente");
  assert.strictEqual(await page.locator("#legalMaterialList .legal-material-card").count(), 0);
  await page.fill("#legalMaterialSearch", "8 anos");
  assert.strictEqual(await page.locator("#legalMaterialList .legal-material-card").count(), 1, "busca olha o conteúdo da tabela");
  await page.screenshot({ path: "estrutura-material.png", fullPage: false });
  await page.click('[data-estrutura="clearJuris"] >> nth=1');

  // ---------------- Flashcards ----------------
  await page.click('.nav-button[data-view="flashcards"]');
  assert(await isHidden(page, "#flashcardModal"));
  async function addCard(subject, topic, front, back) {
    await page.click('#flashcards .section-heading [data-estrutura="add"]');
    assert(!(await isHidden(page, "#flashcardModal")));
    await page.selectOption("#flashcardSubject", { label: subject });
    if (topic) await page.selectOption("#flashcardTopic", { label: topic });
    await typeInEditor(page, "#flashcardFrontEditor", front);
    await typeInEditor(page, "#flashcardBackEditor", back);
    await page.click("#flashcardSubmitBtn");
    await page.waitForSelector("#flashcardModal.hidden", { state: "attached" });
  }
  await addCard("Direito Constitucional", "Direitos fundamentais", "O que e habeas data?", "Garante acesso a informacoes");
  await addCard("Direito Constitucional", "Poder Legislativo", "Quem julga o Presidente?", "Senado Federal");
  await addCard("Direito Administrativo", "Improbidade", "Prazo da improbidade?", "Oito anos");
  assert.strictEqual(await page.evaluate(() => state.flashcards.length), 3);
  assert.strictEqual(await page.locator("#flashcardLibrary .flashcard-library-card").count(), 3);
  assert.strictEqual(await page.locator("#flashcardLibrary .error-group-title").count(), 2, "um bloco por matéria");

  await page.click('#flashNav .is-subject[data-subject]:has-text("Direito Constitucional")');
  assert.strictEqual(await page.locator("#flashcardLibrary .flashcard-library-card").count(), 2);
  await page.screenshot({ path: "estrutura-flash.png", fullPage: false });
  assert(await page.locator("#flashcardLibrary .error-group-title").count() === 2, "com matéria escolhida, blocos por assunto");
  await page.click('#flashNav .is-topic:has-text("Poder Legislativo")');
  assert.strictEqual(await page.locator("#flashcardLibrary .flashcard-library-card").count(), 1);

  // "Revisar só este assunto" leva a seleção para a sessão de revisão
  await page.click("#flashReviewScopeBtn");
  const scope = await page.evaluate(() => [state.ui.flashcardReviewScope, state.ui.flashcardReviewTopicId === state.topics.find((t) => t.name === "Poder Legislativo").id]);
  assert.deepStrictEqual(scope, ["topic", true]);

  await page.click('[data-estrutura="clearFlash"]');
  await page.fill("#flashcardSearch", "oito anos");
  assert.strictEqual(await page.locator("#flashcardLibrary .flashcard-library-card").count(), 1, "busca olha o verso");
  await page.fill("#flashcardSearch", "");

  // editar abre a janela preenchida
  await page.click('#flashcardLibrary [data-action="editFlashcard"] >> nth=0');
  assert(!(await isHidden(page, "#flashcardModal")));
  assert((await page.locator("#flashcardFrontEditor").textContent()).length > 0);
  await page.click("#flashcardCancelEditBtn");
  assert(await isHidden(page, "#flashcardModal"));

  // dados continuam depois de recarregar a página
  await page.reload();
  await page.fill("#profileName", "teste");
  await page.fill("#profilePin", "1234");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(700);
  assert.deepStrictEqual(await page.evaluate(() => [state.cases.STJ.length, state.cases.STF.length, state.legalMaterials.length, state.flashcards.length]), [4, 2, 1, 3]);

  assert.deepStrictEqual(errors, [], "erros no console: " + errors.join(" | "));
  await browser.close();
  console.log("estrutura.e2e: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
