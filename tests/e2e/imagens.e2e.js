// Imagens dos documentos (jurisprudências, leis/tabelas, fontes): saem do estado e vão para o Storage.
const { launchBrowser } = require("./helpers");
const { createFakeSupabase } = require("./fake-supabase");
const assert = require("assert");
const BASE = process.env.BASE_URL;
const EMAIL = "imagens@example.com";
const PASSWORD = "Senha#Forte2026";

async function newDevice(browser, fake, name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const device = { name, context, page, errors: [] };
  page.on("pageerror", (e) => device.errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_|503|404|400/.test(m.text())) device.errors.push(`${name} console: ${m.text()}`);
  });
  page.on("dialog", (d) => d.accept());
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await fake.install(context);
  await page.goto(BASE);
  return device;
}
const settled = (d) => d.page.waitForFunction(() => remoteStore.user && remoteStore.baseUpdatedAt && remoteStore.syncStatus === "saved" && !remoteStore.saveTimer && !remoteStore.syncing && !remoteStore.pendingSave, null, { timeout: 12000 });
const idle = (d) => d.page.waitForFunction(() => !erroCloud.busy && !docImgMigrating, null, { timeout: 12000 });
const syncImages = async (d) => { await idle(d); await d.page.evaluate(() => erroCloudSync()); await idle(d); };
const until = async (check, message, ms = 9000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("tempo esgotado: " + message);
};
const hasInline = (d) => d.page.evaluate(() => JSON.stringify(state).includes("data:image/"));

(async () => {
  const browser = await launchBrowser();
  const fake = createFakeSupabase();
  const A = await newDevice(browser, fake, "A");
  const B = await newDevice(browser, fake, "B");

  await A.page.fill("#profileName", EMAIL);
  await A.page.fill("#profilePin", PASSWORD);
  await A.page.click("#profileSignupBtn");
  await settled(A);

  // dados antigos: três imagens em base64 dentro do estado (uma repetida em dois lugares)
  await A.page.evaluate(() => {
    const mk = (color) => {
      // ruído por cima da cor: o PNG fica com algumas dezenas de KB, como uma imagem de verdade
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 160, 160);
      const pixels = ctx.getImageData(0, 0, 160, 160);
      for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 1] = Math.floor(Math.random() * 256);
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    };
    const [u1, u2, u3] = [mk("#ff0000"), mk("#00aa00"), mk("#0000ff")];
    state.subjects.push({ id: "s1", name: "Penal", color: "#0f766e", goalHours: 5 });
    state.legalMaterials.push(normalizeLegalMaterial({ id: "lm1", type: "image", title: "Tabela", content: u1 }));
    state.cases.STJ.push(normalizeCaseItem({ id: "c1", title: "HC 1", summary: `<p>Tese</p><img src="${u2}" alt="a"><img src="${u1}" alt="b">` }));
    state.sources.push(normalizeSource({ id: "src1", title: "Fonte", content: `<p>x</p><img src="${u3}">` }));
    saveState();
  });
  assert.ok(await hasInline(A), "começa com imagens em base64 no estado");
  const before = await A.page.evaluate(() => JSON.stringify(state).length);

  // sem o Storage funcionando, nada é trocado: a imagem continua inteira onde estava
  fake.storageFailing = true;
  await syncImages(A);
  assert.ok(await hasInline(A), "envio falhou: as imagens continuam no estado");
  assert.strictEqual(fake.storage.size, 0);

  // com o Storage de volta, as imagens saem do estado
  fake.storageFailing = false;
  await syncImages(A);
  assert.ok(!(await hasInline(A)), "nenhuma imagem em base64 sobrou no estado");
  assert.strictEqual(fake.storage.size, 3, "3 imagens diferentes no Storage (a repetida vale uma só)");
  const after = await A.page.evaluate(() => JSON.stringify(state).length);
  assert.ok(after < before / 2, `o estado ficou bem menor: ${before} -> ${after}`);
  const refs = await A.page.evaluate(() => ({
    legal: state.legalMaterials[0].content,
    caseHtml: state.cases.STJ[0].summary,
    source: state.sources[0].content,
  }));
  assert.ok(/^ymimg:img_d[0-9a-f]{24}$/.test(refs.legal), "material de imagem vira referência: " + refs.legal);
  assert.strictEqual((refs.caseHtml.match(/data-img-id="img_d[0-9a-f]{24}"/g) || []).length, 2, "jurisprudência guarda só os ids: " + refs.caseHtml);
  assert.ok(!/ src=/.test(refs.caseHtml) && /data-img-id/.test(refs.source));
  assert.strictEqual(refs.legal.slice(6), (/data-img-id="([\w-]+)"[^>]*alt="b"/.exec(refs.caseHtml) || [])[1], "a mesma imagem usa o mesmo id nos dois lugares");
  await settled(A);
  assert.ok(!JSON.stringify(fake.savedState(EMAIL)).includes("data:image/"), "a conta também não guarda mais base64");

  // backup em arquivo leva as imagens junto
  const exported = await A.page.evaluate(async () => Object.keys(await erroPrintsExport(state)).length);
  assert.strictEqual(exported, 3, "backup inclui as 3 imagens");

  // o outro aparelho recebe só a referência e busca a imagem na nuvem
  await B.page.fill("#profileName", EMAIL);
  await B.page.fill("#profilePin", PASSWORD);
  await B.page.click("#profileAccessBtn");
  await settled(B);
  const downloadsBefore = fake.stats.downloads || 0;
  await B.page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "testHost";
    host.style.cssText = "position:fixed;top:0;left:0;z-index:99999;background:#fff;max-width:300px"; // à vista, para o carregamento sob demanda disparar
    host.innerHTML = renderLegalMaterialImage(state.legalMaterials[0]) + sanitizeNoteHTML(state.cases.STJ[0].summary);
    document.body.append(host);
  });
  await B.page.waitForFunction(() => [...document.querySelectorAll("#testHost img")].length === 3 && [...document.querySelectorAll("#testHost img")].every((img) => img.src.startsWith("blob:")), null, { timeout: 10000 });
  assert.ok((fake.stats.downloads || 0) > downloadsBefore, "B baixou as imagens da conta");
  await B.page.evaluate(() => document.getElementById("testHost").remove());

  // imagem nova: vai direto para o IndexedDB/nuvem, sem base64 no estado
  const made = await A.page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    window.__file = new File([blob], "nova.png", { type: "image/png" });
    const html = await documentImageHTML(window.__file);
    const id = /data-img-id="([\w-]+)"/.exec(html)?.[1] || "";
    return { html, id, size: id ? (await erroImgGet(id))?.size || 0 : 0 };
  });
  assert.ok(made.id && made.size > 0 && !/ src=/.test(made.html), "imagem colada vira <img data-img-id>: " + made.html);

  await A.page.evaluate(async () => {
    await setLegalMaterialImageFromFile(window.__file);
    document.querySelector("#legalMaterialTitle").value = "Quadro novo";
    document.querySelector("#legalMaterialForm").requestSubmit();
  });
  const added = await A.page.evaluate(() => state.legalMaterials.find((item) => item.title === "Quadro novo"));
  assert.ok(added && /^ymimg:img_/.test(added.content), "material novo guarda só a referência: " + (added && added.content));
  assert.ok(!(await hasInline(A)));
  await settled(A);
  await A.page.evaluate(() => erroCloudKick(100));
  await until(() => fake.storage.size === 4, "imagem nova na nuvem");

  // excluir o material solta a imagem (aparelho e nuvem); a que ainda é usada em outro lugar fica
  await A.page.evaluate((id) => handleAction({ dataset: { action: "deleteLegalMaterial", id } }), added.id);
  await until(() => fake.storage.size === 3, "imagem do material excluído saiu da nuvem");
  await A.page.evaluate(() => handleAction({ dataset: { action: "deleteLegalMaterial", id: "lm1" } }));
  await idle(A);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.strictEqual(fake.storage.size, 3, "a imagem do lm1 continua porque a jurisprudência ainda a usa");

  const errors = [...A.errors, ...B.errors];
  assert.strictEqual(errors.length, 0, "erros de JS: " + errors.join(" | "));
  console.log("ERROS JS: nenhum");
  console.log("E2E IMAGENS OK");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
