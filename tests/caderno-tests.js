// Lógica pura do caderno de erros: menu por matéria/assunto, filtros, agrupamento e redução de prints.
const assert = require("assert");
const path = require("path");
const { buildErrorNav, groupErrorsByScope, erroEntryScope, erroScopeMatches, erroMaps, erroImgFit } = require(path.resolve(__dirname, "..", "caderno.js"));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FALHOU: ${name}`);
    throw error;
  }
}

const subjects = [
  { id: "s1", name: "Direito Constitucional", color: "#0f766e" },
  { id: "s2", name: "Português", color: "#2563eb" },
  { id: "s3", name: "Informática", color: "#a16207" },
];
const topics = [
  { id: "t1", subjectId: "s1", name: "Direitos fundamentais" },
  { id: "t2", subjectId: "s1", name: "Poder Legislativo" },
  { id: "t3", subjectId: "s2", name: "Crase" },
  { id: "t4", subjectId: "s2", name: "Concordância" },
];
const TODAY = "2026-11-23";
const entry = (id, subjectId, topicId, extra = {}) => ({ id, subjectId, topicId, mastered: false, dueDate: "2026-12-01", ...extra });
const entries = [
  entry("e1", "s1", "t1", { dueDate: "2026-11-22" }), // vencido
  entry("e2", "s1", "t1"),
  entry("e3", "s1", "t2"),
  entry("e4", "s1", ""), // matéria sem assunto
  entry("e5", "s2", "t3", { dueDate: "2026-11-23" }), // vence hoje
  entry("e6", "", "t4"), // só o assunto: a matéria vem dele
  entry("e7", "s1", "t1", { mastered: true, dueDate: "" }), // dominado nunca conta como vencido
];

test("escopo: matéria vem do assunto quando o erro não tem subjectId", () => {
  const maps = erroMaps(subjects, topics);
  assert.deepStrictEqual(erroEntryScope(entries[5], maps), { subjectId: "s2", topicId: "t4" });
});

test("escopo: vínculo com matéria/assunto apagado vira 'sem matéria' / 'sem assunto'", () => {
  const maps = erroMaps(subjects, topics);
  assert.deepStrictEqual(erroEntryScope(entry("x", "apagada", "t1"), maps), { subjectId: "", topicId: "" });
  assert.deepStrictEqual(erroEntryScope(entry("y", "s1", "assunto-apagado"), maps), { subjectId: "s1", topicId: "" });
  assert.deepStrictEqual(erroEntryScope(entry("z", "s2", "t1"), maps), { subjectId: "s2", topicId: "" }, "assunto de outra matéria não vale");
});

test("menu: contagens por matéria e assunto, com vencidos", () => {
  const nav = buildErrorNav(entries, subjects, topics, TODAY);
  assert.strictEqual(nav.total, 7);
  assert.strictEqual(nav.due, 2);
  assert.deepStrictEqual(nav.subjects.map((s) => [s.name, s.total, s.due]), [["Direito Constitucional", 5, 1], ["Português", 2, 1]]);
  const dc = nav.subjects[0];
  assert.deepStrictEqual(dc.topics.map((t) => [t.name, t.total, t.due]), [["Direitos fundamentais", 3, 1], ["Poder Legislativo", 1, 0]]);
  assert.strictEqual(dc.noTopic.total, 1);
  assert.strictEqual(nav.orphan, null);
});

test("menu: matérias e assuntos sem erro não aparecem, a não ser o selecionado", () => {
  const nav = buildErrorNav(entries, subjects, topics, TODAY);
  assert(!nav.subjects.some((s) => s.id === "s3"));
  const kept = buildErrorNav(entries, subjects, topics, TODAY, { subject: "s3" });
  assert.deepStrictEqual(kept.subjects.map((s) => [s.id, s.total]).pop(), ["s3", 0]);
});

test("menu: erros sem matéria entram em 'orphan'", () => {
  const nav = buildErrorNav([entry("o", "", "")], subjects, topics, TODAY);
  assert.strictEqual(nav.orphan.total, 1);
  assert.strictEqual(nav.subjects.length, 0);
});

test("filtro por matéria e assunto, com 'none'", () => {
  const maps = erroMaps(subjects, topics);
  const pick = (filters) => entries.filter((e) => erroScopeMatches(erroEntryScope(e, maps), filters)).map((e) => e.id).join(",");
  assert.strictEqual(pick({ subject: "", topic: "" }), "e1,e2,e3,e4,e5,e6,e7");
  assert.strictEqual(pick({ subject: "s1" }), "e1,e2,e3,e4,e7");
  assert.strictEqual(pick({ subject: "s1", topic: "t1" }), "e1,e2,e7");
  assert.strictEqual(pick({ subject: "s1", topic: "none" }), "e4");
  assert.strictEqual(pick({ subject: "s2" }), "e5,e6");
  assert.strictEqual(pick({ subject: "none" }), "");
});

test("agrupamento: por matéria sem filtro, por assunto com matéria escolhida", () => {
  const byDisc = groupErrorsByScope(entries, subjects, topics, {});
  assert.deepStrictEqual(byDisc.map((g) => [g.title, g.items.length]), [["Direito Constitucional", 5], ["Português", 2]]);
  const dcOnly = entries.filter((e) => e.subjectId === "s1");
  const byTopic = groupErrorsByScope(dcOnly, subjects, topics, { subject: "s1" });
  assert.deepStrictEqual(byTopic.map((g) => [g.title, g.items.length]), [["Direitos fundamentais", 3], ["Poder Legislativo", 1], ["Sem assunto específico", 1]]);
  const single = groupErrorsByScope(dcOnly.slice(0, 1), subjects, topics, { subject: "s1", topic: "t1" });
  assert.deepStrictEqual(single.map((g) => [g.title, g.items.length]), [["", 1]]);
});

test("agrupamento não perde nem duplica erros", () => {
  const groups = groupErrorsByScope([...entries, entry("o", "", "")], subjects, topics, {});
  const ids = groups.flatMap((g) => g.items.map((e) => e.id)).sort();
  assert.deepStrictEqual(ids, ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "o"]);
  assert.strictEqual(groups[groups.length - 1].title, "Sem matéria");
});

test("redução de prints: mantém proporção e nunca amplia", () => {
  assert.deepStrictEqual(erroImgFit(3200, 1600, 1600), { width: 1600, height: 800 });
  assert.deepStrictEqual(erroImgFit(900, 2400, 1600), { width: 600, height: 1600 });
  assert.deepStrictEqual(erroImgFit(800, 600, 1600), { width: 800, height: 600 });
  assert.deepStrictEqual(erroImgFit(0, 0, 1600), { width: 1, height: 1 });
});

console.log(`caderno-tests: ${passed} testes passaram.`);

// ---- anotações livres (caderno) ----
{
  const assertEq = require("assert");
  const { erroNotesSanitize, erroNotesText, erroNotesImageIds } = require("../caderno.js");
  assertEq.strictEqual(erroNotesText("<p>Olá <b>mundo</b></p><br>Linha 2 &amp; 3"), "Olá mundo Linha 2 & 3");
  assertEq.deepStrictEqual(erroNotesImageIds('<p>x</p><img data-img-id="img_a1"><img data-img-id="img_b2">'), ["img_a1", "img_b2"]);
  // sem DOMParser (Node): cai para texto escapado, sem tags nem scripts
  const out = erroNotesSanitize('<script>alert(1)</script><b onclick="x()">oi</b>');
  assertEq(!/<script|onclick|<b/i.test(out), "não pode sobrar tag/atributo perigoso: " + out);
  assertEq.strictEqual(erroNotesSanitize("   "), "");
  console.log("caderno-tests (anotações): ok");
}

// ---- prints na nuvem: funções puras ----
{
  const assertEq = require("assert");
  const { erroAllPrintIds, erroDataURLToBlob } = require("../caderno.js");
  const ids = erroAllPrintIds({
    errorNotebook: [
      { images: [{ id: "img_a" }], answerImages: [{ id: "img_b" }, { id: "img_a" }], notes: '<p>x</p><img data-img-id="img_c">' },
      { images: [], answerImages: [], notes: "" },
      { notes: '<img data-img-id="img_d">' },
    ],
  });
  assertEq.deepStrictEqual(ids.sort(), ["img_a", "img_b", "img_c", "img_d"], "ids únicos de todos os campos");
  assertEq.deepStrictEqual(erroAllPrintIds(null), []);
  const blob = erroDataURLToBlob("data:image/webp;base64,AAEC");
  assertEq.strictEqual(blob.type, "image/webp");
  assertEq.strictEqual(blob.size, 3);
  assertEq.strictEqual(erroDataURLToBlob("não é data url"), null);
  console.log("caderno-tests (nuvem): ok");
}

// ---- imagens dos documentos (jurisprudências, leis/tabelas, anotações): funções puras ----
{
  const assertEq = require("assert");
  const { erroAllPrintIds, docImgIdsInText, docImgCollectIds, docImgIdsOf, docImgFindInline } = require("../caderno.js");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  assertEq.deepStrictEqual(docImgIdsInText('<p>a</p><img data-img-id="img_1" alt="x"><img data-img-id="img_2">'), ["img_1", "img_2"]);
  assertEq.deepStrictEqual(docImgIdsInText("ymimg:img_9"), ["img_9"]);
  assertEq.deepStrictEqual(docImgIdsInText("texto qualquer ymimg:img_9"), [], "só vale se o texto todo for a referência");
  assertEq.deepStrictEqual(docImgIdsInText("ymimg:../etc"), [], "ids com caracteres fora do padrão são descartados");

  const state = {
    meta: { x: '<img data-img-id="img_meta">' },
    ui: { draft: '<img data-img-id="img_ui">' },
    legalMaterials: [{ id: "l1", type: "image", content: "ymimg:img_legal" }, { id: "l2", type: "law", content: '<p>t</p><img data-img-id="img_lei">' }],
    cases: { STJ: [{ id: "c1", summary: '<img data-img-id="img_caso"><img data-img-id="img_caso">' }], STF: [] },
    errorNotebook: [{ images: [{ id: "img_print" }], answerImages: [], notes: "" }],
    notes: [{ id: "n1", content: "sem imagem" }],
  };
  assertEq.deepStrictEqual([...docImgCollectIds(state, new Set())].sort(), ["img_caso", "img_legal", "img_lei"], "varre os textos do estado, menos meta e ui");
  assertEq.deepStrictEqual(erroAllPrintIds(state).sort(), ["img_caso", "img_legal", "img_lei", "img_print"], "e o sync, o backup e a exclusão passam a enxergar essas imagens");
  assertEq.deepStrictEqual(docImgIdsOf(state.legalMaterials[0]), ["img_legal"]);
  assertEq.deepStrictEqual(docImgIdsOf(undefined), []);

  const inline = {
    meta: { x: PNG },
    legalMaterials: [{ id: "l1", type: "image", content: PNG }],
    cases: { STJ: [{ id: "c1", summary: `<p>x</p><img src="${PNG}">` }], STF: [] },
    notes: [{ id: "n1", content: "nada" }],
  };
  const found = docImgFindInline(inline);
  assertEq.strictEqual(found.length, 2, "acha as imagens em base64 (menos em meta)");
  assertEq.deepStrictEqual(found.map((place) => place.owner.id).sort(), ["c1", "l1"], "e o item dono de cada uma");
  console.log("caderno-tests (imagens de documentos): ok");
}
