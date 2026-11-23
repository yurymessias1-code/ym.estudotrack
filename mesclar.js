/*
 * Mesclar assuntos e matérias duplicados (por exemplo, "Habeas-corpus" e "Habeas corpus").
 * Tudo que apontava para o item de origem passa a apontar para o destino (registros de estudo, questões,
 * flashcards, erros, revisões, leis...), e a origem deixa de existir. Assuntos de mesmo nome dentro de uma
 * matéria mesclada são unidos. O desfazer devolve só o que a mesclagem mudou, sem mexer no que foi feito depois.
 * Carregado depois do merge.js e do modal.js.
 */

const MESCLAR_PATHS = [
  ["studyLogs"], ["questionLogs"], ["flashcards"], ["notes"], ["sources"], ["goals"], ["legalMaterials"],
  ["errorNotebook"], ["revisions"], ["lawPlans"], ["cases", "STJ"], ["cases", "STF"], ["competitions"],
];
const MESCLAR_LABELS = {
  studyLogs: ["registro de estudo", "registros de estudo"],
  questionLogs: ["lançamento de questões", "lançamentos de questões"],
  flashcards: ["flashcard", "flashcards"],
  notes: ["anotação", "anotações"],
  sources: ["fonte", "fontes"],
  goals: ["meta", "metas"],
  legalMaterials: ["lei ou tabela", "leis e tabelas"],
  errorNotebook: ["erro do caderno", "erros do caderno"],
  revisions: ["revisão", "revisões"],
  lawPlans: ["plano de lei seca", "planos de lei seca"],
  "cases.STJ": ["julgado do STJ", "julgados do STJ"],
  "cases.STF": ["julgado do STF", "julgados do STF"],
  competitions: ["concurso", "concursos"],
};

function mesclarNorm(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mesclarPlural(count, labels) {
  return `${count} ${count === 1 ? labels[0] : labels[1]}`;
}

/** Registra o que a mesclagem altera, para o desfazer devolver exatamente isso. */
function mesclarRecorder() {
  const touched = [];
  const seen = new Set();
  const removed = [];
  const reverts = [];
  return {
    touch(key, item) {
      const mark = `${key}:${item.id}`;
      if (seen.has(mark)) return;
      seen.add(mark);
      touched.push({
        key,
        id: item.id,
        before: {
          subjectId: item.subjectId,
          topicId: item.topicId,
          originKey: item.originKey,
          subjectIds: Array.isArray(item.subjectIds) ? [...item.subjectIds] : undefined,
          has: { subjectId: "subjectId" in item, topicId: "topicId" in item, originKey: "originKey" in item, subjectIds: "subjectIds" in item },
        },
      });
    },
    remove(key, item) {
      removed.push({ key, item: JSON.parse(JSON.stringify(item)) });
    },
    onUndo(fn) {
      reverts.push(fn);
    },
    undo(state) {
      let restored = 0;
      const listOf = (key) => mergeGetList(state, key.split("."));
      removed.forEach(({ key, item }) => {
        const list = listOf(key);
        if (!list.some((other) => other.id === item.id)) {
          list.push(item);
          restored += 1;
        }
      });
      touched.forEach(({ key, id, before }) => {
        const item = listOf(key).find((other) => other.id === id);
        if (!item) return;
        ["subjectId", "topicId", "originKey", "subjectIds"].forEach((field) => {
          if (before.has[field]) item[field] = before[field];
          else delete item[field];
        });
        restored += 1;
      });
      reverts.forEach((fn) => fn(state));
      return restored;
    },
  };
}

function mesclarCollections(state) {
  return MESCLAR_PATHS.map((path) => ({ key: mergePathKey(path), list: mergeGetList(state, path) }));
}

/** O que aponta para a matéria/assunto (para a prévia antes de confirmar). */
function mesclarCountRefs(state, { subjectId = "", topicId = "" }) {
  const topicIds = new Set(subjectId ? state.topics.filter((topic) => topic.subjectId === subjectId).map((topic) => topic.id) : [topicId]);
  const out = [];
  mesclarCollections(state).forEach(({ key, list }) => {
    const count = list.filter((item) => (topicId ? item.topicId === topicId : item.subjectId === subjectId || topicIds.has(item.topicId))).length;
    if (count && MESCLAR_LABELS[key]) out.push({ key, count, text: mesclarPlural(count, MESCLAR_LABELS[key]) });
  });
  return out;
}

/** Remapeia chaves de revisão automática (study:/weak:) e resolve colisões mantendo a que mais avançou. */
function mesclarRemapRevisionKeys(state, recorder, fromId, toId) {
  const pattern = /^(study|weak):([^:]+):(.+)$/;
  state.revisions.forEach((revision) => {
    const match = pattern.exec(revision.originKey || "");
    if (match && match[2] === fromId) {
      recorder.touch("revisions", revision);
      revision.originKey = `${match[1]}:${toId}:${match[3]}`;
    }
  });
  const byKey = new Map();
  state.revisions.forEach((revision, index) => {
    if (!pattern.test(revision.originKey || "")) return;
    const group = byKey.get(revision.originKey) || [];
    group.push({ revision, index });
    byKey.set(revision.originKey, group);
  });
  const drop = new Set();
  byKey.forEach((group) => {
    if (group.length < 2) return;
    const score = (item) => (item.revision.history?.length || 0) * 10 + (item.revision.status === "done" ? 5 : 0);
    group.sort((a, b) => score(b) - score(a) || a.index - b.index);
    group.slice(1).forEach((item) => drop.add(item.revision.id));
  });
  if (drop.size) {
    state.revisions.filter((revision) => drop.has(revision.id)).forEach((revision) => recorder.remove("revisions", revision));
    state.revisions = state.revisions.filter((revision) => !drop.has(revision.id));
  }
}

/** Telas/filtros e o cronômetro que apontavam para o item de origem passam a apontar para o destino. */
function mesclarRemapUi(state, recorder, fromId, toId) {
  if (state.ui && typeof state.ui === "object") {
    Object.keys(state.ui).forEach((key) => {
      if (/subject|topic/i.test(key) && state.ui[key] === fromId) {
        const before = state.ui[key];
        state.ui[key] = toId;
        recorder.onUndo((target) => {
          if (target.ui && target.ui[key] === toId) target.ui[key] = before;
        });
      }
    });
  }
  try {
    if (typeof timer !== "undefined" && timer) {
      if (timer.subjectId === fromId) timer.subjectId = toId;
      if (timer.topicId === fromId) timer.topicId = toId;
    }
    if (typeof sessionPendingRead === "function" && typeof sessionPendingWrite === "function") {
      const pending = sessionPendingRead();
      let changed = false;
      pending.forEach((item) => {
        if (item.subjectId === fromId) { item.subjectId = toId; changed = true; }
        if (item.topicId === fromId) { item.topicId = toId; changed = true; }
      });
      if (changed) sessionPendingWrite(pending);
    }
  } catch {
    /* estado só deste aparelho: se não der para ajustar, a escolha é refeita na janela */
  }
}

function mesclarMoveTopic(state, recorder, fromId, toId) {
  const to = state.topics.find((topic) => topic.id === toId);
  let moved = 0;
  mesclarCollections(state).forEach(({ key, list }) => {
    list.forEach((item) => {
      if (item.topicId !== fromId) return;
      recorder.touch(key, item);
      item.topicId = toId;
      item.subjectId = to.subjectId;
      moved += 1;
    });
  });
  mesclarRemapRevisionKeys(state, recorder, fromId, toId);
  mesclarRemapUi(state, recorder, fromId, toId);
  const from = state.topics.find((topic) => topic.id === fromId);
  if (from) recorder.remove("topics", from);
  state.topics = state.topics.filter((topic) => topic.id !== fromId);
  return moved;
}

function mesclarTopicInto(state, fromId, toId) {
  const from = state.topics.find((topic) => topic.id === fromId);
  const to = state.topics.find((topic) => topic.id === toId);
  if (!from || !to || from.id === to.id) return { ok: false, error: "Escolha dois assuntos diferentes." };
  const recorder = mesclarRecorder();
  const moved = mesclarMoveTopic(state, recorder, fromId, toId);
  return { ok: true, moved, unified: 0, undo: (target = state) => recorder.undo(target) };
}

function mesclarSubjectInto(state, fromId, toId) {
  const from = state.subjects.find((subject) => subject.id === fromId);
  const to = state.subjects.find((subject) => subject.id === toId);
  if (!from || !to || from.id === to.id) return { ok: false, error: "Escolha duas matérias diferentes." };
  const recorder = mesclarRecorder();
  let moved = 0;
  let unified = 0;
  // Só os assuntos que o destino já tinha antes contam como "gêmeos"; os que acabam de ser movidos não.
  const destinationTopics = state.topics.filter((topic) => topic.subjectId === toId);
  state.topics
    .filter((topic) => topic.subjectId === fromId)
    .forEach((topic) => {
      const twin = destinationTopics.find((other) => mesclarNorm(other.name) === mesclarNorm(topic.name));
      if (twin) {
        moved += mesclarMoveTopic(state, recorder, topic.id, twin.id);
        unified += 1;
      } else {
        recorder.touch("topics", topic);
        topic.subjectId = toId;
      }
    });
  mesclarCollections(state).forEach(({ key, list }) => {
    list.forEach((item) => {
      if (item.subjectId === fromId) {
        recorder.touch(key, item);
        item.subjectId = toId;
        moved += 1;
      }
      if (Array.isArray(item.subjectIds) && item.subjectIds.includes(fromId)) {
        recorder.touch(key, item);
        item.subjectIds = [...new Set(item.subjectIds.map((id) => (id === fromId ? toId : id)))];
      }
    });
  });
  mesclarRemapRevisionKeys(state, recorder, fromId, toId);
  mesclarRemapUi(state, recorder, fromId, toId);
  const weights = state.cycleSettings?.weights;
  if (weights && Object.prototype.hasOwnProperty.call(weights, fromId)) {
    const before = { from: weights[fromId], to: weights[toId], hadTo: Object.prototype.hasOwnProperty.call(weights, toId) };
    if (!before.hadTo) weights[toId] = weights[fromId];
    delete weights[fromId];
    recorder.onUndo((target) => {
      const w = target.cycleSettings?.weights;
      if (!w) return;
      w[fromId] = before.from;
      if (before.hadTo) w[toId] = before.to;
      else delete w[toId];
    });
  }
  recorder.remove("subjects", from);
  state.subjects = state.subjects.filter((subject) => subject.id !== fromId);
  return { ok: true, moved, unified, undo: (target = state) => recorder.undo(target) };
}

/** Prévia (sem alterar nada): o que será movido e quantos assuntos serão unidos. */
function mesclarPlan(state, kind, fromId, toId) {
  if (kind === "topic") return { refs: mesclarCountRefs(state, { topicId: fromId }), unified: 0, moves: 0 };
  const twins = state.topics.filter((topic) => topic.subjectId === fromId && state.topics.some((other) => other.subjectId === toId && mesclarNorm(other.name) === mesclarNorm(topic.name))).length;
  const reassigned = state.topics.filter((topic) => topic.subjectId === fromId).length - twins;
  return { refs: mesclarCountRefs(state, { subjectId: fromId }), unified: twins, reassigned };
}

/** Sugere o destino mais provável: mesma matéria e nome parecido. */
function mesclarSuggest(candidates, name, preferSubjectId = "") {
  const key = mesclarNorm(name);
  let best = null;
  let bestScore = 0;
  candidates.forEach((candidate) => {
    const other = mesclarNorm(candidate.name);
    let common = 0;
    while (common < key.length && common < other.length && key[common] === other[common]) common += 1;
    const score = common + (preferSubjectId && candidate.subjectId === preferSubjectId ? 0.5 : 0);
    if (common >= 4 && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

const mesclarUI = { kind: "", fromId: "", undo: null, label: "" };

function mesclarOptions(kind, fromId) {
  if (kind === "topic") {
    return state.topics
      .filter((topic) => topic.id !== fromId)
      .map((topic) => ({ id: topic.id, name: topic.name, subjectId: topic.subjectId, label: `${getSubject(topic.subjectId)?.name || "Sem matéria"} — ${topic.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }
  return state.subjects
    .filter((subject) => subject.id !== fromId)
    .map((subject) => ({ id: subject.id, name: subject.name, subjectId: subject.id, label: subject.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function mesclarOpen(kind, fromId) {
  const from = kind === "topic" ? state.topics.find((topic) => topic.id === fromId) : state.subjects.find((subject) => subject.id === fromId);
  if (!from) return;
  const options = mesclarOptions(kind, fromId);
  if (!options.length) {
    showToast(kind === "topic" ? "Não há outro assunto para receber este. Cadastre ou escolha outro." : "Não há outra matéria para receber esta.");
    return;
  }
  mesclarUI.kind = kind;
  mesclarUI.fromId = fromId;
  const label = kind === "topic" ? "assunto" : "matéria";
  const article = kind === "topic" ? "o" : "a";
  const chosen = kind === "topic" ? "escolhido" : "escolhida";
  $("#mergeEyebrow").textContent = `Mesclar ${label}`;
  $("#mergeModalTitle").textContent = `Mesclar «${from.name}» em…`;
  $("#mergeSummary").textContent = `Tudo que está em «${from.name}» passa para ${article} ${label} ${chosen}, e «${from.name}» deixa de existir. Use para juntar duplicados, como nomes com erro de digitação.`;
  const suggested = mesclarSuggest(options, from.name, kind === "topic" ? from.subjectId : "");
  $("#mergeTarget").innerHTML = `<option value="">Escolha ${article} ${label} de destino</option>` + options.map((option) => `<option value="${option.id}">${escapeHTML(option.label)}</option>`).join("");
  $("#mergeTarget").value = suggested ? suggested.id : "";
  mesclarRenderPreview();
  const modal = $("#mergeModal");
  const returnFocus = document.activeElement;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  modalOpen(modal, { returnFocus, initialFocus: $("#mergeTarget") });
}

function mesclarClose() {
  const modal = $("#mergeModal");
  if (modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  modalClose(modal);
}

function mesclarRenderPreview() {
  const toId = $("#mergeTarget").value;
  const box = $("#mergePreview");
  const confirm = $("#mergeConfirmBtn");
  confirm.disabled = !toId;
  if (!toId) {
    box.innerHTML = `<p class="muted-note">Escolha o destino para ver o que será movido.</p>`;
    return;
  }
  const kind = mesclarUI.kind;
  const plan = mesclarPlan(state, kind, mesclarUI.fromId, toId);
  const target = kind === "topic" ? state.topics.find((topic) => topic.id === toId) : state.subjects.find((subject) => subject.id === toId);
  const items = plan.refs.map((ref) => `<li>${escapeHTML(ref.text)}</li>`);
  if (kind === "subject" && plan.unified) items.push(`<li>${mesclarPlural(plan.unified, ["assunto com o mesmo nome será unido", "assuntos com o mesmo nome serão unidos"])}</li>`);
  if (kind === "subject" && plan.reassigned > 0) items.push(`<li>${mesclarPlural(plan.reassigned, ["assunto passa", "assuntos passam"])} a pertencer a «${escapeHTML(target.name)}»</li>`);
  box.innerHTML = items.length
    ? `<p><strong>Passa(m) para «${escapeHTML(target.name)}»:</strong></p><ul>${items.join("")}</ul><p class="muted-note">Logo depois, uma barra permite desfazer.</p>`
    : `<p class="muted-note">Nada aponta para o item de origem; ele só será removido.</p>`;
}

function mesclarSubmit() {
  const toId = $("#mergeTarget").value;
  const kind = mesclarUI.kind;
  const fromId = mesclarUI.fromId;
  if (!toId) return;
  const from = kind === "topic" ? state.topics.find((topic) => topic.id === fromId) : state.subjects.find((subject) => subject.id === fromId);
  const to = kind === "topic" ? state.topics.find((topic) => topic.id === toId) : state.subjects.find((subject) => subject.id === toId);
  const result = kind === "topic" ? mesclarTopicInto(state, fromId, toId) : mesclarSubjectInto(state, fromId, toId);
  if (!result.ok) {
    showToast(result.error);
    return;
  }
  mesclarUI.undo = result.undo;
  mesclarUI.label = `«${from.name}» em «${to.name}»`;
  mesclarClose();
  saveState();
  render();
  showToast(`Mesclado: ${mesclarUI.label}. ${result.moved ? `${result.moved} registros movidos.` : ""} Dá para desfazer na barra do topo.`.replace("  ", " "));
}

function mesclarUndo() {
  if (!mesclarUI.undo) return;
  const restored = mesclarUI.undo(state);
  const label = mesclarUI.label;
  mesclarUI.undo = null;
  mesclarUI.label = "";
  saveState();
  render();
  showToast(`Mesclagem de ${label} desfeita (${restored} itens restaurados).`);
}

function renderMesclarBar() {
  const bar = $("#mergeUndoBar");
  if (!bar) return;
  const show = Boolean(mesclarUI.undo);
  bar.classList.toggle("hidden", !show);
  if (!show) return;
  bar.innerHTML = `
    <div><strong>Mesclagem feita:</strong> ${escapeHTML(mesclarUI.label)}. Se foi engano, desfaça agora; só o que a mesclagem mudou volta, o que você fez depois fica.</div>
    <div class="inline-actions">
      <button class="button primary" data-cycle-action="mergeUndo" type="button">Desfazer</button>
      <button class="mini-button" data-cycle-action="mergeUndoDismiss" type="button">Manter</button>
    </div>`;
}

function handleMesclarAction(type, button) {
  if (type === "mergeSubject" || type === "mergeTopic") {
    mesclarOpen(type === "mergeTopic" ? "topic" : "subject", button.dataset.id);
    return true;
  }
  if (type === "mergeCancel") {
    mesclarClose();
    return true;
  }
  if (type === "mergeUndo") {
    mesclarUndo();
    return true;
  }
  if (type === "mergeUndoDismiss") {
    mesclarUI.undo = null;
    mesclarUI.label = "";
    renderMesclarBar();
    return true;
  }
  return false;
}

function bindMesclarEvents() {
  $("#mergeTarget").addEventListener("change", mesclarRenderPreview);
  $("#mergeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    mesclarSubmit();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#mergeModal").classList.contains("hidden")) mesclarClose();
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { mesclarNorm, mesclarCountRefs, mesclarTopicInto, mesclarSubjectInto, mesclarPlan, mesclarSuggest };
}
