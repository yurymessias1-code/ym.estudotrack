const { launchBrowser } = require("./helpers");
const assert = require("assert");
const fs = require("fs");
const BASE = process.env.BASE_URL;
const shots = "";
const today = () => new Date().toLocaleDateString("sv"); // AAAA-MM-DD local

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ["notifications"], acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  // Headless não concede permissão real a notificações (o caminho do service worker é recusado e o app
  // cai para `new Notification`). Substituímos Notification por um gravador para verificar o que o app dispara.
  await context.addInitScript(() => {
    window.__notifs = [];
    class FakeNotification {
      constructor(title, options) { window.__notifs.push({ title, body: options && options.body, tag: options && options.tag }); }
      close() {}
      static get permission() { return "granted"; }
      static requestPermission() { return Promise.resolve("granted"); }
    }
    window.Notification = FakeNotification;
  });
  await context.route("**/supabase-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/cdn\.jsdelivr|unpkg|cdnjs/, (r) => r.abort());
  await page.goto(BASE);

  await page.fill("#profileName", "lembretes");
  await page.fill("#profilePin", "4321");
  await page.click("#profileSignupBtn");
  await page.waitForTimeout(400);

  // service worker + manifest
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => !!r), null, { timeout: 8000 });
  assert.strictEqual(await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href")), "manifest.json");
  const manifestOk = await page.evaluate(() => fetch("manifest.json").then((r) => r.json()).then((m) => m.display));
  assert.strictEqual(manifestOk, "standalone");
  console.log("service worker registrado e manifest ok");

  // dados: 1 matéria, 1 assunto, estudo de hoje (gera revisão), vencida hoje
  await page.evaluate(() => {
    const s = { id: "s1", name: "Direito Penal", color: "#0f766e", goalHours: 5 };
    state.subjects.push(s);
    state.topics.push({ id: "t1", subjectId: "s1", name: "Teoria do crime", priority: "Alta", total: 0, correct: 0, wrong: 0 });
    state.studyLogs.push({ id: "l1", subjectId: "s1", topicId: "t1", minutes: 40, date: new Date().toLocaleDateString("sv"), source: "Manual" });
    saveState(); render();
  });
  const created = await page.evaluate(() => state.revisions.length);
  assert.strictEqual(created, 1, "estudo deveria gerar 1 cadeia de revisão");
  // vence hoje
  await page.evaluate(() => { state.revisions[0].dueDate = new Date().toLocaleDateString("sv"); saveState(); render(); });

  // banner + selo no título (o banner não aparece em Hoje, que já lista as pendências)
  assert(!(await page.isVisible("#reviewBanner")), "banner não deve duplicar a tela Hoje");
  await page.click('.nav-button[data-view="dashboard"]');
  await page.waitForTimeout(200);
  assert(await page.isVisible("#reviewBanner"), "banner deveria aparecer no painel");
  const bannerText = await page.textContent("#reviewBanner");
  assert(bannerText.includes("1 revisão"), "texto do banner: " + bannerText);
  assert.strictEqual(await page.title(), "(1) estudos track");
  await page.screenshot({ path: shots + "banner.png" });
  console.log("banner e selo ok:", await page.title());

  // 'Revisar agora' abre a sessão e some o banner
  await page.click('[data-cycle-action="reviewNow"]');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.ui.view === "revisao"));
  assert(!(await page.isVisible("#reviewBanner")), "banner deve sumir na aba Revisão");
  assert((await page.textContent("#revisionSession")).includes("Teoria do crime"), "sessão não abriu o assunto");

  // trilha de fixação
  const trail = await page.textContent("#revisionTrail");
  assert(trail.includes("Teoria do crime") && trail.includes("hoje"), "trilha: " + trail);
  assert((await page.textContent("#revisionTrailLegend")).includes("Aprendizado → R1 (1d)"));
  await page.screenshot({ path: shots + "trilha-lembretes.png", fullPage: true });

  // redistribuir atrasadas: 7 atrasadas, limite 3
  await page.evaluate(() => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - (10 - i));
      state.revisions.push(normalizeRevision({ kind: "manual", subjectId: "s1", topicId: "t1", originKey: "m" + i, baseDate: d.toLocaleDateString("sv"), dueDate: d.toLocaleDateString("sv") }));
    }
    state.cycleSettings.dailyLimit = 3; saveState(); render();
  });
  await page.click('[data-cycle-action="redistributeOverdue"]');
  await page.waitForTimeout(300);
  const dist = await page.evaluate(() => {
    const per = {}; state.revisions.filter((r) => r.status === "pending").forEach((r) => (per[r.dueDate] = (per[r.dueDate] || 0) + 1));
    return { per, overdue: state.revisions.filter((r) => r.status === "pending" && r.dueDate < new Date().toLocaleDateString("sv")).length };
  });
  console.log("redistribuição:", JSON.stringify(dist));
  assert.strictEqual(dist.overdue, 0, "ainda há atrasadas");
  Object.values(dist.per).forEach((n) => assert(n <= 3, "dia acima do limite: " + n));

  // exportar .ics (download real)
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-cycle-action="exportIcs"]')]);
  const icsPath = "/home/claude/e2e/agenda.ics";
  await download.saveAs(icsPath);
  const ics = fs.readFileSync(icsPath, "utf8");
  console.log("arquivo:", download.suggestedFilename(), "| eventos:", (ics.match(/BEGIN:VEVENT/g) || []).length);
  assert(/^BEGIN:VCALENDAR\r\n/.test(ics) && ics.includes("Teoria do crime") && ics.includes("BEGIN:VALARM"));
  assert(ics.includes("revisão prevista") || ics.includes("revisões previstas"), "a agenda deve incluir as etapas futuras previstas");
  assert(ics.includes("Revisões previstas (se você acertar as anteriores)"), "seção das previstas na descrição");
  const dates = [...ics.matchAll(/DTSTART:(\d{8})T/g)].map((m) => m[1]);
  assert(new Set(dates).size >= 3, "eventos em vários dias futuros: " + dates.join(","));
  assert(download.suggestedFilename().endsWith(".ics"));

  // notificações: ativar pela interface, horário 00:00 e reabrir o site
  await page.click("#notifyToggleBtn");
  await page.waitForTimeout(300);
  assert((await page.textContent("#reminderStatus")).includes("ativas"), await page.textContent("#reminderStatus"));
  await page.fill("#reminderTime", "00:00");
  await page.click('#reminderForm button[type="submit"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + "lembretes-painel.png", fullPage: true });
  // simula 'novo dia': esquece o último aviso
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("ymEstudos.cycleNotify.")); const v = JSON.parse(localStorage.getItem(k)); v.last = {}; localStorage.setItem(k, JSON.stringify(v)); });
  await page.reload();
  await page.fill("#profileName", "lembretes");
  await page.fill("#profilePin", "4321");
  await page.click("#profileAccessBtn");
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(() => window.__notifs);
  console.log("notificações disparadas:", JSON.stringify(shown));
  assert.strictEqual(shown.length, 1, "deveria haver exatamente 1 notificação");
  assert(shown[0].body.includes("revisões") && shown[0].title.length > 0);

  // não repete no mesmo dia: forçar novo render/tick
  await page.evaluate(() => { render(); cycleReminderTick(); });
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => window.__notifs.length), 1, "não deveria renotificar no mesmo dia");

  // desativar notificações
  await page.click('.nav-button[data-view="revisao"]');
  await page.click("#notifyToggleBtn");
  await page.waitForTimeout(200);
  assert((await page.textContent("#reminderStatus")).includes("desativadas"));

  // dispensar banner, e voltar a mostrar só após recarregar
  await page.click('.nav-button[data-view="dashboard"]');
  if (await page.isVisible("#reviewBanner")) { await page.click('[data-cycle-action="dismissBanner"]'); assert(!(await page.isVisible("#reviewBanner"))); }

  // mobile: banner empilha sem overflow
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { cycleUI.bannerHidden = false; render(); });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("overflow mobile (px):", overflow);
  assert.strictEqual(overflow, 0);
  await page.screenshot({ path: shots + "banner-mobile.png" });

  console.log("ERROS JS:", errors.length ? errors : "nenhum");
  assert.strictEqual(errors.length, 0);
  await browser.close();
  console.log("E2E 2 OK");
})().catch((e) => { console.error("E2E 2 FALHOU:", e.message); process.exit(1); });
