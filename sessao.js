/*
 * Salvar o que foi estudado na hora de registrar o tempo (Pomodoro, registro manual e registro rápido).
 * Ao terminar um foco, uma janela pergunta matéria e assunto e permite criar os dois na hora,
 * sem passar pela aba Matérias. As sessões ainda sem destino ficam guardadas neste aparelho até serem salvas.
 * Carregado depois do push.js e antes do app.js.
 */

const SESSION_NEW = "__new__";
const SESSION_STORE_PREFIX = "ymEstudos.pendingSessions.";
const SESSION_MAX_PENDING = 20;
const SESSION_FALLBACK_COLORS = ["#0f766e", "#2563eb", "#c2410c", "#7c3aed", "#be123c", "#4d7c0f", "#0369a1", "#a16207"];

/* ------------------------------------------------------------------ */
/* Lógica pura                                                         */
/* ------------------------------------------------------------------ */

function sessionClean(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Decide o destino do tempo estudado a partir do que a pessoa escolheu ou digitou.
 * Nomes novos que coincidem (sem diferenciar maiúsculas e acentos) com um já existente reaproveitam o existente.
 * Devolve o que usar e o que precisa ser criado, sem alterar nada.
 */
function sessionResolveTarget({ subjects = [], topics = [], subjectId = "", topicId = "", newSubjectName = "", newTopicName = "" }) {
  const typedTopic = sessionClean(newTopicName);
  const typedSubject = sessionClean(newSubjectName);
  const fail = (error) => ({ ok: false, error });

  let resolvedSubjectId = "";
  let subjectName = "";
  let resolvedTopicId = "";
  let topicName = "";

  const chosenTopic = topicId && topicId !== SESSION_NEW ? topics.find((topic) => topic.id === topicId) : null;
  if (topicId && topicId !== SESSION_NEW && !chosenTopic) return fail("O assunto escolhido não existe mais.");

  if (subjectId === SESSION_NEW) {
    if (!typedSubject) return fail("Escreva o nome da nova matéria.");
    const same = subjects.find((subject) => hojeNorm(subject.name) === hojeNorm(typedSubject));
    if (same) resolvedSubjectId = same.id;
    else subjectName = typedSubject;
  } else if (chosenTopic && !typedTopic) {
    resolvedSubjectId = chosenTopic.subjectId;
  } else if (subjectId) {
    if (!subjects.some((subject) => subject.id === subjectId)) return fail("A matéria escolhida não existe mais.");
    resolvedSubjectId = subjectId;
  } else {
    return fail("Escolha a matéria estudada.");
  }

  if (typedTopic) {
    const same = resolvedSubjectId ? topics.find((topic) => topic.subjectId === resolvedSubjectId && hojeNorm(topic.name) === hojeNorm(typedTopic)) : null;
    if (same) resolvedTopicId = same.id;
    else topicName = typedTopic;
  } else if (topicId === SESSION_NEW) {
    return fail("Escreva o nome do novo assunto.");
  } else if (chosenTopic) {
    resolvedTopicId = chosenTopic.id;
  }

  return { ok: true, subjectId: resolvedSubjectId, subjectName, topicId: resolvedTopicId, topicName };
}

/* ------------------------------------------------------------------ */
/* Criação de matéria e assunto na hora                                */
/* ------------------------------------------------------------------ */

function sessionNextColor() {
  const presets = typeof $$ === "function" ? $$("[data-subject-color]").map((button) => button.dataset.subjectColor).filter(Boolean) : [];
  const palette = presets.length ? presets : SESSION_FALLBACK_COLORS;
  return palette[state.subjects.length % palette.length];
}

function sessionDefaultGoal() {
  const goal = Number(typeof $ === "function" ? $("#subjectGoal")?.defaultValue : 0);
  return Number.isFinite(goal) && goal > 0 ? goal : 5;
}

/** Cria o que o resolvedor pediu. Quem chama salva o estado. */
function sessionCommitTarget(target) {
  let subjectId = target.subjectId;
  if (target.subjectName) {
    subjectId = uid();
    state.subjects.push({ id: subjectId, name: target.subjectName, color: sessionNextColor(), goalHours: sessionDefaultGoal() });
  }
  let topicId = target.topicId;
  if (target.topicName) {
    topicId = uid();
    state.topics.push({ id: topicId, subjectId, name: target.topicName, priority: "Média" });
  }
  return { subjectId, topicId, createdSubject: Boolean(target.subjectName), createdTopic: Boolean(target.topicName) };
}

/** Para os formulários com campo "assunto novo" digitado: devolve matéria e assunto já criados. */
function sessionApplyTypedTopic(subjectId, typedName) {
  const target = sessionResolveTarget({ subjects: state.subjects, topics: state.topics, subjectId, newTopicName: typedName });
  if (!target.ok) return target;
  const done = sessionCommitTarget(target);
  return { ok: true, subjectId: done.subjectId, topicId: done.topicId, createdTopic: done.createdTopic };
}

/* ------------------------------------------------------------------ */
/* Sessões aguardando destino (guardadas neste aparelho)               */
/* ------------------------------------------------------------------ */

function sessionStoreKey() {
  return `${SESSION_STORE_PREFIX}${state?.profile?.id || "default"}`;
}

function sessionPendingRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(sessionStoreKey()) || "[]");
    return (Array.isArray(raw) ? raw : [])
      .filter((item) => item && item.id && Number(item.minutes) >= 1)
      .map((item) => ({
        id: String(item.id),
        minutes: Math.min(600, Math.round(Number(item.minutes))),
        date: cycleIsISO(item.date) ? item.date : cycleToday(),
        endedAt: String(item.endedAt || ""),
        cycle: Number(item.cycle) || 0,
        subjectId: String(item.subjectId || ""),
        topicId: String(item.topicId || ""),
        competitionId: String(item.competitionId || ""),
        source: String(item.source || "Pomodoro"),
        note: String(item.note || ""),
      }));
  } catch {
    return [];
  }
}

function sessionPendingWrite(list) {
  try {
    if (list.length) localStorage.setItem(sessionStoreKey(), JSON.stringify(list.slice(-SESSION_MAX_PENDING)));
    else localStorage.removeItem(sessionStoreKey());
  } catch {
    /* sem armazenamento: a sessão não fica guardada, mas o fluxo continua */
  }
}

/**
 * Chamado pelo Pomodoro quando um foco termina. Retorna true se a sessão ficou aguardando
 * a escolha de matéria e assunto (e false se deve ser salva direto, como antes).
 */
function sessionAskBeforeSave(entry) {
  const ask = !state?.cycleSettings || state.cycleSettings.askAtSave !== false;
  if (!ask && entry.subjectId) return false;
  const list = sessionPendingRead();
  list.push({
    id: entry.id,
    minutes: entry.minutes,
    date: entry.date,
    endedAt: new Date().toISOString(),
    cycle: entry.cycle || 0,
    subjectId: entry.subjectId || "",
    topicId: entry.topicId || "",
    competitionId: entry.competitionId || "",
    source: entry.source || "Pomodoro",
    note: entry.note || "",
  });
  sessionPendingWrite(list);
  cycleUI.sessionModalOpen = true;
  try {
    renderSessionUI();
  } catch (error) {
    console.error("Sessão (janela):", error);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Janela "O que você estudou?"                                        */
/* ------------------------------------------------------------------ */

function sessionRefreshTopics(selectedTopicId = "") {
  const subjectId = $("#ssSubject").value;
  const topics = subjectId && subjectId !== SESSION_NEW ? state.topics.filter((topic) => topic.subjectId === subjectId) : [];
  $("#ssTopic").innerHTML =
    `<option value="">Sem assunto específico</option>` +
    topics.map((topic) => `<option value="${topic.id}">${escapeHTML(topic.name)}</option>`).join("") +
    `<option value="${SESSION_NEW}">+ Novo assunto…</option>`;
  const valid = selectedTopicId === SESSION_NEW || topics.some((topic) => topic.id === selectedTopicId);
  $("#ssTopic").value = valid ? selectedTopicId : "";
  sessionToggleNewFields();
}

function sessionToggleNewFields() {
  $("#ssNewSubjectLabel").classList.toggle("hidden", $("#ssSubject").value !== SESSION_NEW);
  $("#ssNewTopicLabel").classList.toggle("hidden", $("#ssTopic").value !== SESSION_NEW);
}

function sessionFillForm(item, queue) {
  const last = cycleUI.sessionLast || {};
  let subjectId = item.subjectId;
  let topicId = item.topicId;
  if (!subjectId) {
    subjectId = last.subjectId || "";
    topicId = last.topicId || "";
  }
  if (!state.subjects.some((subject) => subject.id === subjectId)) {
    subjectId = "";
    topicId = "";
  }
  $("#ssSubject").innerHTML =
    `<option value="">Escolha a matéria</option>` +
    state.subjects.map((subject) => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join("") +
    `<option value="${SESSION_NEW}">+ Nova matéria…</option>`;
  $("#ssSubject").value = subjectId || (state.subjects.length ? "" : SESSION_NEW);
  sessionRefreshTopics(topicId);
  $("#ssNewSubject").value = "";
  $("#ssNewTopic").value = "";
  $("#ssMinutes").value = item.minutes;
  $("#ssNote").value = item.note;
  $("#sessionModalEyebrow").textContent = queue > 1 ? `Sessão 1 de ${queue}` : "Foco concluído";
  const when = item.endedAt ? new Date(item.endedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  $("#sessionSummary").textContent = `${item.minutes} min de foco${item.cycle ? ` (ciclo ${item.cycle})` : ""} · ${formatDate(item.date)}${when ? ` às ${when}` : ""}. Diga o que você estudou para o tempo contar nos seus números.`;
}

function renderSessionModal() {
  const modal = $("#sessionModal");
  if (!modal) return;
  const list = sessionPendingRead();
  const authenticated = typeof isProfileAuthenticated === "function" && isProfileAuthenticated();
  if (authenticated && list.length && !cycleUI.sessionAutoOpened) {
    cycleUI.sessionAutoOpened = true;
    cycleUI.sessionModalOpen = true;
  }
  const open = authenticated && list.length > 0 && cycleUI.sessionModalOpen;
  const wasOpen = !modal.classList.contains("hidden");
  const returnFocus = document.activeElement;
  modal.classList.toggle("hidden", !open);
  document.body.classList.toggle("modal-open", open);
  if (!open) {
    cycleUI.sessionItemId = "";
    if (wasOpen) modalClose(modal);
    return;
  }
  if (!wasOpen) modalOpen(modal, { returnFocus });
  const item = list[0];
  // O contador acompanha a fila (um novo foco pode terminar com a janela aberta) sem refazer o formulário.
  $("#sessionModalEyebrow").textContent = list.length > 1 ? `Sessão 1 de ${list.length}` : "Foco concluído";
  if (cycleUI.sessionItemId === item.id) return; // já preenchida: não apaga o que a pessoa digitou
  cycleUI.sessionItemId = item.id;
  sessionFillForm(item, list.length);
  window.setTimeout(() => ($("#ssSubject").value ? $("#ssMinutes") : $("#ssSubject")).focus(), 30);
}

function renderSessionBar() {
  const bar = $("#sessionBar");
  if (!bar) return;
  const count = sessionPendingRead().length;
  const authenticated = typeof isProfileAuthenticated === "function" && isProfileAuthenticated();
  const show = authenticated && count > 0 && !cycleUI.sessionModalOpen;
  bar.classList.toggle("hidden", !show);
  if (!show) return;
  bar.innerHTML = `
    <div><strong>Sessão para salvar:</strong> ${cyclePlural(count, "foco concluído", "focos concluídos")} ainda sem destino. Diga o que você estudou para o tempo contar.</div>
    <div class="inline-actions"><button class="button primary" data-cycle-action="sessionOpen" type="button">Escolher o que estudei</button></div>`;
}

function renderSessionUI() {
  const ask = $("#askAtSave");
  if (ask) ask.checked = state.cycleSettings.askAtSave !== false;
  renderSessionModal();
  renderSessionBar();
}

function sessionSubmit() {
  const list = sessionPendingRead();
  const item = list[0];
  if (!item) return;
  const minutes = Math.round(Number($("#ssMinutes").value));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
    showToast("Informe de 1 a 600 minutos.");
    return;
  }
  const subjectChoice = $("#ssSubject").value;
  const topicChoice = $("#ssTopic").value;
  const target = sessionResolveTarget({
    subjects: state.subjects,
    topics: state.topics,
    subjectId: subjectChoice,
    topicId: topicChoice,
    newSubjectName: subjectChoice === SESSION_NEW ? $("#ssNewSubject").value : "",
    newTopicName: topicChoice === SESSION_NEW ? $("#ssNewTopic").value : "",
  });
  if (!target.ok) {
    showToast(target.error);
    return;
  }
  const done = sessionCommitTarget(target);
  state.studyLogs.push({
    id: uid(),
    subjectId: done.subjectId,
    topicId: done.topicId,
    competitionId: item.competitionId,
    minutes,
    date: item.date,
    source: item.source,
    note: sessionClean($("#ssNote").value).slice(0, 200),
    createdAt: new Date().toISOString(),
  });
  const rest = list.slice(1);
  sessionPendingWrite(rest);
  cycleUI.sessionLast = { subjectId: done.subjectId, topicId: done.topicId };
  cycleUI.sessionItemId = "";
  if (!rest.length) cycleUI.sessionModalOpen = false;
  saveState();
  render();
  const label = done.topicId ? getTopicLabel(done.topicId) : getSubject(done.subjectId)?.name || "";
  const created = [done.createdSubject ? "matéria" : "", done.createdTopic ? "assunto" : ""].filter(Boolean).join(" e ");
  showToast(`${minutes} min salvos em ${label}.${created ? ` Criamos ${created === "matéria e assunto" ? "a matéria e o assunto" : created === "matéria" ? "a matéria" : "o assunto"} para você.` : ""}${rest.length ? ` Faltam ${cyclePlural(rest.length, "sessão", "sessões")}.` : ""}`);
}

function handleSessionAction(type) {
  if (type === "sessionLater") {
    cycleUI.sessionModalOpen = false;
    renderSessionUI();
    return true;
  }
  if (type === "sessionOpen") {
    cycleUI.sessionModalOpen = true;
    cycleUI.sessionItemId = "";
    renderSessionUI();
    return true;
  }
  if (type === "sessionDiscard") {
    const list = sessionPendingRead();
    if (!list.length || !window.confirm(`Descartar esta sessão de ${list[0].minutes} min? O tempo não será registrado.`)) return true;
    sessionPendingWrite(list.slice(1));
    cycleUI.sessionItemId = "";
    if (list.length === 1) cycleUI.sessionModalOpen = false;
    renderSessionUI();
    showToast("Sessão descartada.");
    return true;
  }
  return false;
}

function bindSessionEvents() {
  $("#sessionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sessionSubmit();
  });
  $("#ssSubject").addEventListener("change", () => {
    sessionRefreshTopics("");
    if ($("#ssSubject").value === SESSION_NEW) $("#ssNewSubject").focus();
  });
  $("#ssTopic").addEventListener("change", () => {
    sessionToggleNewFields();
    if ($("#ssTopic").value === SESSION_NEW) $("#ssNewTopic").focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#sessionModal").classList.contains("hidden")) handleSessionAction("sessionLater");
  });
  const ask = $("#askAtSave");
  if (ask) {
    ask.addEventListener("change", () => {
      state.cycleSettings.askAtSave = ask.checked;
      saveState();
      showToast(ask.checked ? "Vou perguntar o que você estudou ao terminar cada foco." : "Os focos serão salvos direto com a matéria e o assunto escolhidos antes de iniciar.");
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { sessionClean, sessionResolveTarget };
}
