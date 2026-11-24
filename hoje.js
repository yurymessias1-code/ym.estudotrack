/*
 * Tela Hoje, plano semanal por matéria, reforço automático por desempenho,
 * lembrete semanal de backup e menu móvel.
 * Carregado depois do ciclo.js e antes do app.js. Usa os helpers do ciclo.js e o
 * estado global (`state`) apenas em tempo de execução.
 */

const CYCLE_DAY_STAGES = ["rev", "flash", "err", "law", "study"];
const CYCLE_STAGE_LABELS = { rev: "revisões", flash: "flashcards", err: "caderno de erros", law: "lei seca", study: "estudo do dia" };
const CYCLE_WEAK_WINDOW_DAYS = 45;
const CYCLE_BACKUP_KEY_PREFIX = "ymEstudos.cycleBackup.";
const CYCLE_REASON_TIPS = {
  conhecimento: "Volte à teoria dos assuntos em que mais erra e faça um resumo curto antes de resolver novas questões.",
  literalidade: "Priorize a leitura da lei seca dos artigos cobrados: a banca cobra o texto da lei.",
  interpretacao: "Sublinhe palavras como \"sempre\", \"somente\" e \"exceto\" antes de olhar as alternativas.",
  atencao: "Releia o comando da questão antes de marcar e treine com blocos curtos e cronometrados.",
  confusao: "Monte um quadro comparativo de prazos e institutos parecidos e revise-o antes dos simulados.",
  jurisprudencia: "Revise súmulas e teses por tema, com um flashcard para cada uma.",
  chute: "Só marque quando conseguir eliminar alternativas; anote o tema e estude-o antes da próxima rodada.",
  tempo: "Treine em blocos cronometrados e comece pelas questões mais fáceis.",
};

/* ------------------------------------------------------------------ */
/* Lógica pura                                                         */
/* ------------------------------------------------------------------ */

function hojeNorm(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cycleDiffDays(fromISO, toISO) {
  return Math.round((cycleDate(toISO) - cycleDate(fromISO)) / 86400000);
}

/** Segunda-feira da semana de `iso`. */
function weekStartISO(iso) {
  const day = cycleDate(iso).getDay();
  return cycleAddDays(iso, -((day + 6) % 7));
}

function weekRound5(value) {
  return Math.round(value / 5) * 5;
}

function weekCeil5(value) {
  return Math.ceil(value / 5) * 5;
}

/**
 * Conta assuntos do edital por matéria cadastrada (casando pelo nome).
 * Igualdade vence; senão, só aceita correspondência parcial se for inequívoca.
 */
function weightsFromEdital(items, subjects) {
  const counts = {};
  const subjectKeys = subjects.map((subject) => ({ id: subject.id, key: hojeNorm(subject.name) }));
  (items || []).forEach((item) => {
    const key = hojeNorm(item.subjectName);
    if (!key) return;
    let match = subjectKeys.find((subject) => subject.key === key);
    if (!match) {
      const partial = subjectKeys.filter((subject) => subject.key.length >= 4 && key.length >= 4 && (subject.key.includes(key) || key.includes(subject.key)));
      if (partial.length === 1) match = partial[0];
    }
    if (match) counts[match.id] = (counts[match.id] || 0) + 1;
  });
  return counts;
}

/**
 * Plano semanal: divide a meta de minutos entre as matérias pelo peso e sugere
 * quanto estudar hoje, redistribuindo o que falta pelos dias de estudo restantes.
 * A meta de hoje parte do que faltava no início do dia (não encolhe enquanto você estuda).
 */
function buildWeeklyPlan({ subjects, weights, weeklyMinutes, weekdays, minutesWeek = {}, minutesToday = {}, today }) {
  const start = weekStartISO(today);
  const studyDays = [];
  for (let i = 0; i < 7; i += 1) {
    const day = cycleAddDays(start, i);
    if (weekdays.includes(cycleDate(day).getDay())) studyDays.push(day);
  }
  const daysLeft = studyDays.filter((day) => day >= today).length;
  const todayIsStudyDay = studyDays.includes(today);
  const totalWeight = subjects.reduce((sum, subject) => sum + Math.max(0, Number(weights[subject.id]) || 0), 0);

  const rows = subjects.map((subject) => {
    const weight = Math.max(0, Number(weights[subject.id]) || 0);
    const targetMin = totalWeight && weight > 0 ? weekRound5((weeklyMinutes * weight) / totalWeight) : 0;
    const doneMin = Math.round(minutesWeek[subject.id] || 0);
    const todayDone = Math.round(minutesToday[subject.id] || 0);
    const remaining = Math.max(0, targetMin - doneMin);
    const remainingAtStart = Math.max(0, targetMin - Math.max(0, doneMin - todayDone));
    const rawTarget = todayIsStudyDay && daysLeft > 0 ? weekCeil5(remainingAtStart / daysLeft) : 0;
    const todayTarget = Math.min(rawTarget, remainingAtStart);
    return {
      subjectId: subject.id,
      name: subject.name,
      weight,
      share: totalWeight && weight > 0 ? (weight / totalWeight) * 100 : 0,
      targetMin,
      doneMin,
      remaining,
      todayTarget,
      todayDone,
      todayPending: Math.max(0, todayTarget - todayDone),
    };
  });
  rows.sort((a, b) => Number(b.weight > 0) - Number(a.weight > 0) || b.remaining - a.remaining || a.name.localeCompare(b.name));

  return {
    weekStart: start,
    weekEnd: cycleAddDays(start, 6),
    studyDays,
    daysLeft,
    todayIsStudyDay,
    rows,
    totalTarget: rows.reduce((sum, row) => sum + row.targetMin, 0),
    totalDone: rows.reduce((sum, row) => sum + Math.min(row.doneMin, row.targetMin), 0),
    totalRemaining: rows.reduce((sum, row) => sum + row.remaining, 0),
    todayTotal: rows.reduce((sum, row) => sum + row.todayTarget, 0),
  };
}

/** Acerto por assunto nos últimos `windowDays` dias. */
function cycleTopicAccuracy(logs, today, windowDays = CYCLE_WEAK_WINDOW_DAYS) {
  const since = cycleAddDays(today, -windowDays);
  const byTopic = new Map();
  logs.forEach((log) => {
    if (!log.topicId || !cycleIsISO(log.date) || log.date < since) return;
    const group = byTopic.get(log.topicId) || { topicId: log.topicId, subjectId: log.subjectId || "", total: 0, correct: 0 };
    const correct = Number(log.correct) || 0;
    const wrong = Number(log.wrong) || 0;
    group.total += correct + wrong;
    group.correct += correct;
    if (!group.subjectId && log.subjectId) group.subjectId = log.subjectId;
    byTopic.set(log.topicId, group);
  });
  return [...byTopic.values()].map((group) => ({ ...group, accuracy: group.total ? (group.correct / group.total) * 100 : 100 }));
}

function cycleWeakTopics(logs, today, { threshold, minQuestions }) {
  return cycleTopicAccuracy(logs, today)
    .filter((group) => group.total >= minQuestions && group.accuracy < threshold)
    .sort((a, b) => a.accuracy - b.accuracy);
}

/**
 * Assuntos que precisam de um novo reforço: abaixo da meta de acerto, sem reforço pendente
 * e, se já houve reforço antes, só depois de novas questões que continuem abaixo da meta.
 */
function cycleWeakCandidates({ logs, revisions, today, threshold, minQuestions }) {
  const needNew = Math.max(5, Math.ceil(minQuestions / 2));
  return cycleWeakTopics(logs, today, { threshold, minQuestions }).filter((group) => {
    const weakRevisions = revisions.filter((revision) => revision.kind === "weak" && revision.topicId === group.topicId);
    if (weakRevisions.some((revision) => revision.status === "pending")) return false;
    const last = weakRevisions.map((revision) => revision.baseDate).sort().pop();
    if (!last) return true;
    let total = 0;
    let correct = 0;
    logs
      .filter((log) => log.topicId === group.topicId && cycleIsISO(log.date) && log.date > last)
      .forEach((log) => {
        correct += Number(log.correct) || 0;
        total += (Number(log.correct) || 0) + (Number(log.wrong) || 0);
      });
    return total >= needNew && (correct / total) * 100 < threshold;
  });
}

/** Motivo de erro que domina os últimos 60 dias, se houver erros suficientes. */
function cycleReasonInsight(errors, today, { windowDays = 60, minErrors = 6, minShare = 35 } = {}) {
  const since = cycleAddDays(today, -windowDays);
  const recent = errors.filter((entry) => cycleIsISO(entry.date) && entry.date >= since);
  if (recent.length < minErrors) return null;
  const counts = {};
  recent.forEach((entry) => {
    counts[entry.reason] = (counts[entry.reason] || 0) + 1;
  });
  const [reason, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const share = Math.round((count / recent.length) * 100);
  return share >= minShare ? { reason, count, total: recent.length, share } : null;
}

function cycleDayProgress(done, total) {
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Lembrete de backup: vence a cada `days` dias desde o último backup. Sem backup, só cobra
 * depois de `days` dias de conta; adiado (snooze) esconde até o fim do dia indicado.
 */
function cycleBackupStatus({ last, snooze, today, days, hasData, created }) {
  if (!days || !hasData) return { due: false, never: !last, since: null };
  if (snooze && snooze >= today) return { due: false, never: !last, since: last ? cycleDiffDays(last, today) : null };
  if (!last) {
    const age = created && cycleIsISO(created) ? cycleDiffDays(created, today) : days;
    return { due: age >= days, never: true, since: null };
  }
  const since = cycleDiffDays(last, today);
  return { due: since >= days, never: false, since };
}

/* ------------------------------------------------------------------ */
/* Backup (por dispositivo)                                            */
/* ------------------------------------------------------------------ */

function backupStoreKey() {
  return `${CYCLE_BACKUP_KEY_PREFIX}${state?.profile?.id || "default"}`;
}

function backupRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(backupStoreKey()) || "{}");
    return { last: cycleIsISO(raw.last) ? raw.last : "", snooze: cycleIsISO(raw.snooze) ? raw.snooze : "" };
  } catch {
    return { last: "", snooze: "" };
  }
}

function backupWrite(data) {
  try {
    localStorage.setItem(backupStoreKey(), JSON.stringify(data));
  } catch {
    /* sem armazenamento: o lembrete apenas não é lembrado */
  }
}

/** Chamado por downloadBackupFile() e exportData() no app.js. */
function cycleMarkBackup() {
  const store = backupRead();
  store.last = cycleToday();
  store.snooze = "";
  backupWrite(store);
  try {
    renderCycle();
  } catch {
    /* a tela é atualizada no próximo render */
  }
}

function backupIsDue() {
  try {
    const store = backupRead();
    return cycleBackupStatus({
      last: store.last,
      snooze: store.snooze,
      today: cycleToday(),
      days: state.cycleSettings.backupDays,
      hasData: typeof stateHasMeaningfulData === "function" ? stateHasMeaningfulData(state) : true,
      created: (state.profile?.createdAt || "").slice(0, 10),
    });
  } catch {
    return { due: false, never: false, since: null };
  }
}

/* ------------------------------------------------------------------ */
/* Dados do dia                                                        */
/* ------------------------------------------------------------------ */

function getFlashDueList() {
  if (typeof flashcardIsDue !== "function") return [];
  return state.flashcards.filter((card) => flashcardIsDue(card));
}

function getFlashDueCount() {
  try {
    return getFlashDueList().length;
  } catch {
    return 0;
  }
}

function effectiveWeights() {
  const explicit = state.cycleSettings.weights || {};
  const fromEdital = weightsFromEdital(state.edital?.items || [], state.subjects);
  const weights = {};
  state.subjects.forEach((subject) => {
    if (Object.prototype.hasOwnProperty.call(explicit, subject.id)) weights[subject.id] = explicit[subject.id];
    else weights[subject.id] = fromEdital[subject.id] > 0 ? fromEdital[subject.id] : 1;
  });
  return weights;
}

function getWeeklyPlanData() {
  const today = cycleToday();
  const start = weekStartISO(today);
  const end = cycleAddDays(start, 6);
  const minutesWeek = {};
  const minutesToday = {};
  state.studyLogs.forEach((log) => {
    if (!cycleIsISO(log.date) || log.date < start || log.date > end) return;
    const id = getEntrySubjectId(log);
    if (!id) return;
    const minutes = Number(log.minutes) || 0;
    minutesWeek[id] = (minutesWeek[id] || 0) + minutes;
    if (log.date === today) minutesToday[id] = (minutesToday[id] || 0) + minutes;
  });
  return buildWeeklyPlan({
    subjects: state.subjects.map((subject) => ({ id: subject.id, name: subject.name })),
    weights: effectiveWeights(),
    weeklyMinutes: Math.round((Number(state.edital?.weeklyHours) || 15) * 60),
    weekdays: state.cycleSettings.studyWeekdays,
    minutesWeek,
    minutesToday,
    today,
  });
}

function getTodayData(summary = getCycleSummary()) {
  const today = cycleToday();
  const dueRevisions = getDueRevisions(today);
  const dueErrors = getDueErrors(today); // já vem com os reincidentes primeiro
  const revDone = state.revisions.reduce((sum, revision) => sum + revision.history.filter((entry) => entry.date === today).length, 0);
  const errDone = state.errorNotebook.filter((entry) => entry.lastReviewed === today).length;
  const lawItems = summary.laws
    .filter(({ info }) => !info.finished && info.todayIsReading)
    .map(({ plan, info }) => ({ plan, info, done: info.readToday >= info.todayTarget }));
  const week = getWeeklyPlanData();
  const studyItems = week.rows.filter((row) => row.todayTarget > 0);
  const studyDone = studyItems.filter((row) => row.todayPending === 0).length;
  const lawDone = lawItems.filter((item) => item.done).length;
  const flashItems = getFlashDueList();
  const today_ = today;
  const flashDone = state.flashcards.filter((card) => card.lastReviewed === today_).length;
  const flash = { done: flashDone, pending: flashItems.length, items: flashItems };
  const rev = { done: revDone, pending: dueRevisions.length, items: dueRevisions };
  const err = { done: errDone, pending: dueErrors.length, items: dueErrors };
  const law = { done: lawDone, pending: lawItems.length - lawDone, items: lawItems };
  const study = { done: studyDone, pending: studyItems.length - studyDone, items: studyItems };
  const total = rev.done + rev.pending + flash.done + flash.pending + err.done + err.pending + lawItems.length + studyItems.length;
  const done = rev.done + flash.done + err.done + lawDone + studyDone;
  return { today, summary, week, rev, flash, err, law, study, progress: cycleDayProgress(done, total), pending: rev.pending + flash.pending + err.pending + law.pending + study.pending };
}

function getTodayInsights(data) {
  const insights = [];
  const settings = state.cycleSettings;
  const weak = cycleWeakTopics(state.questionLogs, data.today, { threshold: settings.weakAccuracy, minQuestions: settings.weakMinQuestions }).slice(0, 3);
  weak.forEach((group) => {
    const topic = getTopic(group.topicId);
    if (!topic) return;
    const reinforcement = state.revisions.find((revision) => revision.kind === "weak" && revision.topicId === group.topicId && revision.status === "pending");
    insights.push({
      tone: "bad",
      title: `${getTopicLabel(group.topicId)}: ${Math.round(group.accuracy)}% de acerto`,
      text: `${cyclePlural(group.total, "questão", "questões")} nos últimos ${CYCLE_WEAK_WINDOW_DAYS} dias, abaixo da meta de ${settings.weakAccuracy}%. ${reinforcement ? "Há um reforço de revisão agendado." : "Resolva mais questões do tema: um novo reforço entra se o acerto continuar baixo."}`,
      actions: [
        reinforcement && reinforcement.dueDate <= data.today ? { label: "Revisar agora", action: "openRevision", id: reinforcement.id } : null,
        { label: "Ver erros do tema", action: "goErrors", subject: group.subjectId || topic.subjectId },
      ].filter(Boolean),
    });
  });
  const reason = cycleReasonInsight(state.errorNotebook, data.today);
  if (reason) {
    insights.push({
      tone: "warn",
      title: `Você erra ${reason.share}% por "${ERROR_REASONS[reason.reason]}"`,
      text: `${reason.count} de ${reason.total} erros dos últimos 60 dias. ${CYCLE_REASON_TIPS[reason.reason] || ""}`,
      actions: [{ label: "Ver esses erros", action: "goErrors", reason: reason.reason }],
    });
  }
  const tomorrow = cycleAddDays(data.today, 1);
  const tomorrowCount = state.revisions.filter((revision) => revision.status === "pending" && revision.dueDate === tomorrow).length;
  if (tomorrowCount) {
    const heavy = tomorrowCount > settings.dailyLimit;
    insights.push({
      tone: heavy ? "warn" : "good",
      title: `Amanhã: ${cyclePlural(tomorrowCount, "revisão", "revisões")}`,
      text: heavy ? `Acima do seu limite de ${settings.dailyLimit} por dia. Reserve mais tempo ou ajuste o limite na aba Revisão.` : "Carga tranquila para amanhã.",
      actions: [],
    });
  }
  return insights;
}

/* ------------------------------------------------------------------ */
/* Reforço automático por desempenho                                   */
/* ------------------------------------------------------------------ */

function syncWeakRevisions() {
  ensureCycleState();
  const settings = state.cycleSettings;
  if (!settings.autoWeak) return [];
  const today = cycleToday();
  const created = [];
  cycleWeakCandidates({
    logs: state.questionLogs,
    revisions: state.revisions,
    today,
    threshold: settings.weakAccuracy,
    minQuestions: settings.weakMinQuestions,
  }).forEach((group) => {
    const topic = getTopic(group.topicId);
    if (!topic || !getSubject(topic.subjectId)) return;
    createRevision({
      kind: "weak",
      subjectId: topic.subjectId,
      topicId: group.topicId,
      originKey: `weak:${group.topicId}:${today}`,
      baseDate: today,
      dueDate: today,
    });
    created.push({ topicId: group.topicId, accuracy: group.accuracy, total: group.total });
  });
  return created;
}

/* ------------------------------------------------------------------ */
/* Renderização                                                        */
/* ------------------------------------------------------------------ */

function todayEnsureStartView() {
  if (cycleUI.startViewDone) return false;
  if (typeof isProfileAuthenticated !== "function" || !isProfileAuthenticated()) return false;
  cycleUI.startViewDone = true;
  if (state.ui.view !== "hoje") {
    setView("hoje");
    return true;
  }
  return false;
}

function renderTodayModule(summary) {
  const data = getTodayData(summary);
  cycleUI.todayData = data;
  renderTodayNav(data);
  const view = state.ui.view;
  if (view === "hoje") renderToday(data);
  if (view === "semana") renderWeek(data.week);
}

function renderTodayNav(data) {
  const counts = { hoje: data.pending, revisao: data.summary.revDue, erros: data.summary.errorsDue, leiseca: data.law.pending, flashcards: data.flash.pending };
  $$("[data-nav-count]").forEach((element) => {
    const count = counts[element.dataset.navCount] || 0;
    element.textContent = count > 99 ? "99+" : String(count);
    element.classList.toggle("hidden", !count);
  });
  const primary = ["hoje", "revisao", "questoes", "erros"];
  $$(".bottom-nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === state.ui.view));
  $("#menuToggleBtn")?.classList.toggle("active", !primary.includes(state.ui.view) || $("#sidebarSheet")?.classList.contains("open"));
}

function todayCard({ title, done, total, body, actions = "", muted = false, wide = false }) {
  const status = total ? `${done} de ${total}` : "";
  const finished = total > 0 && done >= total;
  return `
    <article class="today-card ${muted ? "muted" : ""} ${finished ? "finished" : ""} ${wide ? "wide" : ""}">
      <header>
        <h3>${escapeHTML(title)}</h3>
        ${status ? `<span class="tag ${finished ? "tone-good" : ""}">${finished ? "Feito" : escapeHTML(status)}</span>` : ""}
      </header>
      ${body}
      ${actions ? `<div class="inline-actions">${actions}</div>` : ""}
    </article>`;
}

function renderToday(data) {
  const now = new Date();
  const dateText = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  $("#todayDate").textContent = dateText.charAt(0).toUpperCase() + dateText.slice(1);

  const subtitle = [];
  const streak = typeof reportStreak === "function" ? reportStreak(state.studyLogs, data.today) : null;
  if (streak && streak.current > 0) subtitle.push(`Sequência de ${cyclePlural(streak.current, "dia", "dias")}${streak.studiedToday ? "" : " (estude hoje para mantê-la)"}`);
  const exam = state.edital?.examDate;
  if (cycleIsISO(exam)) {
    const left = cycleDiffDays(data.today, exam);
    if (left >= 0) subtitle.push(`${left === 0 ? "A prova é hoje" : `Faltam ${cyclePlural(left, "dia", "dias")} para a prova`}`);
  }
  subtitle.push(data.pending ? `${cyclePlural(data.pending, "tarefa pendente", "tarefas pendentes")}` : data.progress.total ? "Tudo feito por hoje" : "Nada agendado para hoje");
  $("#todaySub").textContent = subtitle.join(" · ");
  $("#todayPct").textContent = `${data.progress.pct}%`;
  $("#todayCount").textContent = data.progress.total ? `${data.progress.done} de ${data.progress.total} tarefas` : "sem tarefas";
  $("#todayBar").style.setProperty("--progress", `${data.progress.pct}%`);
  const start = $("#startDayBtn");
  start.textContent = !data.pending ? "Dia concluído" : cycleUI.dayFlow ? "Continuar o dia" : "Começar o dia";
  start.disabled = !data.pending;

  renderTodayBackup();
  renderQuickStudy(data);

  const cards = [];

  // revisões
  const revItems = data.rev.items.slice(0, 4);
  cards.push(
    todayCard({
      title: "Revisões",
      done: data.rev.done,
      total: data.rev.done + data.rev.pending,
      muted: !data.rev.done && !data.rev.pending,
      body: revItems.length
        ? `<ul class="today-list">${revItems
            .map((revision) => {
              const late = cycleDiffDays(revision.dueDate, data.today);
              return `<li>${escapeHTML(revisionLabel(revision))} <small>${revisionStageLabel(revision)}${late > 0 ? ` · atrasada ${late}d` : ""}</small></li>`;
            })
            .join("")}${data.rev.items.length > 4 ? `<li class="more">+ ${data.rev.items.length - 4} outras</li>` : ""}</ul>`
        : `<p class="muted-note">${data.rev.done ? "Revisões de hoje concluídas." : "Nenhuma revisão para hoje. Estude um assunto por 10 minutos ou mais e a trilha começa sozinha."}</p>`,
      actions: data.rev.pending ? `<button class="button primary" data-cycle-action="reviewNow" type="button">Revisar agora</button>` : `<button class="mini-button" data-view="revisao" type="button">Abrir Revisão</button>`,
    })
  );

  // flashcards
  const flashItems = data.flash.items.slice(0, 3);
  cards.push(
    todayCard({
      title: "Flashcards",
      done: data.flash.done,
      total: data.flash.done + data.flash.pending,
      muted: !data.flash.done && !data.flash.pending,
      body: flashItems.length
        ? `<ul class="today-list">${flashItems.map((card) => `<li>${escapeHTML(cycleExcerpt(richTextToPlain(card.front), 90))}</li>`).join("")}${data.flash.items.length > 3 ? `<li class="more">+ ${data.flash.items.length - 3} outros</li>` : ""}</ul>`
        : `<p class="muted-note">${data.flash.done ? "Flashcards de hoje revisados." : state.flashcards.length ? "Nenhum flashcard para revisar agora." : "Crie flashcards (ou gere a partir dos seus erros) para revisar aqui."}</p>`,
      actions: data.flash.pending ? `<button class="button primary" data-cycle-action="goFlashcards" type="button">Revisar flashcards</button>` : `<button class="mini-button" data-view="flashcards" type="button">Abrir flashcards</button>`,
    })
  );

  // erros
  const errItems = data.err.items.slice(0, 3);
  cards.push(
    todayCard({
      title: "Caderno de erros",
      done: data.err.done,
      total: data.err.done + data.err.pending,
      muted: !data.err.done && !data.err.pending,
      body: errItems.length
        ? `<ul class="today-list">${errItems.map((entry) => `<li>${escapeHTML(typeof errorExcerpt === "function" ? errorExcerpt(entry, 80) : cycleExcerpt(entry.statement, 80))} <small>${escapeHTML(ERROR_REASONS[entry.reason])}</small></li>`).join("")}${data.err.items.length > 3 ? `<li class="more">+ ${data.err.items.length - 3} outros</li>` : ""}</ul>`
        : `<p class="muted-note">${data.err.done ? "Erros de hoje refeitos." : "Nenhum erro para refazer hoje."}</p>`,
      actions: data.err.pending ? `<button class="button primary" data-cycle-action="goErrors" data-status="due" type="button">Refazer erros</button>` : `<button class="mini-button" data-view="erros" type="button">Abrir caderno</button>`,
    })
  );

  // lei seca
  cards.push(
    todayCard({
      title: "Lei seca",
      done: data.law.done,
      total: data.law.items.length,
      muted: !data.law.items.length,
      body: data.law.items.length
        ? `<ul class="today-list">${data.law.items
            .map(
              ({ plan, info, done }) => `<li>
                <span>${escapeHTML(plan.title)}<br /><small>${done ? `meta cumprida (${info.readToday} ${escapeHTML(plan.unitLabel)})` : `${escapeHTML(info.todayLabel)}`}</small></span>
                ${done ? "" : `<button class="mini-button success" data-cycle-action="lawDone" data-id="${plan.id}" type="button">Concluí</button>`}
              </li>`
            )
            .join("")}</ul>`
        : `<p class="muted-note">${state.lawPlans.length ? "Sem leitura marcada para hoje." : "Crie um plano de leitura para receber a meta diária."}</p>`,
      actions: `<button class="mini-button" data-view="leiseca" type="button">${state.lawPlans.length ? "Abrir cronograma" : "Criar plano"}</button>`,
    })
  );

  // estudo do dia
  const studyItems = data.study.items;
  cards.push(
    todayCard({
      title: "Estudo do dia",
      wide: true,
      done: data.study.done,
      total: studyItems.length,
      muted: !studyItems.length,
      body: studyItems.length
        ? `<ul class="today-list">${studyItems
            .map((row) => {
              const pct = Math.min(100, row.todayTarget ? (row.todayDone / row.todayTarget) * 100 : 0);
              return `<li class="study-row">
                <span>${escapeHTML(row.name)}<br /><small>${formatMinutes(Math.min(row.todayDone, row.todayTarget))} de ${formatMinutes(row.todayTarget)}</small>
                <span class="progress-track mini"><span class="progress-fill" style="--progress:${pct}%"></span></span></span>
                ${row.todayPending ? `<span class="row-actions"><button class="mini-button success" data-cycle-action="studySubject" data-id="${row.subjectId}" type="button">Estudar</button><button class="mini-button" data-cycle-action="quickStudy" data-id="${row.subjectId}" data-min="${row.todayPending}" type="button">Registrar</button></span>` : ""}
              </li>`;
            })
            .join("")}</ul>`
        : state.subjects.length
          ? `<p class="muted-note">${data.week.todayIsStudyDay ? "Meta de hoje cumprida ou sem matérias com peso." : "Hoje não é dia de estudo no seu plano semanal."}</p>`
          : `<p class="muted-note">Cadastre suas matérias para montar o plano semanal.</p>`,
      actions: `<button class="mini-button" data-view="semana" type="button">Plano semanal</button>`,
    })
  );

  $("#todayTasks").innerHTML = cards.join("");

  const insights = getTodayInsights(data);
  $("#todayInsights").innerHTML = insights.length
    ? insights
        .map(
          (insight) => `
            <article class="insight-card tone-${insight.tone}">
              <strong>${escapeHTML(insight.title)}</strong>
              <p>${escapeHTML(insight.text)}</p>
              ${insight.actions.length ? `<div class="inline-actions">${insight.actions
                .map(
                  (action) =>
                    `<button class="mini-button" data-cycle-action="${action.action}" ${action.id ? `data-id="${action.id}"` : ""} ${action.subject ? `data-subject="${action.subject}"` : ""} ${action.reason ? `data-reason="${action.reason}"` : ""} type="button">${escapeHTML(action.label)}</button>`
                )
                .join("")}</div>` : ""}
            </article>`
        )
        .join("")
    : `<div class="empty-state">Sem alertas por enquanto. Registre questões e erros para o app apontar seus pontos fracos e agendar reforços sozinho.</div>`;
}

function renderTodayBackup() {
  const box = $("#todayBackup");
  if (!box) return;
  const status = backupIsDue();
  box.classList.toggle("hidden", !status.due);
  if (!status.due) return;
  const text = status.never
    ? "Você ainda não baixou nenhum backup deste perfil neste aparelho."
    : `Faz ${cyclePlural(status.since, "dia", "dias")} desde o último backup.`;
  box.innerHTML = `
    <div><strong>Backup semanal:</strong> ${escapeHTML(text)} É ele que protege seu histórico de revisão se o navegador for limpo ou você trocar de aparelho.</div>
    <div class="inline-actions">
      <button class="button primary" data-action="downloadBackup" type="button">Baixar backup agora</button>
      <button class="mini-button" data-cycle-action="snoozeBackup" type="button">Lembrar amanhã</button>
    </div>`;
}

function renderWeek(week) {
  const settings = state.cycleSettings;
  const form = $("#weekForm");
  const focused = form.contains(document.activeElement);
  if (!focused) {
    $("#weekHours").value = Number(state.edital?.weeklyHours) || 15;
    const picker = $("#weekDays");
    if (!picker.children.length) {
      picker.innerHTML = CYCLE_WEEKDAY_ORDER.map((day) => `<label class="checkbox-line"><input type="checkbox" name="weekStudyDay" value="${day}" /> ${CYCLE_WEEKDAY_LABELS[day]}</label>`).join("");
    }
    $$("input[name='weekStudyDay']").forEach((input) => {
      input.checked = settings.studyWeekdays.includes(Number(input.value));
    });
  }

  $("#weekStats").innerHTML = [
    cycleStat("Meta da semana", formatMinutes(week.totalTarget), `${formatShortDate(week.weekStart)} a ${formatShortDate(week.weekEnd)}`),
    cycleStat("Já estudado", formatMinutes(week.totalDone), week.totalTarget ? `${percent((week.totalDone / week.totalTarget) * 100)} da meta` : "sem meta definida"),
    cycleStat("Falta", formatMinutes(week.totalRemaining), week.daysLeft ? `${cyclePlural(week.daysLeft, "dia de estudo", "dias de estudo")} restante(s)` : "sem dias de estudo restantes"),
    cycleStat("Hoje", formatMinutes(week.todayTotal), week.todayIsStudyDay ? "sugestão do plano" : "dia de folga"),
  ].join("");

  const table = $("#weekTable");
  if (!state.subjects.length) {
    table.innerHTML = `<div class="empty-state">Cadastre suas matérias na aba Matérias para montar o plano semanal.</div>`;
    return;
  }
  const hasEdital = (state.edital?.items || []).length > 0;
  table.innerHTML = `
    <div class="table-wrap">
      <table class="week-table">
        <thead><tr><th>Matéria</th><th>Peso</th><th>Parcela</th><th>Meta</th><th>Feito</th><th>Hoje</th></tr></thead>
        <tbody>
          ${week.rows
            .map((row) => {
              const pct = row.targetMin ? Math.min(100, (row.doneMin / row.targetMin) * 100) : 0;
              const subject = getSubject(row.subjectId);
              return `<tr class="${row.weight ? "" : "off"}">
                <td><strong>${escapeHTML(row.name)}</strong><span class="progress-track mini"><span class="progress-fill" style="--progress:${pct}%; --fill:${subject?.color || "var(--teal)"}"></span></span></td>
                <td><input class="week-weight" type="number" min="0" max="200" step="1" value="${row.weight}" data-week-weight="${row.subjectId}" aria-label="Peso de ${escapeHTML(row.name)}" /></td>
                <td>${row.weight ? percent(row.share) : "fora"}</td>
                <td>${formatMinutes(row.targetMin)}</td>
                <td>${formatMinutes(row.doneMin)}</td>
                <td>${row.todayTarget ? `${formatMinutes(row.todayDone)} / ${formatMinutes(row.todayTarget)}` : "–"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="muted-note">Peso 0 tira a matéria do plano. ${hasEdital ? "Use os pesos do edital para dar mais tempo às matérias com mais assuntos." : "Importe o edital para sugerir os pesos pelo número de assuntos de cada matéria."}</p>`;
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function todayStudy(subjectId) {
  setView("pomodoro", { scrollTop: true });
  const select = $("#timerSubject");
  if (select && subjectId && state.subjects.some((subject) => subject.id === subjectId)) {
    select.value = subjectId;
    if (typeof syncScopedTopicSelect === "function") syncScopedTopicSelect("#timerSubject", "#timerTopic");
  }
}

function todayGoToStage(stage, data) {
  if (stage === "rev") {
    cycleUI.sessionId = "";
    setView("revisao", { scrollTop: true });
    cycleStartSession();
  } else if (stage === "flash") {
    todayOpenFlashcards();
  } else if (stage === "err") {
    cycleUI.errorFilters = { search: "", subject: "", topic: "", reason: "", status: "due" };
    const first = data.err.items[0];
    cycleUI.errorRetest = { id: first ? first.id : "", open: false };
    setView("erros", { scrollTop: true });
  } else if (stage === "law") {
    setView("leiseca", { scrollTop: true });
  } else if (stage === "study") {
    const row = data.study.items.find((item) => item.todayPending > 0);
    todayStudy(row ? row.subjectId : "");
  }
}

function todayPendingByStage(data) {
  return { rev: data.rev.pending, flash: data.flash.pending, err: data.err.pending, law: data.law.pending, study: data.study.pending };
}

function todayOpenFlashcards() {
  state.ui.flashcardReviewQueue = "today";
  state.ui.flashcardReviewScope = "all";
  state.ui.activeFlashcardId = "";
  state.ui.flashcardAnswerOpen = false;
  setView("flashcards", { scrollTop: true });
}

/* ---------- registro rápido de estudo ---------- */

function renderQuickStudy(data) {
  const form = $("#quickStudyForm");
  if (!form) return;
  const open = Boolean(cycleUI.quickStudyOpen);
  form.classList.toggle("hidden", !open);
  if (!open) return;
  const prefill = cycleUI.quickStudy || {};
  const subjectSelect = $("#qsSubject");
  const keepSubject = subjectSelect.value;
  populateSubjectSelect(subjectSelect);
  const firstPending = data.study.items.find((row) => row.todayPending > 0);
  const wanted = prefill.subjectId || (state.subjects.some((subject) => subject.id === keepSubject) ? keepSubject : "") || (firstPending ? firstPending.subjectId : "");
  if (wanted && state.subjects.some((subject) => subject.id === wanted)) subjectSelect.value = wanted;
  populateTopicSelect($("#qsTopic"), { includeEmpty: true, subjectId: subjectSelect.value, emptyLabel: "Sem assunto específico" });
  $("#qsTopic").disabled = !state.topics.some((topic) => topic.subjectId === subjectSelect.value);
  if (prefill.minutes) $("#qsMinutes").value = Math.min(600, Math.max(1, Math.round(prefill.minutes)));
  cycleUI.quickStudy = { ...prefill, subjectId: "", minutes: 0 };
}

/** Chamado depois de concluir uma tarefa; no "Começar o dia", leva à próxima etapa. */
function todayAfterAction(stage) {
  if (!cycleUI.dayFlow) return;
  const data = getTodayData();
  const pending = todayPendingByStage(data);
  if (pending[stage] > 0) {
    if (stage === "err") {
      cycleUI.errorRetest = { id: data.err.items[0].id, open: false };
      renderCycle();
    }
    return;
  }
  const next = CYCLE_DAY_STAGES.find((item) => item !== stage && pending[item] > 0);
  if (next) {
    showToast(`Concluído: ${CYCLE_STAGE_LABELS[stage]}. Próxima etapa: ${CYCLE_STAGE_LABELS[next]}.`);
    todayGoToStage(next, data);
  } else {
    cycleUI.dayFlow = false;
    showToast("Dia concluído. Bom trabalho!");
    setView("hoje", { scrollTop: true });
  }
}

function todayToggleMenu(force) {
  const sheet = $("#sidebarSheet");
  if (!sheet) return;
  const open = typeof force === "boolean" ? force : !sheet.classList.contains("open");
  sheet.classList.toggle("open", open);
  document.body.classList.toggle("menu-open", open);
  const button = $("#menuToggleBtn");
  if (button) {
    button.setAttribute("aria-expanded", String(open));
    const label = button.querySelector("span");
    if (label) label.textContent = open ? "Fechar" : "Mais";
    button.classList.toggle("active", open || !["hoje", "revisao", "questoes", "erros"].includes(state.ui.view));
  }
}

function handleTodayAction(type, button) {
  const id = button.dataset.id || "";
  if (type === "goFlashcards") {
    todayOpenFlashcards();
    return true;
  }
  if (type === "quickStudy") {
    if (!state.subjects.length) {
      showToast("Cadastre uma matéria primeiro (aba Matérias).");
      return true;
    }
    cycleUI.quickStudyOpen = true;
    cycleUI.quickStudy = { subjectId: id, minutes: Number(button.dataset.min) || 0 };
    if (state.ui.view !== "hoje") setView("hoje", { scrollTop: true });
    else renderCycle();
    window.setTimeout(() => {
      $("#quickStudyForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
      $("#qsMinutes")?.focus();
    }, 60);
    return true;
  }
  if (type === "quickStudyClose") {
    cycleUI.quickStudyOpen = false;
    renderCycle();
    return true;
  }
  if (type === "qsMinutes") {
    $("#qsMinutes").value = button.dataset.min;
    return true;
  }
  if (type === "toggleMenu") {
    todayToggleMenu();
    return true;
  }
  if (type === "startDay") {
    const data = getTodayData();
    const stage = CYCLE_DAY_STAGES.find((item) => todayPendingByStage(data)[item] > 0);
    if (!stage) {
      showToast("Nada pendente para hoje.");
      return true;
    }
    cycleUI.dayFlow = true;
    todayGoToStage(stage, data);
    return true;
  }
  if (type === "goErrors") {
    cycleUI.errorFilters = { search: "", subject: button.dataset.subject || "", topic: button.dataset.topic || "", reason: button.dataset.reason || "", status: button.dataset.status || "pending" };
    cycleUI.errorRetest = { id: "", open: false };
    setView("erros", { scrollTop: true });
    return true;
  }
  if (type === "studySubject") {
    todayStudy(id);
    return true;
  }
  if (type === "snoozeBackup") {
    const store = backupRead();
    store.snooze = cycleToday();
    backupWrite(store);
    renderCycle();
    showToast("Ok, o lembrete volta amanhã.");
    return true;
  }
  if (type === "weekImport") {
    const items = state.edital?.items || [];
    if (!items.length) {
      showToast("Importe o edital na aba Edital primeiro.");
      return true;
    }
    const counts = weightsFromEdital(items, state.subjects);
    const weights = { ...state.cycleSettings.weights };
    let matched = 0;
    state.subjects.forEach((subject) => {
      weights[subject.id] = counts[subject.id] || 0;
      if (counts[subject.id]) matched += 1;
    });
    state.cycleSettings.weights = normalizeWeights(weights);
    cycleRefresh();
    const unmatched = state.subjects.length - matched;
    showToast(unmatched ? `Pesos importados para ${matched} matérias. ${cyclePlural(unmatched, "matéria ficou", "matérias ficaram")} sem peso (nome diferente do edital): ajuste na tabela.` : `Pesos importados do edital para ${matched} matérias.`);
    return true;
  }
  if (type === "weekReset") {
    state.cycleSettings.weights = {};
    cycleRefresh();
    showToast("Pesos redefinidos: edital quando houver, senão peso igual.");
    return true;
  }
  return false;
}

function bindTodayEvents() {
  document.addEventListener("click", (event) => {
    if (event.target.closest(".sidebar .nav-button, .bottom-nav-item[data-view]")) {
      todayToggleMenu(false);
      window.scrollTo(0, 0);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") todayToggleMenu(false);
  });
  window.matchMedia("(min-width: 1121px)").addEventListener("change", (event) => {
    if (event.matches) todayToggleMenu(false);
  });

  $("#qsSubject").addEventListener("change", () => {
    populateTopicSelect($("#qsTopic"), { includeEmpty: true, subjectId: $("#qsSubject").value, emptyLabel: "Sem assunto específico" });
    $("#qsTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#qsSubject").value);
  });

  $("#quickStudyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const subjectId = $("#qsSubject").value;
    const minutes = Math.round(Number($("#qsMinutes").value));
    if (!subjectId || !state.subjects.some((subject) => subject.id === subjectId)) {
      showToast("Escolha a matéria estudada.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
      showToast("Informe de 1 a 600 minutos.");
      return;
    }
    let topicId = $("#qsTopic").value;
    const typedTopic = $("#qsNewTopic")?.value || "";
    if (typedTopic.trim() && typeof sessionApplyTypedTopic === "function") {
      const applied = sessionApplyTypedTopic(subjectId, typedTopic);
      if (!applied.ok) {
        showToast(applied.error);
        return;
      }
      topicId = applied.topicId;
      $("#qsNewTopic").value = "";
    }
    state.studyLogs.push({
      id: uid(),
      subjectId: getTopic(topicId)?.subjectId || subjectId,
      topicId,
      competitionId: "",
      minutes,
      date: cycleToday(),
      source: "Manual",
      note: "Registro rápido (Hoje)",
      createdAt: new Date().toISOString(),
    });
    cycleUI.quickStudyOpen = false;
    saveState();
    render();
    showToast(minutes >= CYCLE_MIN_AUTO_MINUTES ? `${minutes} min registrados. A trilha de revisão deste assunto começa sozinha.` : `${minutes} min registrados. Revisões automáticas começam a partir de ${CYCLE_MIN_AUTO_MINUTES} min por assunto no dia.`);
  });

  $("#weekTable").addEventListener("change", (event) => {
    const input = event.target.closest("[data-week-weight]");
    if (!input) return;
    const weights = { ...state.cycleSettings.weights, ...effectiveWeights() };
    weights[input.dataset.weekWeight] = Number(input.value) || 0;
    state.cycleSettings.weights = normalizeWeights(weights);
    cycleRefresh();
  });

  $("#weekForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const hours = Number($("#weekHours").value);
    const days = $$("input[name='weekStudyDay']:checked").map((input) => Number(input.value));
    if (!Number.isFinite(hours) || hours < 1 || hours > 80) {
      showToast("Informe de 1 a 80 horas por semana.");
      return;
    }
    if (!days.length) {
      showToast("Marque ao menos um dia de estudo.");
      return;
    }
    state.edital.weeklyHours = Math.round(hours * 2) / 2;
    state.cycleSettings.studyWeekdays = normalizeStudyWeekdays(days);
    cycleRefresh();
    showToast("Plano semanal salvo.");
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    weekStartISO,
    weightsFromEdital,
    buildWeeklyPlan,
    cycleTopicAccuracy,
    cycleWeakTopics,
    cycleWeakCandidates,
    cycleReasonInsight,
    cycleDayProgress,
    cycleBackupStatus,
    cycleDiffDays,
  };
}
