const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({ console, JSON, Date, Intl });
["merge.js", "mesclar.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f }));
const { mesclarTopicInto, mesclarSubjectInto, mesclarPlan, mesclarCountRefs, mesclarSuggest } = ctx;

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
const json = (v) => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

function makeState() {
  return {
    ui: { view: "hoje", flashcardReviewTopicId: "t1", caseSubjectFilter: "s1", legalMaterialTopicFilter: "outro" },
    subjects: [{ id: "s1", name: "Direito Penal" }, { id: "s2", name: "Língua Portuguesa" }],
    topics: [
      { id: "t1", subjectId: "s1", name: "Habeas-corpus" },
      { id: "t2", subjectId: "s1", name: "Habeas corpus" },
      { id: "t3", subjectId: "s2", name: "Crase" },
      { id: "t4", subjectId: "s1", name: "Crase" },
      { id: "t5", subjectId: "s1", name: "Ortografia" },
    ],
    studyLogs: [
      { id: "L1", subjectId: "s1", topicId: "t1", minutes: 30 },
      { id: "L2", subjectId: "s1", topicId: "t2", minutes: 20 },
      { id: "L3", subjectId: "s1", topicId: "", minutes: 10 },
      { id: "L4", subjectId: "s2", topicId: "t3", minutes: 15 },
    ],
    questionLogs: [{ id: "Q1", topicId: "t1", correct: 3, wrong: 1 }, { id: "Q2", subjectId: "s1", topicId: "t4", correct: 1, wrong: 1 }],
    flashcards: [{ id: "F1", subjectId: "s1", topicId: "t1" }],
    notes: [{ id: "N1", subjectId: "s1" }],
    sources: [],
    goals: [{ id: "G1", subjectId: "s1" }],
    legalMaterials: [{ id: "M1", subjectId: "s1", topicId: "t1" }],
    errorNotebook: [{ id: "E1", subjectId: "s1", topicId: "t1" }],
    revisions: [
      { id: "R1", kind: "study", subjectId: "s1", topicId: "t1", originKey: "study:t1:2026-11-10", status: "pending", history: [{ date: "d" }, { date: "e" }] },
      { id: "R2", kind: "study", subjectId: "s1", topicId: "t2", originKey: "study:t2:2026-11-10", status: "pending", history: [] },
      { id: "R3", kind: "weak", subjectId: "s1", topicId: "t1", originKey: "weak:t1:2026-11-12", status: "pending", history: [] },
      { id: "R4", kind: "study", subjectId: "s1", topicId: "", originKey: "study:s1:2026-11-11", status: "pending", history: [] },
      { id: "R5", kind: "manual", subjectId: "s1", topicId: "t1", originKey: "manual:t1", status: "pending", history: [] },
    ],
    lawPlans: [{ id: "P1", subjectId: "s1" }],
    cases: { STJ: [{ id: "C1", subjectId: "s1", topicId: "t1" }], STF: [] },
    competitions: [{ id: "K1", subjectIds: ["s1", "s2"] }],
    cycleSettings: { weights: { s1: 6, s2: 2 } },
  };
}

/** Nenhum item pode apontar para um id que deixou de existir. */
function danglingRefs(state, goneSubject, goneTopic) {
  const found = [];
  const lists = { studyLogs: state.studyLogs, questionLogs: state.questionLogs, flashcards: state.flashcards, notes: state.notes, goals: state.goals, legalMaterials: state.legalMaterials, errorNotebook: state.errorNotebook, revisions: state.revisions, lawPlans: state.lawPlans, "cases.STJ": state.cases.STJ, competitions: state.competitions };
  Object.entries(lists).forEach(([key, list]) => list.forEach((i) => {
    if (goneSubject && (i.subjectId === goneSubject || (i.subjectIds || []).includes(goneSubject))) found.push(`${key}:${i.id}:subject`);
    if (goneTopic && i.topicId === goneTopic) found.push(`${key}:${i.id}:topic`);
  }));
  return found;
}

test("assunto: tudo que apontava para a origem passa a apontar para o destino", () => {
  const s = makeState();
  const result = mesclarTopicInto(s, "t1", "t2");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(s.topics.some((t) => t.id === "t1"), false, "a origem deixa de existir");
  assert.strictEqual(json(danglingRefs(s, null, "t1")), "[]");
  assert.strictEqual(s.studyLogs[0].topicId, "t2");
  assert.strictEqual(s.questionLogs[0].topicId, "t2");
  assert.strictEqual(s.questionLogs[0].subjectId, "s1", "completa a matéria que faltava");
  assert.strictEqual(s.flashcards[0].topicId, "t2");
  assert.strictEqual(s.errorNotebook[0].topicId, "t2");
  assert.strictEqual(s.legalMaterials[0].topicId, "t2");
  assert.strictEqual(s.cases.STJ[0].topicId, "t2");
  assert.strictEqual(result.moved, 9, "L1, Q1, F1, M1, E1, C1 e as revisões R1, R3 e R5");
});

test("assunto: o número de itens movidos é exatamente o de itens que mudaram de assunto", () => {
  const s = makeState();
  const before = makeState();
  const result = mesclarTopicInto(s, "t1", "t2");
  const pairs = [
    ["studyLogs", s.studyLogs, before.studyLogs],
    ["questionLogs", s.questionLogs, before.questionLogs],
    ["flashcards", s.flashcards, before.flashcards],
    ["legalMaterials", s.legalMaterials, before.legalMaterials],
    ["errorNotebook", s.errorNotebook, before.errorNotebook],
    ["cases.STJ", s.cases.STJ, before.cases.STJ],
    ["revisions", s.revisions, before.revisions],
  ];
  let changed = 0;
  pairs.forEach(([, after, prior]) => {
    after.forEach((item) => {
      const old = prior.find((candidate) => candidate.id === item.id);
      if (old && old.topicId !== item.topicId) changed += 1;
    });
  });
  assert.strictEqual(changed, 9);
  assert.strictEqual(result.moved, changed);
});

test("assunto: chaves das revisões automáticas são remapeadas e as duplicadas resolvidas pela que mais avançou", () => {
  const s = makeState();
  s.revisions.push({ id: "R6", kind: "study", subjectId: "s1", topicId: "t2", originKey: "study:t2:2026-11-10", status: "pending", history: [] });
  mesclarTopicInto(s, "t1", "t2");
  const keys = s.revisions.map((r) => r.originKey);
  assert.strictEqual(new Set(keys).size, keys.length, "nenhuma chave repetida");
  const kept = s.revisions.find((r) => r.originKey === "study:t2:2026-11-10");
  assert.strictEqual(kept.id, "R1", "ficou a revisão com mais histórico");
  assert.strictEqual(kept.history.length, 2);
  assert.strictEqual(s.revisions.some((r) => r.id === "R2" || r.id === "R6"), false, "as sem progresso saíram");
  assert.strictEqual(s.revisions.find((r) => r.id === "R3").originKey, "weak:t2:2026-11-12");
  assert.strictEqual(s.revisions.find((r) => r.id === "R5").originKey, "manual:t1", "chave manual não tem id de assunto e não muda");
  assert.strictEqual(s.revisions.find((r) => r.id === "R4").originKey, "study:s1:2026-11-11", "chave por matéria não muda");
});

test("assunto de outra matéria: os itens passam também para a matéria do destino", () => {
  const s = makeState();
  mesclarTopicInto(s, "t1", "t3");
  assert.strictEqual(s.studyLogs[0].subjectId, "s2");
  assert.strictEqual(s.studyLogs[0].topicId, "t3");
  assert.strictEqual(s.revisions.find((r) => r.id === "R1").subjectId, "s2");
});

test("assunto: ids da interface apontando para a origem são ajustados e o desfazer devolve", () => {
  const s = makeState();
  const result = mesclarTopicInto(s, "t1", "t2");
  assert.strictEqual(s.ui.flashcardReviewTopicId, "t2");
  assert.strictEqual(s.ui.legalMaterialTopicFilter, "outro", "outros ids não mudam");
  result.undo(s);
  assert.strictEqual(s.ui.flashcardReviewTopicId, "t1");
});

test("desfazer devolve só o que a mesclagem mudou e preserva o que veio depois", () => {
  const s = makeState();
  const original = makeState();
  const result = mesclarTopicInto(s, "t1", "t2");
  // depois da mesclagem: novo registro e uma edição
  s.studyLogs.push({ id: "L9", subjectId: "s1", topicId: "t2", minutes: 45 });
  s.studyLogs.find((l) => l.id === "L4").minutes = 99;
  const restored = result.undo(s);
  assert.ok(restored > 8);
  assert.strictEqual(s.topics.some((t) => t.id === "t1"), true, "a origem volta");
  assert.strictEqual(s.studyLogs.find((l) => l.id === "L1").topicId, "t1");
  assert.strictEqual(s.revisions.find((r) => r.id === "R1").originKey, "study:t1:2026-11-10");
  assert.strictEqual(s.revisions.some((r) => r.id === "R2"), true, "revisão removida por colisão volta");
  assert.strictEqual(s.studyLogs.some((l) => l.id === "L9" && l.topicId === "t2"), true, "o que foi feito depois fica");
  assert.strictEqual(s.studyLogs.find((l) => l.id === "L4").minutes, 99, "edição posterior fica");
  assert.strictEqual(json(s.questionLogs[0]), json(original.questionLogs[0]), "campo que não existia volta a não existir");
  assert.strictEqual("subjectId" in s.questionLogs[0], false);
});

test("matéria: une assuntos de mesmo nome, reatribui os outros e move tudo", () => {
  const s = makeState();
  const result = mesclarSubjectInto(s, "s1", "s2");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.unified, 1, "Crase de Penal se une à Crase de Português");
  assert.strictEqual(s.subjects.some((x) => x.id === "s1"), false);
  assert.strictEqual(s.topics.find((t) => t.id === "t5").subjectId, "s2", "Ortografia passa para a nova matéria");
  assert.strictEqual(s.topics.some((t) => t.id === "t4"), false, "a Crase duplicada foi unida");
  assert.strictEqual(json(danglingRefs(s, "s1", "t4")), "[]");
  assert.strictEqual(s.studyLogs.find((l) => l.id === "L3").subjectId, "s2");
  assert.strictEqual(s.questionLogs.find((q) => q.id === "Q2").topicId, "t3", "questões da Crase duplicada vão para a Crase existente");
  assert.strictEqual(s.lawPlans[0].subjectId, "s2");
  assert.strictEqual(s.notes[0].subjectId, "s2");
  assert.strictEqual(json(s.competitions[0].subjectIds), json(["s2"]), "lista de matérias do concurso sem duplicar");
  assert.strictEqual(s.revisions.find((r) => r.id === "R4").originKey, "study:s2:2026-11-11");
  assert.strictEqual(s.ui.caseSubjectFilter, "s2");
});

test("matéria: assuntos parecidos entre si dentro da origem não são unidos sem aviso", () => {
  const s = makeState(); // origem tem "Habeas-corpus" e "Habeas corpus"
  const result = mesclarSubjectInto(s, "s1", "s2");
  assert.strictEqual(result.unified, 1, "só a Crase tinha gêmeo no destino");
  assert.strictEqual(s.topics.some((topic) => topic.id === "t1"), true);
  assert.strictEqual(s.topics.some((topic) => topic.id === "t2"), true);
  assert.strictEqual(mesclarPlan(makeState(), "subject", "s1", "s2").unified, result.unified, "a prévia coincide com o resultado");
});

test("matéria: o peso do plano semanal não se perde", () => {
  const s = makeState();
  s.cycleSettings.weights = { s1: 6 };
  mesclarSubjectInto(s, "s1", "s2");
  assert.strictEqual(json(s.cycleSettings.weights), json({ s2: 6 }), "sem peso próprio, o destino herda");
  const t = makeState();
  mesclarSubjectInto(t, "s1", "s2");
  assert.strictEqual(json(t.cycleSettings.weights), json({ s2: 2 }), "com peso próprio, o destino mantém o seu");
});

test("matéria: desfazer restaura matéria, assuntos, pesos e filtros", () => {
  const s = makeState();
  const original = makeState();
  const result = mesclarSubjectInto(s, "s1", "s2");
  s.studyLogs.push({ id: "L9", subjectId: "s2", topicId: "t5", minutes: 5 });
  result.undo(s);
  assert.strictEqual(s.subjects.some((x) => x.id === "s1"), true);
  assert.strictEqual(s.topics.some((t) => t.id === "t4"), true, "assunto unido volta");
  assert.strictEqual(s.topics.find((t) => t.id === "t5").subjectId, "s1");
  assert.strictEqual(s.studyLogs.find((l) => l.id === "L3").subjectId, "s1");
  assert.deepStrictEqual({ ...s.cycleSettings.weights }, { ...original.cycleSettings.weights }, "pesos de volta (a ordem das chaves não importa)");
  assert.strictEqual(s.ui.caseSubjectFilter, "s1");
  assert.strictEqual(json(s.competitions[0].subjectIds), json(["s1", "s2"]));
  assert.strictEqual(s.revisions.find((r) => r.id === "R4").originKey, "study:s1:2026-11-11");
  assert.strictEqual(s.studyLogs.some((l) => l.id === "L9"), true);
});

test("pedidos inválidos não alteram nada", () => {
  const s = makeState();
  const before = json(s);
  assert.strictEqual(mesclarTopicInto(s, "t1", "t1").ok, false);
  assert.strictEqual(mesclarTopicInto(s, "t1", "x").ok, false);
  assert.strictEqual(mesclarSubjectInto(s, "s1", "s1").ok, false);
  assert.strictEqual(mesclarSubjectInto(s, "zz", "s2").ok, false);
  assert.strictEqual(json(s), before);
});

test("prévia: conta o que será movido sem alterar o estado", () => {
  const s = makeState();
  const before = json(s);
  const topic = mesclarPlan(s, "topic", "t1", "t2");
  const map = Object.fromEntries(topic.refs.map((r) => [r.key, r.count]));
  assert.strictEqual(map.studyLogs, 1);
  assert.strictEqual(map.revisions, 3);
  assert.strictEqual(topic.refs.find((r) => r.key === "studyLogs").text, "1 registro de estudo");
  const subject = mesclarPlan(s, "subject", "s1", "s2");
  assert.strictEqual(subject.unified, 1);
  assert.strictEqual(subject.reassigned, 3);
  assert.ok(mesclarCountRefs(s, { subjectId: "s1" }).find((r) => r.key === "studyLogs").count >= 3);
  assert.strictEqual(json(s), before);
});

test("sugestão: mesma matéria e nome parecido; nada quando não há parecido", () => {
  const options = [
    { id: "a", name: "Crase", subjectId: "s2" },
    { id: "b", name: "Habeas corpus", subjectId: "s1" },
    { id: "c", name: "Prisão preventiva", subjectId: "s1" },
  ];
  assert.strictEqual(mesclarSuggest(options, "Habeas-corpus", "s1").id, "b");
  assert.strictEqual(mesclarSuggest(options, "Xyz", "s1"), null);
  assert.strictEqual(mesclarSuggest(options, "Cra", "s2"), null, "prefixo curto demais não sugere");
});

test("com as lápides do merge.js: a exclusão da origem é registrada e o desfazer a revive", () => {
  const m = ctx;
  const s = makeState();
  s.meta = { tombstones: {}, revivals: {} };
  m.mergeAttachIds(s);
  const result = mesclarTopicInto(s, "t1", "t2");
  s.__ids = m.mergeRecordDeletions(s, s.__ids, "2026-11-16T10:00:00.000Z");
  assert.ok(s.meta.tombstones.topics.t1, "origem virou lápide");
  assert.ok(s.meta.tombstones.revisions.R2, "a revisão duplicada removida também vira lápide");
  result.undo(s);
  s.__ids = m.mergeRecordDeletions(s, s.__ids, "2026-11-16T11:00:00.000Z");
  assert.strictEqual(s.meta.revivals.topics.t1, "2026-11-16T11:00:00.000Z", "voltou: marcado como revivido");
  const other = clone(makeState());
  other.meta = { tombstones: clone(s.meta.tombstones), revivals: clone(s.meta.revivals) };
  const merged = m.mergeStates(clone(s), other);
  assert.strictEqual(merged.topics.some((t) => t.id === "t1"), true, "outro aparelho não derruba o assunto restaurado");
});

console.log(`mesclar-tests: ${passed} testes passaram.`);
