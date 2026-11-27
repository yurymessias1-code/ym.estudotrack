// Menu "Matérias e assuntos" (estrutura.js): contagens, filtros e limpeza de seleção.
const assert = require("assert");
const path = require("path");
const { estruturaBuildNav, estruturaScopeOk, estruturaCleanFilters, estruturaSuggest, estruturaOrganizeCandidates } = require(path.resolve(__dirname, "..", "estrutura.js"));

const subjects = [{ id: "s1", name: "Constitucional", color: "#0f766e" }, { id: "s2", name: "Administrativo" }];
const topics = [{ id: "t1", subjectId: "s1", name: "Direitos" }, { id: "t2", subjectId: "s1", name: "Poderes" }, { id: "t3", subjectId: "s2", name: "Improbidade" }];
const items = [
  { id: "a", subjectId: "s1", topicId: "t1", due: true },
  { id: "b", subjectId: "s1", topicId: "t1" },
  { id: "c", topicId: "t3" }, // matéria deduzida pelo assunto
  { id: "d", subjectId: "s1" }, // sem assunto
  { id: "e" }, // sem vínculo
  { id: "f", subjectId: "apagada", topicId: "apagado" }, // vínculos que não existem mais
];

let count = 0;
const test = (name, fn) => { fn(); count += 1; };

test("contagens por matéria, assunto e sem vínculo", () => {
  const nav = estruturaBuildNav(items, subjects, topics);
  assert.strictEqual(nav.total, 6);
  const s1 = nav.subjects.find((s) => s.id === "s1");
  assert.strictEqual(s1.total, 3);
  assert.strictEqual(s1.topics.find((t) => t.id === "t1").total, 2);
  assert.strictEqual(s1.noTopic.total, 1);
  assert.strictEqual(nav.subjects.find((s) => s.id === "s2").total, 1, "matéria deduzida pelo assunto");
  assert.strictEqual(nav.orphan.total, 2, "sem vínculo e vínculos apagados");
});

test("pendentes só contam com isDue", () => {
  assert.strictEqual(estruturaBuildNav(items, subjects, topics).due, 0);
  const nav = estruturaBuildNav(items, subjects, topics, { isDue: (item) => item.due });
  assert.strictEqual(nav.due, 1);
  assert.strictEqual(nav.subjects.find((s) => s.id === "s1").topics.find((t) => t.id === "t1").due, 1);
});

test("item selecionado fica no menu mesmo com zero", () => {
  const nav = estruturaBuildNav([], subjects, topics, { keep: { subject: "s2", topic: "t3" } });
  assert.strictEqual(nav.subjects.length, 1);
  assert.strictEqual(nav.subjects[0].topics[0].total, 0);
});

test("filtro de matéria/assunto, incluindo none", () => {
  const ok = (item, s, t) => estruturaScopeOk(item, s, t, subjects, topics);
  assert(ok(items[0], "", ""));
  assert(ok(items[0], "s1", "t1") && !ok(items[0], "s2", ""));
  assert(ok(items[2], "s2", "") && ok(items[3], "s1", "none") && !ok(items[0], "s1", "none"));
  assert(ok(items[4], "none", "") && ok(items[5], "none", "") && !ok(items[0], "none", ""));
});

test("limpa seleção que aponta para o que foi apagado", () => {
  assert.deepStrictEqual(estruturaCleanFilters({ subject: "x", topic: "t1" }, subjects, topics), { subject: "", topic: "" });
  assert.deepStrictEqual(estruturaCleanFilters({ subject: "s1", topic: "t3" }, subjects, topics), { subject: "s1", topic: "" });
  assert.deepStrictEqual(estruturaCleanFilters({ subject: "none", topic: "none" }, subjects, topics), { subject: "none", topic: "" });
  assert.deepStrictEqual(estruturaCleanFilters({ subject: "s1", topic: "t2" }, subjects, topics), { subject: "s1", topic: "t2" });
});

test("sugestão pelo texto: assunto, matéria e palavra inteira", () => {
  assert.deepStrictEqual(
    { ...estruturaSuggest("Tema 1199 STJ sobre Improbidade e dolo", subjects, topics), reason: "" },
    { subjectId: "s2", topicId: "t3", reason: "" }
  );
  const dir = estruturaSuggest("Limites dos DIREITOS fundamentais", subjects, topics);
  assert.deepStrictEqual([dir.subjectId, dir.topicId], ["s1", "t1"], "ignora maiúsculas e acentos");
});

test("sugestão pelo nome da matéria, sem o prefixo Direito", () => {
  const s = estruturaSuggest("Controle de constitucionalidade e norma constitucional", subjects, topics);
  assert.deepStrictEqual([s.subjectId, s.topicId], ["s1", ""]);
  assert.strictEqual(estruturaSuggest("texto sem pista", subjects, topics), null);
  assert.strictEqual(estruturaSuggest("improbidadeadministrativa", subjects, topics), null, "só palavra inteira");
});

test("quem já tem matéria só recebe assunto dessa matéria", () => {
  assert.strictEqual(estruturaSuggest("fala de improbidade", subjects, topics, "s1"), null, "improbidade é assunto de outra matéria");
  const keep = estruturaSuggest("sobre poderes e poder legislativo", subjects, topics, "s1");
  assert.strictEqual(keep.topicId, "t2");
});

test("candidatos a organizar: sem matéria primeiro, e matéria sem assunto", () => {
  const list = estruturaOrganizeCandidates(items, subjects, topics).map((item) => item.id);
  assert.deepStrictEqual(list.slice(0, 2).sort(), ["e", "f"], "sem vínculo e vínculos apagados primeiro");
  assert(list.includes("d"), "matéria que tem assuntos, mas o item não tem assunto");
  assert(!list.includes("a") && !list.includes("c"), "já vinculados ficam de fora");
});

console.log(`estrutura-tests: ${count} testes passaram.`);
