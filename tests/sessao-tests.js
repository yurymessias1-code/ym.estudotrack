const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const json = (value) => JSON.stringify(value);
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

function makeContext({ subjects = [], topics = [], askAtSave = true } = {}) {
  const store = new Map();
  let counter = 0;
  const sandbox = {
    console,
    TextEncoder,
    Intl,
    Date,
    JSON,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    uid: () => `id${++counter}`,
    $: () => null,
    $$: () => [],
    escapeHTML: (v) => v,
    isProfileAuthenticated: () => true,
    window: {},
  };
  const ctx = vm.createContext(sandbox);
  ["ciclo.js", "hoje.js", "sessao.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file }));
  ctx.state = {
    subjects: JSON.parse(json(subjects)),
    topics: JSON.parse(json(topics)),
    studyLogs: [],
    cycleSettings: ctx.normalizeCycleSettings({ askAtSave }),
    profile: { id: "p1" },
  };
  return { ctx, store };
}

const SUBJECTS = [
  { id: "s1", name: "Direito Penal" },
  { id: "s2", name: "Língua Portuguesa" },
];
const TOPICS = [
  { id: "t1", subjectId: "s1", name: "Habeas corpus" },
  { id: "t2", subjectId: "s2", name: "Crase" },
  { id: "t3", subjectId: "s1", name: "Direitos fundamentais" },
];

const { ctx } = makeContext({ subjects: SUBJECTS, topics: TOPICS });
const resolve = (over) => ctx.sessionResolveTarget({ subjects: SUBJECTS, topics: TOPICS, ...over });

test("nomes digitados: espaços e tamanho", () => {
  assert.strictEqual(ctx.sessionClean("  Habeas    corpus \n"), "Habeas corpus");
  assert.strictEqual(ctx.sessionClean("x".repeat(300)).length, 120);
  assert.strictEqual(ctx.sessionClean(null), "");
});

test("matéria existente, com e sem assunto existente", () => {
  assert.strictEqual(json(resolve({ subjectId: "s1" })), json({ ok: true, subjectId: "s1", subjectName: "", topicId: "", topicName: "" }));
  assert.strictEqual(json(resolve({ subjectId: "s1", topicId: "t1" })), json({ ok: true, subjectId: "s1", subjectName: "", topicId: "t1", topicName: "" }));
});

test("assunto existente define a matéria, como no restante do app", () => {
  const result = resolve({ subjectId: "s2", topicId: "t1" });
  assert.strictEqual(result.subjectId, "s1");
  assert.strictEqual(result.topicId, "t1");
});

test("assunto novo digitado na matéria existente", () => {
  const result = resolve({ subjectId: "s1", topicId: "__new__", newTopicName: "  Prisão   preventiva " });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.topicId, "");
  assert.strictEqual(result.topicName, "Prisão preventiva");
  assert.strictEqual(result.subjectId, "s1");
});

test("assunto novo com nome já existente reaproveita (sem acento, maiúsculas ou espaços)", () => {
  assert.strictEqual(resolve({ subjectId: "s1", topicId: "__new__", newTopicName: "HABEAS   corpus " }).topicId, "t1");
  assert.strictEqual(resolve({ subjectId: "s1", newTopicName: "direitos fundamentais" }).topicId, "t3");
  assert.strictEqual(resolve({ subjectId: "s2", newTopicName: "CRASE" }).topicId, "t2");
  assert.strictEqual(resolve({ subjectId: "s1", newTopicName: "Crase" }).topicName, "Crase", "mesmo nome em outra matéria é um assunto novo");
});

test("texto digitado vale no lugar do assunto selecionado (registro manual)", () => {
  const result = resolve({ subjectId: "s1", topicId: "t1", newTopicName: "Prisão preventiva" });
  assert.strictEqual(result.topicName, "Prisão preventiva");
  assert.strictEqual(result.topicId, "");
  assert.strictEqual(result.subjectId, "s1");
});

test("matéria nova (e reaproveitamento por nome)", () => {
  const created = resolve({ subjectId: "__new__", newSubjectName: "Raciocínio Lógico" });
  assert.strictEqual(created.subjectName, "Raciocínio Lógico");
  assert.strictEqual(created.subjectId, "");
  assert.strictEqual(resolve({ subjectId: "__new__", newSubjectName: "lingua portuguesa" }).subjectId, "s2");
  assert.strictEqual(resolve({ subjectId: "__new__", newSubjectName: "lingua portuguesa" }).subjectName, "");
});

test("matéria nova com assunto novo: cria os dois", () => {
  const result = resolve({ subjectId: "__new__", newSubjectName: "Informática", topicId: "__new__", newTopicName: "Excel" });
  assert.strictEqual(json(result), json({ ok: true, subjectId: "", subjectName: "Informática", topicId: "", topicName: "Excel" }));
  const reused = resolve({ subjectId: "__new__", newSubjectName: "Direito Penal", topicId: "__new__", newTopicName: "Habeas corpus" });
  assert.strictEqual(reused.subjectId, "s1");
  assert.strictEqual(reused.topicId, "t1");
  assert.strictEqual(reused.subjectName + reused.topicName, "");
});

test("erros de preenchimento são claros e não criam nada", () => {
  assert.strictEqual(resolve({}).error, "Escolha a matéria estudada.");
  assert.strictEqual(resolve({ subjectId: "s9" }).error, "A matéria escolhida não existe mais.");
  assert.strictEqual(resolve({ subjectId: "s1", topicId: "t9" }).error, "O assunto escolhido não existe mais.");
  assert.strictEqual(resolve({ subjectId: "__new__", newSubjectName: "   " }).error, "Escreva o nome da nova matéria.");
  assert.strictEqual(resolve({ subjectId: "s1", topicId: "__new__", newTopicName: "  " }).error, "Escreva o nome do novo assunto.");
  assert.strictEqual(resolve({ subjectId: "s1", topicId: "__new__" }).ok, false);
});

test("criar na hora: matéria e assunto com os mesmos campos do cadastro", () => {
  const { ctx: c } = makeContext({ subjects: SUBJECTS, topics: TOPICS });
  const done = c.sessionCommitTarget({ ok: true, subjectId: "", subjectName: "Informática", topicId: "", topicName: "Excel" });
  assert.strictEqual(done.createdSubject, true);
  assert.strictEqual(done.createdTopic, true);
  const subject = c.state.subjects.find((s) => s.id === done.subjectId);
  const topic = c.state.topics.find((t) => t.id === done.topicId);
  assert.strictEqual(subject.name, "Informática");
  assert.ok(/^#[0-9a-f]{6}$/i.test(subject.color), "cor válida");
  assert.strictEqual(subject.goalHours, 5);
  assert.strictEqual(topic.subjectId, subject.id);
  assert.strictEqual(topic.name, "Excel");
  assert.strictEqual(topic.priority, "Média");
  assert.strictEqual(c.state.subjects.length, 3);
  assert.strictEqual(c.state.topics.length, 4);
  const none = c.sessionCommitTarget({ ok: true, subjectId: "s1", subjectName: "", topicId: "t1", topicName: "" });
  assert.strictEqual(json({ ...none }), json({ subjectId: "s1", topicId: "t1", createdSubject: false, createdTopic: false }));
  assert.strictEqual(c.state.subjects.length, 3, "nada criado quando já existe");
});

test("campo de assunto novo digitado: cria, reaproveita e recusa matéria vazia", () => {
  const { ctx: c } = makeContext({ subjects: SUBJECTS, topics: TOPICS });
  const created = c.sessionApplyTypedTopic("s1", "Legítima defesa");
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.createdTopic, true);
  assert.strictEqual(c.state.topics.find((t) => t.id === created.topicId).name, "Legítima defesa");
  const again = c.sessionApplyTypedTopic("s1", " legitima  DEFESA");
  assert.strictEqual(again.topicId, created.topicId);
  assert.strictEqual(again.createdTopic, false);
  assert.strictEqual(c.state.topics.length, 4);
  assert.strictEqual(c.sessionApplyTypedTopic("", "X").ok, false);
});

test("fila de sessões: pergunta conforme a configuração e guarda neste aparelho", () => {
  const entry = { id: "e1", minutes: 25, date: "2026-11-16", cycle: 2, subjectId: "s1", topicId: "", competitionId: "", source: "Pomodoro", note: "Ciclo 2" };
  const on = makeContext({ subjects: SUBJECTS, topics: TOPICS, askAtSave: true });
  assert.strictEqual(on.ctx.sessionAskBeforeSave(entry), true, "com a opção ligada sempre pergunta");
  const saved = on.ctx.sessionPendingRead();
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].minutes, 25);
  assert.strictEqual(saved[0].cycle, 2);
  assert.strictEqual(saved[0].subjectId, "s1");
  assert.strictEqual(on.ctx.state.pendingSessions.length, 1, "a fila fica no estado (vai para a conta), não só no aparelho");
  assert.strictEqual(on.store.get("ymEstudos.pendingSessions.p1"), undefined, "nada fica só no localStorage");

  const off = makeContext({ subjects: SUBJECTS, topics: TOPICS, askAtSave: false });
  assert.strictEqual(off.ctx.sessionAskBeforeSave(entry), false, "desligada e com matéria: salva direto");
  assert.strictEqual(off.ctx.sessionPendingRead().length, 0);
  assert.strictEqual(off.ctx.sessionAskBeforeSave({ ...entry, subjectId: "" }), true, "desligada, mas sem matéria: pergunta");
  assert.strictEqual(off.ctx.sessionPendingRead()[0].subjectId, "");
});

test("fila de sessões: limite, dados corrompidos e minutos fora da faixa", () => {
  const { ctx: c, store } = makeContext({ subjects: SUBJECTS });
  for (let i = 0; i < 25; i += 1) c.sessionAskBeforeSave({ id: `e${i}`, minutes: 25, date: "2026-11-16", subjectId: "", topicId: "" });
  assert.strictEqual(c.sessionPendingRead().length, 20, "guarda só as 20 mais recentes");
  assert.strictEqual(c.sessionPendingRead()[0].id, "e5");
  store.set("ymEstudos.pendingSessions.p1", "isto não é json");
  assert.strictEqual(c.sessionPendingRead().length, 20, "cópia antiga corrompida é descartada sem apagar a fila do estado");
  assert.strictEqual(store.has("ymEstudos.pendingSessions.p1"), false);
  c.sessionPendingWrite([{ id: "a", minutes: 0 }, { id: "b", minutes: 9999, date: "lixo" }, null, { minutes: 5 }]);
  const read = c.sessionPendingRead();
  assert.strictEqual(read.length, 1);
  assert.strictEqual(read[0].minutes, 600);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(read[0].date));
});

test("fila de sessões: traz para o estado a cópia antiga do localStorage, sem duplicar", () => {
  const { ctx: c, store } = makeContext({ subjects: SUBJECTS });
  let saves = 0;
  c.saveState = () => { saves += 1; };
  c.state.pendingSessions = [{ id: "x1", minutes: 20, date: "2026-11-16" }];
  store.set("ymEstudos.pendingSessions.p1", JSON.stringify([{ id: "x1", minutes: 20, date: "2026-11-16" }, { id: "x2", minutes: 30, date: "2026-11-15" }]));
  const read = c.sessionPendingRead();
  assert.strictEqual(json(read.map((item) => item.id)), json(["x1", "x2"]), "x1 não duplica");
  assert.strictEqual(c.state.pendingSessions.length, 2);
  assert.strictEqual(store.has("ymEstudos.pendingSessions.p1"), false, "cópia antiga removida depois de migrar");
  assert.strictEqual(saves, 1, "salva uma vez ao migrar");
  c.sessionPendingRead();
  assert.strictEqual(saves, 1, "não salva de novo sem cópia antiga");
});

test("fila de sessões: cada gravação salva o estado e a junção entre aparelhos soma as sessões", () => {
  const { ctx: c } = makeContext({ subjects: SUBJECTS });
  let saves = 0;
  c.saveState = () => { saves += 1; };
  c.sessionAskBeforeSave({ id: "e1", minutes: 25, date: "2026-11-16", subjectId: "", topicId: "" });
  assert.strictEqual(saves, 1);
  const merge = require(path.join(root, "merge.js"));
  assert.ok(merge.MERGE_PATHS.some((p) => p.join(".") === "pendingSessions"), "pendingSessions entra na junção");
  const local = { pendingSessions: [{ id: "a", minutes: 10 }], meta: {} };
  const remote = { pendingSessions: [{ id: "b", minutes: 20 }], meta: {} };
  const out = merge.mergeStates(local, remote);
  assert.strictEqual(json(out.pendingSessions.map((item) => item.id).sort()), json(["a", "b"]));
});

test("configuração askAtSave: ligada por padrão", () => {
  assert.strictEqual(ctx.normalizeCycleSettings({}).askAtSave, true);
  assert.strictEqual(ctx.normalizeCycleSettings({ askAtSave: false }).askAtSave, false);
});

console.log(`sessao-tests: ${passed} testes passaram.`);
