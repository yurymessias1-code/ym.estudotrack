const assert = require("assert");
const m = require("../merge.js");

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
const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (v) => JSON.stringify(v);
const ids = (list) => list.map((i) => i.id).sort();

function base() {
  return {
    version: 2,
    meta: { localSavedAt: "", tombstones: {}, revivals: {} },
    profile: { id: "p" },
    account: { name: "" },
    subjects: [],
    topics: [],
    questionLogs: [],
    studyLogs: [],
    flashcards: [],
    sources: [],
    notes: [],
    categories: [],
    goals: [],
    competitions: [],
    legalMaterials: [],
    revisions: [],
    errorNotebook: [],
    lawPlans: [],
    cases: { STJ: [], STF: [] },
    edital: { items: [], weeklyHours: 15, examDate: "" },
    settings: { focusMinutes: 25, cycles: 4 },
    media: { url: "" },
    flashcardSettings: { reviewCounter: 0, intervals: { hard: 4, medium: 8 } },
    cycleSettings: { weights: {}, autoSince: "2026-11-10", intervals: [1, 7] },
    ui: { view: "hoje" },
  };
}
const log = (id, extra = {}) => ({ id, minutes: 30, date: "2026-11-16", createdAt: "2026-11-16T10:00:00.000Z", ...extra });
const NOW = "2026-11-16T12:00:00.000Z";

test("registros novos de cada lado se somam; os de sempre ficam", () => {
  const a = base();
  const b = base();
  a.studyLogs = [log("L1"), log("L2")];
  b.studyLogs = [log("L1"), log("L3")];
  const { state, stats } = m.mergeStatesDetailed(a, b);
  assert.strictEqual(json(ids(state.studyLogs)), json(["L1", "L2", "L3"]));
  assert.strictEqual(stats.added, 1);
  assert.strictEqual(json(state.studyLogs.map((l) => l.id)), json(["L1", "L2", "L3"]), "ordem local primeiro, depois os de fora");
});

test("não altera as entradas originais", () => {
  const a = base();
  const b = base();
  a.studyLogs = [log("L1")];
  b.studyLogs = [log("L2")];
  const before = json([a, b]);
  m.mergeStates(a, b);
  assert.strictEqual(json([a, b]), before);
});

test("mesmo registro: a versão mais recente vence; empate fica com a local", () => {
  const a = base();
  const b = base();
  a.notes = [{ id: "n1", title: "local", updatedAt: "2026-11-16T10:00:00.000Z" }];
  b.notes = [{ id: "n1", title: "remoto", updatedAt: "2026-11-16T11:00:00.000Z" }];
  assert.strictEqual(m.mergeStates(a, b).notes[0].title, "remoto");
  b.notes[0].updatedAt = "2026-11-16T10:00:00.000Z";
  assert.strictEqual(m.mergeStates(a, b).notes[0].title, "local");
});

test("revisões: a que avançou mais (histórico, concluída) vence, mesmo com data de edição menor", () => {
  const a = base();
  const b = base();
  a.revisions = [{ id: "r1", status: "pending", stage: 1, history: [{ date: "d1" }], updatedAt: "2026-11-16T09:00:00.000Z" }];
  b.revisions = [{ id: "r1", status: "pending", stage: 0, history: [], updatedAt: "2026-11-16T11:00:00.000Z" }];
  assert.strictEqual(m.mergeStates(a, b).revisions[0].stage, 1, "o progresso do aparelho A não se perde");
  assert.strictEqual(m.mergeStates(b, a).revisions[0].stage, 1, "nem na ordem inversa");
  b.revisions[0].history = [{ date: "d1" }];
  b.revisions[0].status = "done";
  assert.strictEqual(m.mergeStates(a, b).revisions[0].status, "done", "concluída vence com o mesmo histórico");
});

test("caderno de erros: mais refações vence; flashcards: mais revisões vence", () => {
  const a = base();
  const b = base();
  a.errorNotebook = [{ id: "e1", attempts: 3, mastered: false }];
  b.errorNotebook = [{ id: "e1", attempts: 1, mastered: false, updatedAt: "2099" }];
  assert.strictEqual(m.mergeStates(a, b).errorNotebook[0].attempts, 3);
  a.flashcards = [{ id: "f1", reviews: 2, lastReviewed: "2026-11-10" }];
  b.flashcards = [{ id: "f1", reviews: 5, lastReviewed: "2026-11-12" }];
  assert.strictEqual(m.mergeStates(a, b).flashcards[0].reviews, 5);
  assert.strictEqual(m.mergeStates(b, a).flashcards[0].reviews, 5);
});

test("plano de lei seca: leitura registrada nos dois aparelhos soma o registro e fica com o maior avanço", () => {
  const a = base();
  const b = base();
  const plan = { id: "lp", title: "CF", doneWork: 10, readLog: [{ id: "x1", fromWork: 0, toWork: 10 }], updatedAt: "" };
  a.lawPlans = [{ ...plan, doneWork: 25, readLog: [...plan.readLog, { id: "x2", fromWork: 10, toWork: 25 }] }];
  b.lawPlans = [{ ...plan, doneWork: 18, readLog: [...plan.readLog, { id: "x3", fromWork: 10, toWork: 18 }] }];
  const merged = m.mergeStates(a, b).lawPlans[0];
  assert.strictEqual(merged.doneWork, 25);
  assert.strictEqual(json(merged.readLog.map((e) => e.id)), json(["x1", "x2", "x3"]));
});

test("exclusão feita em um aparelho não ressuscita pelo outro (nas duas ordens)", () => {
  const a = base();
  a.studyLogs = [log("L1"), log("L2")];
  m.mergeAttachIds(a);
  const staleCopy = clone(a); // aparelho B ainda tem L1
  a.studyLogs = a.studyLogs.filter((l) => l.id !== "L1");
  a.__ids = m.mergeRecordDeletions(a, a.__ids, NOW);
  assert.strictEqual(a.meta.tombstones.studyLogs.L1, NOW);
  const remoteA = clone(a);
  assert.strictEqual(json(ids(m.mergeStates(staleCopy, remoteA).studyLogs)), json(["L2"]), "B salvando: L1 some");
  assert.strictEqual(json(ids(m.mergeStates(a, staleCopy, { preferRemoteScalars: true }).studyLogs)), json(["L2"]), "A atualizando: L1 não volta");
});

test("item recriado depois da exclusão volta; antes dela, não", () => {
  const key = "studyLogs";
  const tombs = { [key]: { L1: "2026-11-16T10:00:00.000Z" } };
  assert.strictEqual(m.mergeIsAlive(log("L1", { createdAt: "2026-11-16T09:00:00.000Z" }), key, "L1", tombs, {}), false);
  assert.strictEqual(m.mergeIsAlive(log("L1", { createdAt: "2026-11-16T11:00:00.000Z" }), key, "L1", tombs, {}), true);
  assert.strictEqual(m.mergeIsAlive({ id: "L1", createdAt: "2026-11-16" }, key, "L1", tombs, {}), false, "data sem hora conta como anterior");
  assert.strictEqual(m.mergeIsAlive({ id: "L1" }, key, "L1", tombs, {}), false, "sem data: a exclusão vale");
  assert.strictEqual(m.mergeIsAlive({ id: "L1" }, key, "L1", tombs, { [key]: { L1: "2026-11-16T11:00:00.000Z" } }), true, "revivido depois");
  assert.strictEqual(m.mergeIsAlive({ id: "L1" }, key, "L1", tombs, { [key]: { L1: "2026-11-16T09:00:00.000Z" } }), false, "revivido antes da exclusão não vale");
});

test("desfazer (item volta) é registrado como revivido e sobrevive à mesclagem", () => {
  const a = base();
  a.subjects = [{ id: "s1", name: "Penal" }];
  m.mergeAttachIds(a);
  a.subjects = [];
  a.__ids = m.mergeRecordDeletions(a, a.__ids, "2026-11-16T10:00:00.000Z");
  assert.strictEqual(a.meta.tombstones.subjects.s1, "2026-11-16T10:00:00.000Z");
  a.subjects = [{ id: "s1", name: "Penal" }]; // desfez
  a.__ids = m.mergeRecordDeletions(a, a.__ids, "2026-11-16T11:00:00.000Z");
  assert.strictEqual(a.meta.revivals.subjects.s1, "2026-11-16T11:00:00.000Z");
  const other = base();
  other.subjects = [{ id: "s1", name: "Penal" }];
  assert.strictEqual(json(ids(m.mergeStates(other, clone(a)).subjects)), json(["s1"]));
  assert.strictEqual(json(ids(m.mergeStates(clone(a), other).subjects)), json(["s1"]));
});

test("lápides: validação, poda de 90 dias e união pela data mais recente", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");
  const cleaned = m.normalizeTombstones({ studyLogs: { old: "2026-01-01T00:00:00.000Z", fresh: "2026-11-01T00:00:00.000Z", bad: "xx", "": NOW }, lixo: 5, notes: null }, now);
  assert.strictEqual(json(cleaned), json({ studyLogs: { fresh: "2026-11-01T00:00:00.000Z" } }));
  assert.strictEqual(json(m.normalizeTombstones(null)), "{}");
  const union = m.mergeUnionTimes({ a: { x: "2026-11-01" } }, { a: { x: "2026-11-05", y: "2026-11-02" } });
  assert.strictEqual(json(union), json({ a: { x: "2026-11-05", y: "2026-11-02" } }));
});

test("registro de exclusões: base, remoção, volta e itens sem id", () => {
  const s = base();
  s.studyLogs = [log("L1")];
  s.categories = ["Resumo"];
  m.mergeAttachIds(s);
  assert.ok(s.__ids.studyLogs.has("L1"));
  assert.strictEqual(Object.keys(JSON.parse(JSON.stringify(s))).includes("__ids"), false, "não vai para o JSON");
  s.categories = [];
  s.__ids = m.mergeRecordDeletions(s, s.__ids, NOW);
  assert.strictEqual(json(s.meta.tombstones), "{}", "itens sem id não geram lápide");
  s.studyLogs = [];
  s.__ids = m.mergeRecordDeletions(s, s.__ids, NOW);
  assert.strictEqual(s.meta.tombstones.studyLogs.L1, NOW);
  assert.strictEqual(m.mergeRecordDeletions(s, s.__ids, "2026-11-17T00:00:00.000Z").studyLogs.size, 0);
  assert.strictEqual(s.meta.tombstones.studyLogs.L1, NOW, "a data da exclusão não é reescrita");
});

test("itens sem id (textos) se unem sem duplicar", () => {
  const a = base();
  const b = base();
  a.categories = ["Resumo", "Lei seca"];
  b.categories = ["Lei seca", "Mapa mental"];
  assert.strictEqual(json(m.mergeStates(a, b).categories), json(["Resumo", "Lei seca", "Mapa mental"]));
});

test("campos que não são listas: vence o lado que está salvando ou o que está atualizando", () => {
  const a = base();
  const b = base();
  a.settings.focusMinutes = 30;
  b.settings.focusMinutes = 50;
  b.settings.somenteRemoto = 6;
  a.edital.weeklyHours = 20;
  b.edital.weeklyHours = 30;
  a.cycleSettings.weights = { s1: 5 };
  b.cycleSettings.weights = { s1: 9, s2: 3 };
  a.cycleSettings.autoSince = "2026-11-10";
  b.cycleSettings.autoSince = "2026-11-03";
  a.flashcardSettings.reviewCounter = 12;
  b.flashcardSettings.reviewCounter = 7;
  const saving = m.mergeStates(a, b, { preferRemoteScalars: false });
  assert.strictEqual(saving.settings.focusMinutes, 30, "quem salva, prevalece");
  assert.strictEqual(saving.settings.somenteRemoto, 6, "campo só do outro lado entra");
  assert.strictEqual(saving.edital.weeklyHours, 20);
  assert.strictEqual(json(saving.cycleSettings.weights), json({ s1: 5, s2: 3 }));
  assert.strictEqual(saving.cycleSettings.autoSince, "2026-11-03", "vale a data mais antiga");
  assert.strictEqual(saving.flashcardSettings.reviewCounter, 12, "o contador de rodadas nunca volta");
  const refreshing = m.mergeStates(a, b, { preferRemoteScalars: true });
  assert.strictEqual(refreshing.settings.focusMinutes, 50, "quem só atualiza, adota o do servidor");
  assert.strictEqual(refreshing.edital.weeklyHours, 30);
  assert.strictEqual(json(refreshing.cycleSettings.weights), json({ s1: 9, s2: 3 }));
  assert.strictEqual(refreshing.flashcardSettings.reviewCounter, 12);
});

test("itens do edital e perfil/tela: itens se unem, perfil e interface ficam locais", () => {
  const a = base();
  const b = base();
  a.edital.items = [{ id: "i1", topicName: "A" }];
  b.edital.items = [{ id: "i2", topicName: "B" }];
  a.profile = { id: "p", pinHash: "local" };
  b.profile = { id: "p", pinHash: "supabase-auth" };
  a.ui.view = "erros";
  b.ui.view = "leiseca";
  const merged = m.mergeStates(a, b, { preferRemoteScalars: true });
  assert.strictEqual(json(ids(merged.edital.items)), json(["i1", "i2"]));
  assert.strictEqual(merged.profile.pinHash, "local");
  assert.strictEqual(merged.ui.view, "erros");
});

test("dois aparelhos, várias mudanças: o resultado converge nas duas ordens", () => {
  const s0 = base();
  s0.subjects = [{ id: "s1", name: "Penal" }];
  s0.studyLogs = [log("L1"), log("L2")];
  s0.revisions = [{ id: "r1", status: "pending", stage: 0, history: [], updatedAt: "2026-11-15T00:00:00.000Z" }];
  s0.errorNotebook = [{ id: "e1", attempts: 0, mastered: false }];
  const A = m.mergeAttachIds(clone(s0));
  const B = m.mergeAttachIds(clone(s0));
  // aparelho A: novo registro, exclui L1, conclui a revisão
  A.studyLogs = [...A.studyLogs.filter((l) => l.id !== "L1"), log("L3")];
  A.revisions = [{ id: "r1", status: "pending", stage: 1, history: [{ date: "2026-11-16", result: "ok" }], updatedAt: "2026-11-16T10:00:00.000Z" }];
  A.__ids = m.mergeRecordDeletions(A, A.__ids, "2026-11-16T10:00:00.000Z");
  // aparelho B: novo registro, refaz um erro, novo assunto
  B.studyLogs = [...B.studyLogs, log("L4")];
  B.errorNotebook = [{ id: "e1", attempts: 1, mastered: false }];
  B.topics = [{ id: "t9", subjectId: "s1", name: "Habeas corpus" }];
  B.__ids = m.mergeRecordDeletions(B, B.__ids, "2026-11-16T10:30:00.000Z");
  const remoteA = clone(A);
  const remoteB = clone(B);
  const onB = m.mergeStates(B, remoteA);
  const onA = m.mergeStates(A, remoteB);
  for (const result of [onA, onB]) {
    assert.strictEqual(json(ids(result.studyLogs)), json(["L2", "L3", "L4"]));
    assert.strictEqual(result.revisions[0].stage, 1);
    assert.strictEqual(result.errorNotebook[0].attempts, 1);
    assert.strictEqual(result.topics.length, 1);
  }
  assert.strictEqual(m.stateFingerprint(onA), m.stateFingerprint(onB), "mesmo conteúdo, qualquer que seja o aparelho");
});

test("mesclar duas vezes ou com o idêntico não muda nada (idempotente)", () => {
  const a = base();
  a.studyLogs = [log("L1")];
  a.meta.tombstones = { studyLogs: { X: NOW } };
  const once = m.mergeStates(a, clone(a));
  assert.strictEqual(m.stateFingerprint(once), m.stateFingerprint(a));
  const b = base();
  b.studyLogs = [log("L2")];
  const merged = m.mergeStates(a, b);
  assert.strictEqual(m.stateFingerprint(m.mergeStates(merged, b)), m.stateFingerprint(merged));
  assert.strictEqual(m.stateFingerprint(m.mergeStates(merged, a)), m.stateFingerprint(merged));
});

test("impressão digital ignora o que é só deste aparelho", () => {
  const a = base();
  const b = clone(a);
  b.ui.view = "erros";
  b.meta.localSavedAt = "2030-01-01";
  b.profile = { id: "outro" };
  b.account = { name: "x" };
  assert.strictEqual(m.stateFingerprint(a), m.stateFingerprint(b));
  b.studyLogs = [log("L1")];
  assert.notStrictEqual(m.stateFingerprint(a), m.stateFingerprint(b));
});

test("estatísticas da mesclagem: novos, removidos e atualizados", () => {
  const a = base();
  const b = base();
  a.studyLogs = [log("L1"), log("OLD")];
  b.studyLogs = [log("L1"), log("NOVO")];
  b.meta.tombstones = { studyLogs: { OLD: "2026-11-16T10:00:00.000Z" } };
  a.notes = [{ id: "n", title: "a", updatedAt: "1" }];
  b.notes = [{ id: "n", title: "b", updatedAt: "2" }];
  const { stats } = m.mergeStatesDetailed(a, b);
  assert.strictEqual(json(stats), json({ added: 1, removed: 1, updated: 1 }));
});

test("coleções ausentes ou malformadas não quebram", () => {
  const a = base();
  const b = { version: 2, studyLogs: "lixo", cases: null, meta: null };
  const merged = m.mergeStates(a, b);
  assert.strictEqual(merged.studyLogs.length, 0);
  assert.strictEqual(Array.isArray(merged.cases.STJ), true);
  const c = m.mergeStates({ version: 2 }, base());
  assert.strictEqual(Array.isArray(c.subjects), true);
});

test("impressão digital não depende da ordem das listas nem das chaves", () => {
  const a = base();
  const b = base();
  a.studyLogs = [log("L1"), log("L2")];
  b.studyLogs = [log("L2"), log("L1")];
  a.settings = { focusMinutes: 25, cycles: 4 };
  b.settings = { cycles: 4, focusMinutes: 25 };
  a.cases.STJ = [{ id: "c1" }, { id: "c2" }];
  b.cases.STJ = [{ id: "c2" }, { id: "c1" }];
  assert.strictEqual(m.stateFingerprint(a), m.stateFingerprint(b));
  b.studyLogs[0].minutes = 31;
  assert.notStrictEqual(m.stateFingerprint(a), m.stateFingerprint(b), "mas mudança de conteúdo aparece");
  const c = base();
  const d = base();
  c.revisions = [{ id: "r", history: [{ d: 1 }, { d: 2 }] }];
  d.revisions = [{ id: "r", history: [{ d: 2 }, { d: 1 }] }];
  assert.notStrictEqual(m.stateFingerprint(c), m.stateFingerprint(d), "a ordem do histórico (cronológica) continua importando");
});

test("restaurar versão da conta: tira o que a versão não tem e revive o que ela tem, mesmo com outro aparelho desatualizado", () => {
  const T0 = "2026-11-01T10:00:00.000Z";
  const T1 = "2026-11-10T10:00:00.000Z";
  const T2 = "2026-11-20T10:00:00.000Z";
  const old = base(); // versão antiga que será restaurada: tem a e z
  old.subjects = [{ id: "a", createdAt: T0 }, { id: "z", createdAt: T0 }];
  const current = base(); // hoje: z foi excluído em T1 e b foi criado depois
  current.subjects = [{ id: "a", createdAt: T0 }, { id: "b", createdAt: T1 }];
  current.meta.tombstones = { subjects: { z: T1 } };
  const otherDevice = clone(current); // outro aparelho ainda no estado de hoje

  m.mergeCarryForwardForRestore(old, current);
  assert.ok(old.__ids.subjects.has("b") && !old.__ids.subjects.has("z"), "guarda os ids de antes para registrar a diferença");
  assert.ok(!Object.keys(old).includes("__ids"), "e não entra no JSON");
  old.__ids = m.mergeRecordDeletions(old, old.__ids, T2); // é o que o saveState faz
  assert.strictEqual(old.meta.tombstones.subjects.b, T2, "b, que a versão não tem, vira exclusão");
  assert.strictEqual(old.meta.revivals.subjects.z, T2, "z, que estava excluído, volta como revivido");
  assert.strictEqual(old.meta.tombstones.subjects.z, T1, "a lápide antiga continua guardada");

  [m.mergeStates(otherDevice, old), m.mergeStates(old, otherDevice), m.mergeStates(otherDevice, old, { preferRemoteScalars: true })].forEach((merged) => {
    assert.strictEqual(json(ids(merged.subjects)), json(["a", "z"]), "o outro aparelho não traz b de volta nem mata z");
  });
});

test("restaurar versão da conta: o que o aparelho desatualizado criou DEPOIS da restauração é mantido", () => {
  const T0 = "2026-11-01T10:00:00.000Z";
  const T2 = "2026-11-20T10:00:00.000Z";
  const T3 = "2026-11-21T10:00:00.000Z";
  const old = base();
  old.subjects = [{ id: "a", createdAt: T0 }];
  const current = base();
  current.subjects = [{ id: "a", createdAt: T0 }, { id: "b", createdAt: T0 }];
  const other = clone(current);
  other.subjects.push({ id: "novo", createdAt: T3 });
  m.mergeCarryForwardForRestore(old, current);
  old.__ids = m.mergeRecordDeletions(old, old.__ids, T2);
  assert.strictEqual(json(ids(m.mergeStates(other, old).subjects)), json(["a", "novo"]), "b some, o item novo fica");
});

console.log(`merge-tests: ${passed} testes passaram.`);
