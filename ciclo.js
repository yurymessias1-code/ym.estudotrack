/*
 * Ciclo de estudos: revisão espaçada, caderno de erros e cronograma de lei seca.
 * Carregado ANTES do app.js. Usa o estado global (`state`) e os helpers do app.js
 * apenas em tempo de execução (dentro das funções), então a ordem de carga é segura.
 */

const CYCLE_DEFAULT_INTERVALS = [1, 7, 30, 60];
const CYCLE_DEFAULT_ERROR_INTERVALS = [1, 3, 7, 15, 30];
const CYCLE_LAPSE_DROP = 2; // errar/esquecer faz descer só esta quantidade de etapas (não volta ao começo)
const CYCLE_LEECH_LAPSES = 3; // errou de novo tantas vezes: vira reincidente
const CYCLE_MIN_AUTO_MINUTES = 20; // padrão: estudo mais curto que isso não abre cadeia de revisões (ajustável)
const CYCLE_STEADY_WINDOW_DAYS = 14;
const CYCLE_OBJECTIVE_DAYS = 30; // janela das questões que servem de nota objetiva
const CYCLE_OBJECTIVE_MIN = 5; // questões mínimas para sugerir ou ajustar a nota
const CYCLE_OBJECTIVE_EASY_MIN = 8; // e para aceitar "Fácil"
const CYCLE_RESULT_ORDER = ["forgot", "hard", "ok", "easy"];
const CYCLE_DUP_MIN_WORDS = 6; // enunciados com menos palavras não são comparados por semelhança
const CYCLE_DUP_SIMILARITY = 0.7; // palavras em comum sobre o total para considerar o mesmo enunciado
const CYCLE_REDISTRIBUTE_MIN = 3; // só oferece "redistribuir atrasados" a partir de tantos atrasados
const CYCLE_BACKFILL_DAYS = 14;
const CYCLE_WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const CYCLE_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const CYCLE_DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const CYCLE_RESULT_LABELS = { forgot: "Esqueci", hard: "Difícil", ok: "Bom", easy: "Fácil" };
const ERROR_REASONS = {
  conhecimento: "Não sabia o conteúdo",
  literalidade: "Literalidade da lei",
  interpretacao: "Interpretação do enunciado",
  atencao: "Falta de atenção",
  confusao: "Confundi institutos ou prazos",
  jurisprudencia: "Jurisprudência / súmula",
  chute: "Chutei",
  tempo: "Tempo / cansaço",
};

// Estado só de interface (não persiste entre recarregamentos).
const cycleUI = {
  sessionId: "",
  revealed: false,
  recall: "",
  errorEditId: "",
  errorPrefill: null,
  errorForceMerge: "",
  quickUndo: null,
  errorRetest: { id: "", open: false },
  errorFilters: { search: "", subject: "", topic: "", reason: "", status: "all" },
  errorFormOpen: false,
  errorNavOpen: {},
  lawEditId: "",
  lawSchedule: {},
  bannerHidden: false,
  badgeCount: 0,
  installPrompt: null,
  quickStudyOpen: false,
  quickStudy: {},
  pushDigestHash: "",
  pushEnsured: false,
  sessionModalOpen: false,
  sessionItemId: "",
  sessionAutoOpened: false,
  sessionLast: {},
};

/* ------------------------------------------------------------------ */
/* Datas e utilitários independentes do app.js                         */
/* ------------------------------------------------------------------ */

function cycleDate(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function cycleISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function cycleAddDays(iso, days) {
  const date = cycleDate(iso);
  date.setDate(date.getDate() + days);
  return cycleISO(date);
}

function cycleToday() {
  return cycleISO(new Date());
}

function cycleIsISO(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function cycleUid() {
  const random = globalThis.crypto?.randomUUID;
  return typeof random === "function" ? random.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cycleIsTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function cycleText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cycleInt(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Dias de a até b (negativo se b for antes de a). */
function cycleDaysBetween(a, b) {
  return Math.round((cycleDate(b) - cycleDate(a)) / 86400000);
}

function cyclePlural(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function cycleWeekdayShort(iso) {
  return cycleDate(iso).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

/* ------------------------------------------------------------------ */
/* Normalização (chamada pelo normalizeState do app.js)                */
/* ------------------------------------------------------------------ */

function normalizeCycleIntervals(value, fallback) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  const list = raw.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 1 && n <= 365);
  return list.length ? list.slice(0, 8) : [...fallback];
}

function normalizeWeights(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([key, value]) => {
    const id = String(key || "").trim();
    const number = Number(value);
    if (id && Number.isFinite(number)) out[id] = Math.min(200, Math.max(0, Math.round(number)));
  });
  return out;
}

function normalizeStudyWeekdays(raw) {
  const days = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  return days.length ? days : [...CYCLE_DEFAULT_WEEKDAYS];
}

function normalizeCycleSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    intervals: normalizeCycleIntervals(source.intervals, CYCLE_DEFAULT_INTERVALS),
    errorIntervals: normalizeCycleIntervals(source.errorIntervals, CYCLE_DEFAULT_ERROR_INTERVALS),
    autoFromStudy: source.autoFromStudy !== false,
    autoSince: cycleIsISO(source.autoSince) ? source.autoSince : cycleToday(),
    reminderTime: cycleIsTime(source.reminderTime) ? source.reminderTime : "08:00",
    eveningTime: cycleIsTime(source.eveningTime) ? source.eveningTime : "",
    dailyLimit: cycleInt(source.dailyLimit, 1, 200, 12),
    askAtSave: source.askAtSave !== false,
    examAdapt: source.examAdapt !== false,
    levelLoad: source.levelLoad !== false,
    capQueue: source.capQueue !== false,
    gradeFromQuestions: source.gradeFromQuestions !== false,
    minAutoMinutes: cycleInt(source.minAutoMinutes, 5, 120, CYCLE_MIN_AUTO_MINUTES),
    autoWeak: source.autoWeak !== false,
    weakAccuracy: cycleInt(source.weakAccuracy, 30, 95, 70),
    weakMinQuestions: cycleInt(source.weakMinQuestions, 5, 100, 10),
    backupDays: source.backupDays === 0 || source.backupDays === "0" ? 0 : cycleInt(source.backupDays, 0, 90, 7),
    studyWeekdays: normalizeStudyWeekdays(source.studyWeekdays),
    weights: normalizeWeights(source.weights),
  };
}

function normalizeRevision(item = {}) {
  const validResults = Object.keys(CYCLE_RESULT_LABELS);
  const history = Array.isArray(item.history) ? item.history : [];
  return {
    id: item.id || cycleUid(),
    kind: ["study", "manual", "law", "weak"].includes(item.kind) ? item.kind : "manual",
    subjectId: cycleText(item.subjectId),
    topicId: cycleText(item.topicId),
    label: cycleText(item.label),
    originKey: cycleText(item.originKey),
    // Dias de estudo que entraram nesta cadeia em vez de abrir uma nova (ver syncAutoRevisions).
    absorbedKeys: (Array.isArray(item.absorbedKeys) ? item.absorbedKeys : []).map(cycleText).filter(Boolean).slice(-60),
    baseDate: cycleIsISO(item.baseDate) ? item.baseDate : cycleToday(),
    stage: cycleInt(item.stage, 0, 20, 0),
    dueDate: cycleIsISO(item.dueDate) ? item.dueDate : cycleToday(),
    status: item.status === "done" ? "done" : "pending",
    lawPlanId: cycleText(item.lawPlanId),
    lawFromWork: Number.isFinite(Number(item.lawFromWork)) && item.lawFromWork !== null && item.lawFromWork !== "" ? Number(item.lawFromWork) : null,
    lawToWork: Number.isFinite(Number(item.lawToWork)) && item.lawToWork !== null && item.lawToWork !== "" ? Number(item.lawToWork) : null,
    history: history.slice(-30).map((entry) => ({
      date: cycleIsISO(entry?.date) ? entry.date : "",
      stage: cycleInt(entry?.stage, 0, 20, 0),
      result: validResults.includes(entry?.result) ? entry.result : "ok",
      note: cycleText(entry?.note).slice(0, 500),
      ...(validResults.includes(entry?.self) ? { self: entry.self } : {}), // nota que a pessoa marcou, quando o app registrou outra
    })),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || "",
  };
}

function cycleErrorImages(list) {
  // Só metadados dos prints; os arquivos ficam no IndexedDB (ver caderno.js).
  return (Array.isArray(list) ? list : [])
    .map((image) => ({ id: cycleText(image?.id).replace(/[^\w-]/g, ""), w: cycleInt(image?.w, 0, 20000, 0), h: cycleInt(image?.h, 0, 20000, 0) }))
    .filter((image) => image.id)
    .slice(0, 12);
}

function normalizeErrorEntry(item = {}) {
  const date = cycleIsISO(item.date) ? item.date : cycleToday();
  // Não ler `state` aqui: este normalizador roda durante `let state = loadState()` (zona morta).
  const firstGap = CYCLE_DEFAULT_ERROR_INTERVALS[0];
  const reason = Object.prototype.hasOwnProperty.call(ERROR_REASONS, item.reason) ? item.reason : "conhecimento";
  const mastered = Boolean(item.mastered);
  return {
    id: item.id || cycleUid(),
    subjectId: cycleText(item.subjectId),
    topicId: cycleText(item.topicId),
    date,
    source: cycleText(item.source),
    statement: cycleText(item.statement),
    myAnswer: cycleText(item.myAnswer),
    correctAnswer: cycleText(item.correctAnswer),
    images: cycleErrorImages(item.images),
    answerImages: cycleErrorImages(item.answerImages),
    notes: typeof erroNotesSanitize === "function" ? erroNotesSanitize(item.notes) : "",
    reason,
    foundation: cycleText(item.foundation),
    rule: cycleText(item.rule),
    tags: typeof normalizeHashtags === "function" ? normalizeHashtags(item.tags) : [],
    stage: cycleInt(item.stage, 0, 20, 0),
    dueDate: mastered ? "" : cycleIsISO(item.dueDate) ? item.dueDate : cycleAddDays(date, firstGap),
    attempts: cycleInt(item.attempts, 0, 9999, 0),
    lapses: cycleInt(item.lapses, 0, 9999, 0),
    lastResult: ["ok", "wrong", "hard", "easy"].includes(item.lastResult) ? item.lastResult : "",
    lastReviewed: cycleIsISO(item.lastReviewed) ? item.lastReviewed : "",
    mastered,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || "",
  };
}

function normalizeLawPlan(item = {}) {
  const startUnit = cycleInt(item.startUnit, 1, 99999, 1);
  const endUnit = Math.max(startUnit, cycleInt(item.endUnit, 1, 99999, startUnit));
  const passes = cycleInt(item.passes, 1, 10, 1);
  const total = (endUnit - startUnit + 1) * passes;
  const startDate = cycleIsISO(item.startDate) ? item.startDate : cycleToday();
  let endDate = cycleIsISO(item.endDate) ? item.endDate : cycleAddDays(startDate, 30);
  if (endDate < startDate) endDate = startDate;
  const weekdays = [...new Set((Array.isArray(item.weekdays) ? item.weekdays : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  const readLog = (Array.isArray(item.readLog) ? item.readLog : [])
    .map((entry) => ({
      id: entry?.id || cycleUid(),
      date: cycleIsISO(entry?.date) ? entry.date : cycleToday(),
      fromWork: cycleInt(entry?.fromWork, 0, total, 0),
      toWork: cycleInt(entry?.toWork, 0, total, 0),
    }))
    .filter((entry) => entry.toWork > entry.fromWork)
    .slice(-400);
  return {
    id: item.id || cycleUid(),
    title: cycleText(item.title) || "Plano de leitura",
    subjectId: cycleText(item.subjectId),
    unitLabel: cycleText(item.unitLabel) || "artigos",
    url: cycleText(item.url),
    startUnit,
    endUnit,
    passes,
    startDate,
    endDate,
    weekdays: weekdays.length ? weekdays : [...CYCLE_DEFAULT_WEEKDAYS],
    doneWork: cycleInt(item.doneWork, 0, total, 0),
    readLog,
    scheduleRevisions: item.scheduleRevisions !== false,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || "",
  };
}

function ensureCycleState() {
  if (!state) return;
  if (!Array.isArray(state.revisions)) state.revisions = [];
  if (!Array.isArray(state.errorNotebook)) state.errorNotebook = [];
  if (!Array.isArray(state.lawPlans)) state.lawPlans = [];
  if (!state.cycleSettings || typeof state.cycleSettings !== "object") state.cycleSettings = normalizeCycleSettings();
}

/* ------------------------------------------------------------------ */
/* Lógica pura: revisão espaçada                                       */
/* ------------------------------------------------------------------ */

/**
 * Próximo passo de uma revisão.
 * result: "forgot" volta ao início; "hard" repete a etapa com metade do intervalo;
 * "ok" avança; "easy" avança com intervalo 50% maior. Passando da última etapa, encerra.
 */
function cycleReviewStep(stage, result, intervals) {
  const last = intervals.length;
  if (result === "forgot") {
    // Esquecer não apaga o progresso todo: desce CYCLE_LAPSE_DROP etapas (um item de 30 dias não volta para 1 dia).
    const dropped = Math.max(0, Math.min(stage, last - 1) - CYCLE_LAPSE_DROP);
    return { done: false, stage: dropped, gap: intervals[dropped] };
  }
  if (result === "hard") {
    const base = intervals[Math.min(stage, last - 1)];
    return { done: false, stage, gap: Math.max(1, Math.ceil(base / 2)) };
  }
  const next = stage + 1;
  if (next >= last) return { done: true, stage: last, gap: 0 };
  let gap = intervals[next];
  if (result === "easy") gap = Math.round(gap * 1.5);
  return { done: false, stage: next, gap };
}

/**
 * Data da prova mais próxima (a partir de amanhã) que vale para a matéria. Concurso sem matérias marcadas
 * vale para todas. Devolve "" se não houver nenhuma prova futura.
 */
function cycleNextExamDate(subjectId, today = cycleToday()) {
  const dates = ((typeof state !== "undefined" && state.competitions) || [])
    .filter((competition) => cycleIsISO(competition.date) && competition.date > today)
    .filter((competition) => !competition.subjectIds?.length || !subjectId || competition.subjectIds.includes(subjectId))
    .map((competition) => competition.date)
    .sort();
  return dates[0] || "";
}

/**
 * Perto da prova os intervalos encurtam: a próxima revisão cai, no máximo, na metade do tempo que falta
 * (assim há revisão na véspera e nada é agendado para depois da prova; com 1 dia sobrando, cai no dia da prova).
 */
function cycleCapGapForExam(gap, today, examDate) {
  if (!examDate || !cycleIsISO(examDate) || examDate <= today) return gap;
  const daysLeft = Math.round((cycleDate(examDate) - cycleDate(today)) / 86400000);
  return Math.min(gap, Math.max(1, Math.floor(daysLeft / 2)));
}

/** cycleReviewStep + ajuste pela data da prova (se a opção estiver ligada). */
function cycleScheduledStep(stage, result, intervals, subjectId = "", today = cycleToday()) {
  const step = cycleReviewStep(stage, result, intervals);
  if (step.done || (typeof state !== "undefined" && state.cycleSettings?.examAdapt === false)) return step;
  const examDate = cycleNextExamDate(subjectId, today);
  const gap = cycleCapGapForExam(step.gap, today, examDate);
  return gap === step.gap ? step : { ...step, gap, examDate };
}

/**
 * Carga do dia: quantos itens (revisões abertas e erros não dominados) vencem em cada dia, de hoje em diante.
 * `exclude` tira da conta o item que está sendo reagendado.
 */
function cycleLoadByDate(revisions, errors, today, exclude = {}) {
  const load = {};
  (revisions || []).forEach((revision) => {
    if (revision.status !== "pending" || !revision.dueDate || revision.dueDate < today || revision.id === exclude.revisionId) return;
    load[revision.dueDate] = (load[revision.dueDate] || 0) + 1;
  });
  (errors || []).forEach((entry) => {
    if (entry.mastered || !entry.dueDate || entry.dueDate < today || entry.id === exclude.errorId) return;
    load[entry.dueDate] = (load[entry.dueDate] || 0) + 1;
  });
  return load;
}

/** Quanto o dia pode andar para mais ou para menos: nada nos intervalos curtos, 1 dia até 2 semanas, 2 dias depois. */
function cycleLevelRadius(gap) {
  return gap <= 2 ? 0 : gap <= 14 ? 1 : 2;
}

/**
 * Escolhe, perto do dia previsto, o dia mais vazio. Só troca se o outro dia tiver menos itens;
 * em empate, fica o mais perto do previsto (e, se igual, o mais cedo). `maxGap` impede passar do limite.
 */
function cycleLevelGap(gap, load, today, { maxGap = Infinity, limit = Infinity } = {}) {
  const loadOf = (candidate) => load[cycleAddDays(today, candidate)] || 0;
  const top = (extra) => Math.min(gap + extra, Math.max(gap, maxGap));
  let best = gap;
  const radius = cycleLevelRadius(gap);
  if (radius) {
    for (let candidate = Math.max(1, gap - radius); candidate <= top(radius); candidate += 1) {
      const better = loadOf(candidate) < loadOf(best);
      const sameLoadCloser = loadOf(candidate) === loadOf(best) && (Math.abs(candidate - gap) < Math.abs(best - gap) || (Math.abs(candidate - gap) === Math.abs(best - gap) && candidate < best));
      if (better || sameLoadCloser) best = candidate;
    }
  }
  // Capacidade: se até o melhor dia já está no limite, usa o primeiro dia seguinte com vaga (dentro da folga).
  if (Number.isFinite(limit) && loadOf(best) >= limit) {
    for (let candidate = best + 1; candidate <= top(cycleCapacitySlack(gap)); candidate += 1) if (loadOf(candidate) < limit) return candidate;
  }
  return best;
}

/** Quanto uma revisão pode escorregar para depois quando os dias estão cheios: pouco nos intervalos curtos. */
function cycleCapacitySlack(gap) {
  return gap <= 2 ? 2 : Math.min(10, Math.ceil(gap * 0.35));
}

/** O passo já ajustado pela prova passa pelo nivelamento da carga (se a opção estiver ligada). */
function cycleLeveledStep(step, today, exclude = {}) {
  if (step.done || (typeof state !== "undefined" && state.cycleSettings?.levelLoad === false)) return step;
  const load = cycleLoadByDate(state.revisions, state.errorNotebook, today, exclude);
  const gap = cycleLevelGap(step.gap, load, today, { maxGap: step.examDate ? step.gap : Infinity, limit: state.cycleSettings.dailyLimit });
  return gap === step.gap ? step : { ...step, gap, leveled: true };
}

/* ------------------------------------------------------------------ */
/* Lógica pura: cronograma de leitura de lei seca                      */
/* ------------------------------------------------------------------ */

function lawUnitsPerPass(plan) {
  return plan.endUnit - plan.startUnit + 1;
}

function lawTotalWork(plan) {
  return lawUnitsPerPass(plan) * plan.passes;
}

/** Converte um intervalo de trabalho [from, to) em trechos por leitura. */
function lawWorkSegments(plan, fromWork, toWork) {
  const per = lawUnitsPerPass(plan);
  const segments = [];
  let work = fromWork;
  while (work < toWork) {
    const offset = work % per;
    const take = Math.min(toWork - work, per - offset);
    segments.push({
      pass: Math.floor(work / per) + 1,
      from: plan.startUnit + offset,
      to: plan.startUnit + offset + take - 1,
      count: take,
    });
    work += take;
  }
  return segments;
}

function lawSegmentsLabel(plan, segments) {
  return segments
    .map((segment) => {
      const range = segment.from === segment.to ? `${segment.from}` : `${segment.from}–${segment.to}`;
      const text = `${plan.unitLabel} ${range}`;
      return plan.passes > 1 ? `${segment.pass}ª leitura: ${text}` : text;
    })
    .join(" + ");
}

function lawWorkLabel(plan, fromWork, toWork) {
  return lawSegmentsLabel(plan, lawWorkSegments(plan, fromWork, toWork));
}

function lawReadingDays(plan, fromISO, toISO) {
  const days = [];
  let cursor = fromISO;
  for (let guard = 0; cursor <= toISO && guard < 1500; guard += 1) {
    if (plan.weekdays.includes(cycleDate(cursor).getDay())) days.push(cursor);
    cursor = cycleAddDays(cursor, 1);
  }
  return days;
}

function lawDistribute(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

function lawNextReadingDay(plan, fromISO) {
  let cursor = fromISO;
  for (let guard = 0; guard < 14; guard += 1) {
    if (plan.weekdays.includes(cycleDate(cursor).getDay())) return cursor;
    cursor = cycleAddDays(cursor, 1);
  }
  return fromISO;
}

/**
 * Cronograma dinâmico: redistribui o que falta pelos dias de leitura restantes.
 * A meta de hoje parte do que faltava no início do dia, então não encolhe enquanto você lê.
 */
function buildLawSchedule(plan, today) {
  const total = lawTotalWork(plan);
  const done = plan.doneWork;
  const per = lawUnitsPerPass(plan);
  const readToday = plan.readLog.filter((entry) => entry.date === today).reduce((sum, entry) => sum + (entry.toWork - entry.fromWork), 0);
  const startOfToday = Math.max(0, done - readToday);
  const info = {
    total,
    done,
    remaining: total - done,
    pct: total ? (done / total) * 100 : 0,
    readToday,
    todayTarget: 0,
    todayIsReading: false,
    todayLabel: "",
    rows: [],
    remainingDays: 0,
    pacePerDay: 0,
    delta: 0,
    status: "Em dia",
    tone: "good",
    finished: done >= total,
    overdue: false,
    notStarted: today < plan.startDate,
    currentPass: Math.min(plan.passes, Math.floor(done / per) + 1),
  };

  // Posição frente ao ritmo original (até ontem), para o selo de status.
  const originalDays = lawReadingDays(plan, plan.startDate, plan.endDate);
  const idealYesterday = originalDays.length ? Math.round((total * originalDays.filter((day) => day < today).length) / originalDays.length) : today > plan.endDate ? total : 0;
  info.delta = done - idealYesterday;

  if (info.finished) {
    info.status = "Concluído";
    info.tone = "good";
    return info;
  }

  const firstDay = today > plan.startDate ? today : plan.startDate;
  let days = lawReadingDays(plan, firstDay, plan.endDate);
  if (!days.length) {
    info.overdue = plan.endDate < today;
    days = [info.overdue ? today : lawNextReadingDay(plan, firstDay)];
  }
  info.remainingDays = days.length;
  info.pacePerDay = Math.ceil((total - done) / days.length);

  const makeRow = (date, fromWork, toWork) => ({
    date,
    fromWork,
    toWork,
    count: toWork - fromWork,
    label: lawWorkLabel(plan, fromWork, toWork),
    isToday: date === today,
  });

  const rows = [];
  if (days[0] === today) {
    info.todayIsReading = true;
    const todayAlloc = Math.ceil((total - startOfToday) / days.length);
    const todayEnd = Math.min(total, startOfToday + todayAlloc);
    rows.push(makeRow(today, startOfToday, todayEnd));
    let cursor = Math.max(done, todayEnd);
    const futureDays = days.slice(1);
    lawDistribute(total - cursor, futureDays.length).forEach((count, index) => {
      if (count > 0) rows.push(makeRow(futureDays[index], cursor, cursor + count));
      cursor += count;
    });
    info.todayTarget = rows[0].count;
    info.todayLabel = rows[0].label;
  } else {
    let cursor = done;
    lawDistribute(total - cursor, days.length).forEach((count, index) => {
      if (count > 0) rows.push(makeRow(days[index], cursor, cursor + count));
      cursor += count;
    });
  }
  info.rows = rows;

  if (today > plan.endDate) {
    info.status = "Prazo vencido";
    info.tone = "bad";
  } else if (info.delta < 0) {
    info.status = `${-info.delta} ${plan.unitLabel} atrasado`;
    info.tone = info.delta < -Math.max(5, Math.round(total * 0.05)) ? "bad" : "warn";
  } else if (info.notStarted) {
    info.status = "Ainda não começou";
    info.tone = "warn";
  } else {
    info.status = info.delta > 0 ? `${info.delta} ${plan.unitLabel} adiantado` : "Em dia";
    info.tone = "good";
  }
  return info;
}

function lawRegisterWork(plan, units, today) {
  const total = lawTotalWork(plan);
  const count = Math.min(Math.max(0, Math.floor(units)), total - plan.doneWork);
  if (!Number.isFinite(count) || count <= 0) return 0;
  plan.readLog.push({ id: cycleUid(), date: today, fromWork: plan.doneWork, toWork: plan.doneWork + count });
  plan.readLog = plan.readLog.slice(-400);
  plan.doneWork += count;
  plan.updatedAt = new Date().toISOString();
  return count;
}

/** "Li até o nº N" na leitura em andamento → quantas unidades isso representa. */
function lawUnitsFromPosition(plan, number) {
  const per = lawUnitsPerPass(plan);
  if (plan.doneWork >= lawTotalWork(plan)) return { error: "Este plano já foi concluído." };
  const target = Math.floor(Number(number)) - plan.startUnit + 1;
  if (!Number.isFinite(target) || target < 1 || target > per) {
    return { error: `Informe um número entre ${plan.startUnit} e ${plan.endUnit}.` };
  }
  const alreadyDone = plan.doneWork % per;
  if (target <= alreadyDone) return { error: `Você já registrou a leitura até ${plan.startUnit + alreadyDone - 1}.` };
  return { units: target - alreadyDone };
}

/* ------------------------------------------------------------------ */
/* Revisões: criação, agendamento automático e conclusão               */
/* ------------------------------------------------------------------ */

function revisionIntervals() {
  return state.cycleSettings.intervals;
}

/**
 * Primeira revisão de uma cadeia nova: vai para o dia previsto, mas se esse dia já está no limite
 * escorrega para o primeiro dia seguinte com vaga (sem passar da prova).
 */
function cycleCapacityDueDate(nominalDue, subjectId = "", today = cycleToday()) {
  if (state.cycleSettings.levelLoad === false || nominalDue <= today) return nominalDue;
  const gap = cycleDaysBetween(today, nominalDue);
  const examDate = state.cycleSettings.examAdapt === false ? "" : cycleNextExamDate(subjectId, today);
  const maxGap = examDate ? Math.max(gap, cycleDaysBetween(today, examDate) - 1) : Infinity;
  const load = cycleLoadByDate(state.revisions, state.errorNotebook, today);
  return cycleAddDays(today, cycleLevelGap(gap, load, today, { maxGap, limit: state.cycleSettings.dailyLimit }));
}

function createRevision(data) {
  const intervals = revisionIntervals();
  const baseDate = cycleIsISO(data.baseDate) ? data.baseDate : cycleToday();
  const nominalDue = cycleIsISO(data.dueDate) ? data.dueDate : cycleAddDays(baseDate, intervals[0]);
  const revision = normalizeRevision({
    ...data,
    baseDate,
    stage: 0,
    dueDate: cycleIsISO(data.dueDate) ? nominalDue : cycleCapacityDueDate(nominalDue, data.subjectId || ""),
    createdAt: new Date().toISOString(),
  });
  state.revisions.push(revision);
  return revision;
}

/** Abre uma cadeia de revisões por assunto estudado; estudar o mesmo assunto de novo reaproveita a cadeia aberta. */
function syncAutoRevisions(options = {}) {
  ensureCycleState();
  const settings = state.cycleSettings;
  if (!settings.autoFromStudy && !options.force) return 0;
  const since = options.since || settings.autoSince;
  const groups = new Map();
  state.studyLogs.forEach((log) => {
    if (!cycleIsISO(log.date) || log.date < since) return;
    const topic = log.topicId ? getTopic(log.topicId) : null;
    const subjectId = topic?.subjectId || log.subjectId || "";
    if (!subjectId || !getSubject(subjectId)) return;
    const topicId = topic ? topic.id : "";
    const key = `study:${topicId || subjectId}:${log.date}`;
    const group = groups.get(key) || { key, subjectId, topicId, date: log.date, minutes: 0 };
    group.minutes += Number(log.minutes) || 0;
    groups.set(key, group);
  });
  const known = new Set();
  state.revisions.forEach((revision) => {
    known.add(revision.originKey);
    (revision.absorbedKeys || []).forEach((key) => known.add(key));
  });
  let created = 0;
  // Do dia mais antigo para o mais novo: o primeiro estudo de um assunto abre a cadeia e os seguintes se juntam a ela.
  [...groups.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
    .forEach((group) => {
      if (known.has(group.key) || group.minutes < (settings.minAutoMinutes ?? CYCLE_MIN_AUTO_MINUTES)) return;
      const owner = cycleOpenStudyChain(state.revisions, group);
      if (owner) {
        // Estudar o mesmo assunto de novo não abre outra cadeia de revisões: a que está aberta continua valendo.
        owner.absorbedKeys = [...(owner.absorbedKeys || []), group.key].slice(-60);
        known.add(group.key);
        return;
      }
      createRevision({ kind: "study", subjectId: group.subjectId, topicId: group.topicId, originKey: group.key, baseDate: group.date });
      known.add(group.key);
      created += 1;
    });
  return created;
}

/** Cadeia de revisão por estudo ainda aberta para o mesmo assunto (ou matéria, quando não há assunto). */
function cycleOpenStudyChain(revisions, scope) {
  return (
    revisions.find(
      (revision) =>
        revision.kind === "study" &&
        revision.status === "pending" &&
        (scope.topicId ? revision.topicId === scope.topicId : !revision.topicId && revision.subjectId === scope.subjectId)
    ) || null
  );
}

/**
 * Para quem já tem várias cadeias abertas do mesmo assunto (uma por dia estudado): mantém a mais
 * avançada de cada assunto e junta as outras nela. Função pura: devolve o plano, não altera nada.
 * Retorna { groups, remove: [ids], keepers: { idMantida: [originKeys juntadas] } }.
 */
function cycleConsolidatePlan(revisions) {
  const buckets = new Map();
  revisions.forEach((revision, index) => {
    if (revision.kind !== "study" || revision.status !== "pending") return;
    const key = revision.topicId ? `t:${revision.topicId}` : `s:${revision.subjectId}`;
    const list = buckets.get(key) || [];
    list.push({ revision, index });
    buckets.set(key, list);
  });
  const remove = [];
  const keepers = {};
  let groups = 0;
  buckets.forEach((list) => {
    if (list.length < 2) return;
    const rank = (item) => item.revision.stage * 1000 + (item.revision.history?.length || 0);
    list.sort((a, b) => rank(b) - rank(a) || a.revision.dueDate.localeCompare(b.revision.dueDate) || a.index - b.index);
    const [keeper, ...rest] = list;
    groups += 1;
    keepers[keeper.revision.id] = rest.flatMap((item) => [item.revision.originKey, ...(item.revision.absorbedKeys || [])]).filter(Boolean);
    rest.forEach((item) => remove.push(item.revision.id));
  });
  return { groups, remove, keepers };
}

function cycleConsolidateAction() {
  const plan = cycleConsolidatePlan(state.revisions);
  if (!plan.remove.length) {
    showToast("Não há cadeias repetidas para unificar.");
    return;
  }
  if (!window.confirm(`Unificar ${cyclePlural(plan.groups, "assunto com cadeias repetidas", "assuntos com cadeias repetidas")}? Fica a cadeia mais avançada de cada um e ${cyclePlural(plan.remove.length, "revisão repetida sai", "revisões repetidas saem")} da fila. O estudo de cada dia continua registrado.`)) return;
  const removeSet = new Set(plan.remove);
  state.revisions.forEach((revision) => {
    const joined = plan.keepers[revision.id];
    if (!joined) return;
    revision.absorbedKeys = [...new Set([...(revision.absorbedKeys || []), ...joined])].slice(-60);
    revision.updatedAt = new Date().toISOString();
  });
  state.revisions = state.revisions.filter((revision) => !removeSet.has(revision.id));
  cycleRefresh();
  showToast(`${cyclePlural(plan.remove.length, "revisão repetida unificada", "revisões repetidas unificadas")}.`);
}

function revisionLabel(revision) {
  if (revision.kind === "law") {
    const plan = state.lawPlans.find((item) => item.id === revision.lawPlanId);
    if (plan && revision.lawFromWork !== null && revision.lawToWork !== null) {
      return `${plan.title}: ${lawWorkLabel(plan, revision.lawFromWork, revision.lawToWork)}`;
    }
    return revision.label || "Leitura de lei seca";
  }
  const prefix = revision.kind === "weak" ? "Reforço: " : "";
  if (revision.topicId && getTopic(revision.topicId)) return `${prefix}${getTopicLabel(revision.topicId)}`;
  const subject = getSubject(revision.subjectId);
  return subject ? `${prefix}${subject.name}` : revision.label || "Assunto removido";
}

function revisionStageLabel(revision) {
  const total = revisionIntervals().length;
  return `R${Math.min(revision.stage + 1, total)}/${total}`;
}

function getDueRevisions(today = cycleToday()) {
  return state.revisions
    .filter((revision) => revision.status === "pending" && revision.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || revisionLabel(a).localeCompare(revisionLabel(b)));
}

/* ------------------------------------------------------------------ */
/* Fila do dia: limitada ao limite por dia e priorizada                 */
/* ------------------------------------------------------------------ */

/** O que já foi revisado hoje (revisões e erros refeitos). */
function cycleDoneToday(today = cycleToday()) {
  return {
    rev: state.revisions.reduce((total, revision) => total + revision.history.filter((entry) => entry.date === today).length, 0),
    err: state.errorNotebook.filter((entry) => entry.lastReviewed === today).length,
  };
}

/** Quanto mais alta, mais cedo entra na fila: atraso, erro reincidente, reforço e primeira revisão pesam mais. */
function cyclePriority(kind, item, today) {
  let score = Math.min(30, Math.max(0, cycleDaysBetween(item.dueDate, today)));
  if (kind === "error") score += 2 + Math.min(9, (Number(item.lapses) || 0) * 3);
  else {
    if (item.kind === "weak") score += 6;
    if (Number(item.stage) === 0) score += 4;
  }
  return score;
}

/**
 * Quem vence hoje, até o limite por dia (revisões e erros juntos, já descontando o que foi feito hoje).
 * O que passa do limite aguarda: não é "atraso para se desesperar", entra nos próximos dias, os mais urgentes
 * primeiro. Com capQueue desligado, volta a mostrar tudo.
 */
function cycleTodayQueue(today = cycleToday()) {
  const settings = state.cycleSettings;
  const dueRevisions = getDueRevisions(today);
  const dueErrors = getDueErrors(today);
  const done = cycleDoneToday(today);
  const extra = cycleUI.extra && cycleUI.extra.date === today ? cycleUI.extra.count : 0;
  const capped = settings.capQueue !== false;
  const budget = capped ? Math.max(0, settings.dailyLimit - done.rev - done.err) + extra : Infinity;
  const ranked = [
    ...dueRevisions.map((item) => ({ kind: "revision", item })),
    ...dueErrors.map((item) => ({ kind: "error", item })),
  ]
    .map((entry) => ({ ...entry, score: cyclePriority(entry.kind, entry.item, today) }))
    .sort((a, b) => b.score - a.score || a.item.dueDate.localeCompare(b.item.dueDate) || String(a.item.id).localeCompare(String(b.item.id)));
  const chosen = new Set(ranked.slice(0, budget).map((entry) => entry.item.id));
  const revisions = dueRevisions.filter((revision) => chosen.has(revision.id));
  const errors = dueErrors.filter((entry) => chosen.has(entry.id));
  return {
    revisions,
    errors,
    waitingRevisions: dueRevisions.length - revisions.length,
    waitingErrors: dueErrors.length - errors.length,
    limit: settings.dailyLimit,
    doneToday: done.rev + done.err,
    totalDue: ranked.length,
    capped,
  };
}

function getQueueRevisions(today = cycleToday()) {
  return cycleTodayQueue(today).revisions;
}

function getQueueErrors(today = cycleToday()) {
  return cycleTodayQueue(today).errors;
}

/**
 * Ritmo sustentável: quantas revisões por dia o seu ritmo recente de estudo vai gerar quando estabilizar.
 * Cada assunto novo volta tantas vezes quantas são as etapas da escada; cada erro novo, idem.
 */
function cycleSteadyLoad(revisions, errors, today, { revisionIntervals: studySteps = [], errorIntervals: errorSteps = [], windowDays = CYCLE_STEADY_WINDOW_DAYS } = {}) {
  const since = cycleAddDays(today, -windowDays);
  const newRevisions = (revisions || []).filter((revision) => cycleIsISO(revision.baseDate) && revision.baseDate > since && revision.baseDate <= today).length;
  const newErrors = (errors || []).filter((entry) => cycleIsISO(entry.date) && entry.date > since && entry.date <= today).length;
  const perDay = (count) => Math.round((count / windowDays) * 10) / 10;
  const revPerDay = perDay(newRevisions);
  const errPerDay = perDay(newErrors);
  return {
    newRevisions,
    newErrors,
    revPerDay,
    errPerDay,
    revSteps: studySteps.length,
    errSteps: errorSteps.length,
    steadyPerDay: Math.round((revPerDay * studySteps.length + errPerDay * errorSteps.length) * 10) / 10,
  };
}

/** Aviso (ou null) quando o ritmo atual gera mais revisões por dia do que o limite: é a bola de neve se formando. */
function cycleSustainabilityNote(today = cycleToday()) {
  const settings = state.cycleSettings;
  const load = cycleSteadyLoad(state.revisions, state.errorNotebook, today, { revisionIntervals: settings.intervals, errorIntervals: settings.errorIntervals });
  const queue = cycleTodayQueue(today);
  const waiting = queue.waitingRevisions + queue.waitingErrors;
  if (load.steadyPerDay <= settings.dailyLimit && !waiting) return null;
  if (load.steadyPerDay <= settings.dailyLimit) {
    return { tone: "warn", title: `${cyclePlural(waiting, "item aguarda", "itens aguardam")} espaço na fila`, text: `Hoje vencem mais itens do que o seu limite de ${settings.dailyLimit} por dia. Eles entram nos próximos dias, os mais urgentes primeiro.`, load, waiting };
  }
  return {
    tone: "warn",
    title: `Seu ritmo gera cerca de ${load.steadyPerDay} revisões por dia`,
    text: `Nos últimos ${CYCLE_STEADY_WINDOW_DAYS} dias foram ${cyclePlural(load.newRevisions, "assunto novo", "assuntos novos")} e ${cyclePlural(load.newErrors, "erro novo", "erros novos")}. Cada assunto volta ${load.revSteps}× e cada erro ${load.errSteps}×, então a fila tende a ${Math.round(load.steadyPerDay)} por dia, acima do seu limite de ${settings.dailyLimit}. Para não virar bola de neve: estude menos assuntos novos por vez, aumente o limite se tiver tempo ou use uma escada mais curta (por exemplo 1, 7 e 30).${waiting ? ` Hoje ${cyclePlural(waiting, "item ficou", "itens ficaram")} aguardando.` : ""}`,
    load,
    waiting,
  };
}

/**
 * Nota objetiva de um assunto: acerto nas questões dos últimos dias, com e sem os acertos no chute.
 * Devolve null se não houver nenhuma questão do assunto na janela.
 */
function cycleObjectiveGrade(logs, topicId, today = cycleToday(), days = CYCLE_OBJECTIVE_DAYS) {
  if (!topicId) return null;
  const since = cycleAddDays(today, -days);
  let correct = 0;
  let wrong = 0;
  let guessed = 0;
  (logs || []).forEach((log) => {
    if (log.topicId !== topicId || !cycleIsISO(log.date) || log.date < since || log.date > today) return;
    const right = Math.max(0, Number(log.correct) || 0);
    correct += right;
    wrong += Math.max(0, Number(log.wrong) || 0);
    guessed += Math.min(right, Math.max(0, Number(log.guessed) || 0));
  });
  const total = correct + wrong;
  if (!total) return null;
  return { total, correct, wrong, guessed, days, accuracy: (correct / total) * 100, solidAccuracy: ((correct - guessed) / total) * 100 };
}

/** Nota que as questões sugerem ("" se há poucas questões): conta só os acertos que não foram no chute. */
function cycleSuggestResult(objective) {
  if (!objective || objective.total < CYCLE_OBJECTIVE_MIN) return "";
  if (objective.solidAccuracy >= 90 && objective.total >= CYCLE_OBJECTIVE_EASY_MIN) return "easy";
  if (objective.solidAccuracy >= 70) return "ok";
  if (objective.solidAccuracy >= 50) return "hard";
  return "forgot";
}

/**
 * Evita o excesso de confiança: se a pessoa marcou uma nota melhor do que as questões sustentam, o app registra
 * a nota que elas sustentam. Só rebaixa (nunca sobe a nota) e nunca chega a "Esqueci" sozinho.
 * Devolve { result, adjusted, suggested }.
 */
function cycleAdjustResult(selfResult, objective, settings = state.cycleSettings) {
  const suggested = cycleSuggestResult(objective);
  if (settings.gradeFromQuestions === false || !suggested) return { result: selfResult, adjusted: false, suggested };
  const cap = suggested === "forgot" ? "hard" : suggested;
  if (CYCLE_RESULT_ORDER.indexOf(selfResult) <= CYCLE_RESULT_ORDER.indexOf(cap)) return { result: selfResult, adjusted: false, suggested };
  return { result: cap, adjusted: true, suggested };
}

/**
 * Texto do aviso depois de avaliar uma revisão. `tail` entra depois da data da próxima (ex.: "Segue a próxima da fila.").
 * Se o app registrou uma nota mais cautelosa do que a marcada, explica por quê.
 */
function cycleRatedMessage({ step, result, chosen, adjustment, objective, tail = "" }) {
  const calibration = adjustment && adjustment.adjusted
    ? ` Você marcou "${CYCLE_RESULT_LABELS[chosen]}", mas seu acerto sem chutes neste assunto é ${Math.round(objective.solidAccuracy)}% em ${objective.total} questões (${objective.days} dias): registrei "${CYCLE_RESULT_LABELS[result]}".`
    : "";
  if (step.done) return calibration ? `Revisão concluída.${calibration}` : "Revisão concluída: assunto fixado.";
  const days = `${step.gap} ${step.gap === 1 ? "dia" : "dias"}`;
  const exam = step.examDate ? " (encurtado pela data da prova)" : "";
  const leveled = step.leveled ? " (ajustado para um dia mais leve)" : "";
  return `${CYCLE_RESULT_LABELS[result]}. Próxima revisão em ${days}${exam}${leveled}.${tail ? ` ${tail}` : ""}${calibration}`;
}

/**
 * "Já revisei": registra a revisão sem sessão guiada, com a nota "Bom", e agenda a próxima pela mesma regra de sempre
 * (avanço de etapa, data da prova, dia mais leve e a nota das questões, que só rebaixa).
 * Guarda uma cópia de antes para o "Desfazer". Devolve null se a revisão não existe ou já terminou.
 */
function quickReviewRevision(id, self = "ok") {
  const revision = state.revisions.find((item) => item.id === id);
  if (!revision || revision.status === "done") return null;
  const objective = revision.topicId ? cycleObjectiveGrade(state.questionLogs, revision.topicId) : null;
  const adjustment = cycleAdjustResult(self, objective);
  const before = JSON.parse(JSON.stringify(revision));
  const label = revisionLabel(revision);
  const step = completeRevision(id, adjustment.result, "Marcado como revisado, sem sessão guiada", self);
  if (!step) return null;
  cycleUI.quickUndo = { id, before, label };
  return { step, result: adjustment.result, chosen: self, adjustment, objective };
}

/** Desfaz o último "Já revisei", se a revisão não mudou desde então. */
function cycleUndoQuickReview() {
  const undo = cycleUI.quickUndo;
  cycleUI.quickUndo = null;
  if (!undo) return false;
  const revision = state.revisions.find((item) => item.id === undo.id);
  if (!revision || revision.history.length !== undo.before.history.length + 1) return false;
  Object.assign(revision, JSON.parse(JSON.stringify(undo.before)), { updatedAt: new Date().toISOString() });
  return true;
}

/** Linha "X marcada como revisada. Desfazer" (ou ""): aparece na aba Revisão e no cartão da aba Hoje. */
function cycleQuickUndoNote() {
  const undo = cycleUI.quickUndo;
  if (!undo) return "";
  const revision = state.revisions.find((item) => item.id === undo.id);
  if (!revision || revision.history.length !== undo.before.history.length + 1) return "";
  const next = revision.status === "done" ? "assunto concluído" : `próxima em ${formatShortDate(revision.dueDate)}`;
  return `<p class="muted-note">${escapeHTML(undo.label)} marcada como revisada (${next}). <button class="mini-button" data-cycle-action="undoQuickReview" type="button">Desfazer</button></p>`;
}

function completeRevision(id, result, note = "", self = "") {
  const revision = state.revisions.find((item) => item.id === id);
  if (!revision || revision.status === "done") return null;
  const today = cycleToday();
  const step = cycleLeveledStep(cycleScheduledStep(revision.stage, result, revisionIntervals(), revision.subjectId, today), today, { revisionId: revision.id });
  revision.history.push({ date: today, stage: revision.stage, result, note: cycleText(note).slice(0, 500), ...(self && self !== result ? { self } : {}) });
  revision.history = revision.history.slice(-30);
  revision.stage = step.stage;
  if (step.done) {
    revision.status = "done";
  } else {
    revision.dueDate = cycleAddDays(today, step.gap);
  }
  revision.updatedAt = new Date().toISOString();
  return step;
}

function scheduleLawRevision(plan, fromWork, toWork, today) {
  const key = `law:${plan.id}:${today}`;
  const existing = state.revisions.find((revision) => revision.originKey === key && revision.status === "pending" && revision.history.length === 0);
  if (existing) {
    existing.lawFromWork = Math.min(existing.lawFromWork ?? fromWork, fromWork);
    existing.lawToWork = Math.max(existing.lawToWork ?? toWork, toWork);
    existing.label = `${plan.title}: ${lawWorkLabel(plan, existing.lawFromWork, existing.lawToWork)}`;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  return createRevision({
    kind: "law",
    subjectId: plan.subjectId,
    originKey: key,
    baseDate: today,
    lawPlanId: plan.id,
    lawFromWork: fromWork,
    lawToWork: toWork,
    label: `${plan.title}: ${lawWorkLabel(plan, fromWork, toWork)}`,
  });
}

function getRevisionMaterials(revision) {
  const { subjectId, topicId } = revision;
  const empty = { cards: [], errors: [], legal: [], cases: [], stats: null };
  if (!subjectId && !topicId) return empty;
  const inScope = (item) => (topicId ? item.topicId === topicId : getEntrySubjectId(item) === subjectId);
  const stats = topicId ? getTopicStats(topicId) : null;
  return {
    cards: state.flashcards.filter(inScope).slice(0, 6),
    errors: state.errorNotebook.filter((entry) => !entry.mastered && inScope(entry)).slice(0, 5),
    legal: (state.legalMaterials || []).filter(inScope).slice(0, 5),
    cases: ["STJ", "STF"].flatMap((court) => (state.cases?.[court] || []).filter(inScope).map((item) => ({ ...item, court }))).slice(0, 5),
    stats: stats && stats.total > 0 ? stats : null,
  };
}

/* ------------------------------------------------------------------ */
/* Caderno de erros: lógica                                            */
/* ------------------------------------------------------------------ */

function errorStatus(entry) {
  if (entry.mastered) return "mastered";
  return entry.attempts > 0 ? "review" : "open";
}

function errorStatusLabel(entry) {
  return { open: "Aberto", review: "Em revisão", mastered: "Dominado" }[errorStatus(entry)];
}

const ERROR_RETEST_RESULTS = { forgot: "wrong", hard: "hard", ok: "ok", easy: "easy" };

/** Aceita true/false (jeito antigo) ou "forgot" | "hard" | "ok" | "easy" (e "wrong" como sinônimo de forgot). */
function errorRetestResult(value) {
  if (value === true) return "ok";
  if (value === false || value === "wrong") return "forgot";
  return Object.prototype.hasOwnProperty.call(ERROR_RETEST_RESULTS, value) ? value : "ok";
}

/** Erro reincidente: ainda não dominado e já errado de novo várias vezes. */
function errorIsLeech(entry) {
  return Boolean(entry) && !entry.mastered && Number(entry.lapses) >= CYCLE_LEECH_LAPSES;
}

/**
 * Refação do erro. result: "forgot" (errei), "hard" (acertei, mas chutei ou com dúvida: repete mais cedo,
 * não conta como erro), "ok" (acertei) ou "easy" (acertei fácil: intervalo maior).
 */
function retestErrorEntry(id, rawResult) {
  const entry = state.errorNotebook.find((item) => item.id === id);
  if (!entry) return null;
  const result = errorRetestResult(rawResult);
  const today = cycleToday();
  const intervals = state.cycleSettings.errorIntervals;
  const step = cycleLeveledStep(cycleScheduledStep(entry.stage, result, intervals, getEntrySubjectId(entry), today), today, { errorId: entry.id });
  entry.attempts += 1;
  entry.lastReviewed = today;
  entry.lastResult = ERROR_RETEST_RESULTS[result];
  if (result === "forgot") entry.lapses += 1;
  entry.stage = step.stage;
  if (step.done) {
    entry.mastered = true;
    entry.dueDate = "";
  } else {
    entry.mastered = false;
    entry.dueDate = cycleAddDays(today, step.gap);
  }
  entry.updatedAt = new Date().toISOString();
  return { ...step, result, leech: errorIsLeech(entry) };
}

/** Enunciado sem acento, pontuação e maiúsculas (e sem espaços repetidos). */
function errorStatementNormalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Início do enunciado normalizado: chave para reconhecer o mesmo erro cadastrado duas vezes. */
function errorStatementKey(text) {
  return errorStatementNormalize(text).slice(0, 240);
}

/**
 * Palavras do enunciado (3 letras ou mais, sem repetir), para comparar textos parecidos. Palavras longas
 * ficam só com o começo, para "contrário" e "contrária" ou "punível" e "puníveis" valerem como a mesma.
 */
function errorStatementTokens(text) {
  return new Set(
    errorStatementNormalize(text)
      .split(" ")
      .filter((word) => word.length >= 3)
      .map((word) => (word.length > 6 ? word.slice(0, 6) : word))
  );
}

/**
 * Quanto dois enunciados se parecem (0 a 1): palavras em comum sobre o total de palavras.
 * Textos com poucas palavras não são comparados (devolve 0).
 */
function errorStatementSimilarity(a, b) {
  const first = a instanceof Set ? a : errorStatementTokens(a);
  const second = b instanceof Set ? b : errorStatementTokens(b);
  const small = Math.min(first.size, second.size);
  if (small < CYCLE_DUP_MIN_WORDS) return 0;
  let shared = 0;
  first.forEach((word) => {
    if (second.has(word)) shared += 1;
  });
  const jaccard = shared / (first.size + second.size - shared);
  // um enunciado quase todo contido no outro (colou com ou sem as alternativas) também conta
  const contained = shared / small >= 0.95 && small / Math.max(first.size, second.size) >= 0.6;
  return contained ? Math.max(jaccard, CYCLE_DUP_SIMILARITY) : jaccard;
}

/**
 * Erro já cadastrado com o mesmo enunciado: igual (sem contar acento e pontuação) ou muito parecido.
 * Enunciados curtos demais não são comparados. Devolve o mais parecido.
 */
function errorFindDuplicate(entries, candidate, ignoreId = "") {
  const key = errorStatementKey(candidate?.statement);
  if (key.length < 25) return null;
  const list = (entries || []).filter((entry) => entry.id !== ignoreId);
  const same = list.find((entry) => errorStatementKey(entry.statement) === key);
  if (same) return same;
  const tokens = errorStatementTokens(candidate.statement);
  if (tokens.size < CYCLE_DUP_MIN_WORDS) return null;
  let best = null;
  let bestScore = CYCLE_DUP_SIMILARITY - 0.0001;
  list.forEach((entry) => {
    const score = errorStatementSimilarity(tokens, entry.statement);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  });
  return best;
}

/** Avisa, enquanto a pessoa digita o enunciado, que ele parece já estar no caderno. */
function errorUpdateDuplicateWarning() {
  const box = $("#errorDuplicateWarning");
  if (!box) return;
  const statement = $("#errorStatement")?.value || "";
  const match = cycleUI.errorFormOpen ? errorFindDuplicate(state.errorNotebook, { statement }, cycleUI.errorEditId) : null;
  box.classList.toggle("hidden", !match);
  if (!match) {
    box.innerHTML = "";
    return;
  }
  const when = String(match.date || "").split("-").reverse().join("/");
  const facts = [
    match.lapses ? `já errou ${match.lapses}× depois` : "",
    match.mastered ? "estava dominado" : "",
    getEntryScopeLabel(match) ? escapeHTML(getEntryScopeLabel(match)) : "",
  ].filter(Boolean);
  box.innerHTML = `
    <p><strong>Parece que você já registrou este erro</strong> (${escapeHTML(when)}${facts.length ? ` · ${facts.join(" · ")}` : ""}).</p>
    <div class="inline-actions">
      ${cycleUI.errorEditId ? "" : `<button class="mini-button success" data-cycle-action="errorMergeDuplicate" data-id="${match.id}" type="button">Somar mais um erro nele</button>`}
      <button class="mini-button" data-cycle-action="errorShowDuplicate" data-id="${match.id}" type="button">Ver esse erro</button>
    </div>
    <small>${cycleUI.errorEditId ? "" : "Somar evita duplicar: reabre o erro e conta mais uma vez. "}Se for outra questão, ignore este aviso e salve normalmente.</small>`;
}

/**
 * Errou de novo o que já estava no caderno: soma um erro no registro que existe (em vez de criar outro),
 * reabre se estava dominado, desce etapas como qualquer esquecimento e junta o que o novo registro trouxe.
 * `data` é o formulário já normalizado (prints incluídos). Devolve { entry, droppedImages }.
 */
function errorRegisterRepeat(entry, data, today = cycleToday()) {
  const step = cycleLeveledStep(cycleScheduledStep(entry.stage, "forgot", state.cycleSettings.errorIntervals, getEntrySubjectId(entry), today), today, { errorId: entry.id });
  entry.lapses += 1;
  entry.attempts += 1;
  entry.lastResult = "wrong";
  entry.lastReviewed = today;
  entry.stage = step.stage;
  entry.mastered = false;
  entry.dueDate = cycleAddDays(today, step.gap);
  const fill = (key) => {
    if (!String(entry[key] || "").trim() && String(data[key] || "").trim()) entry[key] = data[key];
  };
  ["myAnswer", "correctAnswer", "foundation", "rule", "source", "reason"].forEach(fill);
  if (!entry.topicId && data.topicId) entry.topicId = data.topicId;
  // prints do novo registro entram no existente, respeitando o limite por campo; o que passar do limite é descartado
  const droppedImages = [];
  const merge = (current, incoming) => {
    const known = new Set((current || []).map((image) => image.id));
    const room = Math.max(0, ERRO_IMG.maxPerSlot - (current || []).length);
    const fresh = (incoming || []).filter((image) => image && !known.has(image.id));
    droppedImages.push(...fresh.slice(room));
    return [...(current || []), ...fresh.slice(0, room)];
  };
  entry.images = merge(entry.images, data.images);
  entry.answerImages = merge(entry.answerImages, data.answerImages);
  const incomingNotes = String(data.notes || "").trim();
  if (incomingNotes && erroNotesText(incomingNotes) !== erroNotesText(entry.notes)) {
    entry.notes = entry.notes ? erroNotesSanitize(`${entry.notes}<hr>${incomingNotes}`) : incomingNotes;
  }
  entry.tags = [...new Set([...(entry.tags || []), ...(Array.isArray(data.tags) ? data.tags : [])])];
  entry.updatedAt = new Date().toISOString();
  return { entry, droppedImages };
}

/** Fila de refação: os reincidentes primeiro, depois os mais antigos. */
function errorDueCompare(a, b) {
  return (Number(b.lapses) || 0) - (Number(a.lapses) || 0) || String(a.dueDate).localeCompare(String(b.dueDate));
}

function getDueErrors(today = cycleToday()) {
  return state.errorNotebook.filter((entry) => !entry.mastered && entry.dueDate && entry.dueDate <= today).sort(errorDueCompare);
}

/** Cria um reforço de revisão para o assunto (ou matéria) do erro. Devolve a revisão, ou null se já houver uma aberta. */
function errorCreateReinforcement(entry) {
  const subjectId = getEntrySubjectId(entry);
  if (!subjectId || !getSubject(subjectId)) return { error: "Vincule uma matéria ao erro para criar o reforço." };
  const topicId = entry.topicId && getTopic(entry.topicId) ? entry.topicId : "";
  const open = state.revisions.find((revision) => revision.kind === "weak" && revision.status === "pending" && (topicId ? revision.topicId === topicId : !revision.topicId && revision.subjectId === subjectId));
  if (open) return { existing: open };
  const today = cycleToday();
  return { created: createRevision({ kind: "weak", subjectId, topicId, originKey: `weak:${topicId || subjectId}:${today}`, baseDate: today, dueDate: today }) };
}

/* ------------------------------------------------------------------ */
/* Resumo do ciclo (painel e abas)                                     */
/* ------------------------------------------------------------------ */

function getCycleSummary() {
  ensureCycleState();
  const today = cycleToday();
  const sum = (list, key) => list.reduce((total, item) => total + Number(item[key] || 0), 0);
  const weekStudy = state.studyLogs.filter(getRangePredicate("week"));
  const weekQuestions = state.questionLogs.filter(getRangePredicate("week"));
  const correct = sum(weekQuestions, "correct");
  const wrong = sum(weekQuestions, "wrong");
  const queue = cycleTodayQueue(today);
  const dueRevisions = queue.revisions;
  const dueErrors = queue.errors;
  const laws = state.lawPlans.map((plan) => ({ plan, info: buildLawSchedule(plan, today) }));
  const lawToday = laws.filter(({ info }) => !info.finished && info.todayIsReading && info.readToday < info.todayTarget);
  const unitLabels = [...new Set(lawToday.map(({ plan }) => plan.unitLabel))];
  return {
    today,
    weekMinutes: sum(weekStudy, "minutes"),
    qTotal: correct + wrong,
    qAcc: correct + wrong ? (correct / (correct + wrong)) * 100 : 0,
    revDue: dueRevisions.length,
    revOverdue: dueRevisions.filter((revision) => revision.dueDate < today).length,
    errorsDue: dueErrors.length,
    revWaiting: queue.waitingRevisions,
    errWaiting: queue.waitingErrors,
    errOverdue: dueErrors.filter((entry) => entry.dueDate < today).length,
    errorsOpen: state.errorNotebook.filter((entry) => !entry.mastered).length,
    laws,
    lawToday,
    lawPendingUnits: lawToday.reduce((total, { info }) => total + (info.todayTarget - info.readToday), 0),
    lawUnitLabel: unitLabels.length === 1 ? unitLabels[0] : "itens",
  };
}

function getCycleDailyCards() {
  try {
    const summary = getCycleSummary();
    const cards = [];
    if (summary.revDue) {
      cards.push({
        label: summary.revOverdue ? "Revisão atrasada" : "Revisão",
        title: `${summary.revDue} ${summary.revDue === 1 ? "revisão" : "revisões"} para hoje`,
        meta: summary.revOverdue ? `${summary.revOverdue} já passaram do prazo` : "Fixe o que estudou nos últimos dias",
        view: "revisao",
      });
    }
    if (summary.errorsDue) {
      cards.push({
        label: "Caderno de erros",
        title: `${summary.errorsDue} ${summary.errorsDue === 1 ? "erro" : "erros"} para refazer`,
        meta: `${summary.errorsOpen} ainda não dominados`,
        view: "erros",
      });
    }
    if (summary.lawPendingUnits) {
      const first = summary.lawToday[0];
      cards.push({
        label: "Lei seca",
        title: `${first.plan.title}`,
        meta: `${first.info.todayLabel} (${summary.lawPendingUnits} ${summary.lawUnitLabel} hoje)`,
        view: "leiseca",
      });
    }
    return cards;
  } catch (error) {
    console.error("Ciclo de estudos (cartões do painel):", error);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Renderização                                                        */
/* ------------------------------------------------------------------ */

function renderCycle() {
  try {
    ensureCycleState();
    if (typeof todayEnsureStartView === "function" && todayEnsureStartView()) return;
    const created = syncAutoRevisions();
    if (created > 0) {
      saveState();
      showToast(`${cyclePlural(created, "revisão agendada", "revisões agendadas")}: o site avisa no dia certo.`);
    }
    const weak = typeof syncWeakRevisions === "function" ? syncWeakRevisions() : [];
    if (weak.length) {
      saveState();
      showToast(weak.length === 1 ? `Reforço agendado: ${getTopicLabel(weak[0].topicId)} (${Math.round(weak[0].accuracy)}% de acerto).` : `${weak.length} reforços agendados por acerto baixo.`);
    }
    const summary = getCycleSummary();
    renderCycleStrips(summary);
    renderReviewBanner(summary);
    cycleApplyBadge(summary.revDue + summary.errorsDue + summary.lawToday.length);
    cycleMaybeNotify(summary);
    if (typeof renderTodayModule === "function") renderTodayModule(summary);
    if (typeof pushScheduleSync === "function") pushScheduleSync();
    if (typeof renderSessionUI === "function") renderSessionUI();
    if (typeof renderMesclarBar === "function") renderMesclarBar();
    const view = state.ui.view;
    if (view === "revisao") renderRevisions();
    if (view === "erros") renderErrors();
    if (view === "relatorios" && typeof renderCycleReports === "function") renderCycleReports();
    if (view === "leiseca") renderLaw();
  } catch (error) {
    console.error("Ciclo de estudos:", error);
  }
}

function renderCycleStrips(summary) {
  const targets = ["#cycleStripDashboard", "#cycleStripRevisao"].map((selector) => $(selector)).filter(Boolean);
  if (!targets.length) return;
  const s = summary || getCycleSummary();
  const steps = [
    { view: "pomodoro", title: "Estudar", value: formatMinutes(s.weekMinutes), meta: "registrados na semana" },
    { view: "questoes", title: "Questões", value: String(s.qTotal), meta: s.qTotal ? `${percent(s.qAcc)} de acerto na semana` : "nenhuma na semana" },
    { view: "erros", title: "Caderno de erros", value: String(s.errorsDue), meta: s.errorsDue ? "para refazer hoje" : cyclePlural(s.errorsOpen, "não dominado", "não dominados") },
    { view: "revisao", title: "Revisar", value: String(s.revDue), meta: s.revOverdue ? `${s.revOverdue} atrasada(s)` : "para hoje" },
    { view: "leiseca", title: "Lei seca", value: String(s.lawPendingUnits), meta: s.lawPendingUnits ? `${s.lawUnitLabel} para ler hoje` : "sem meta pendente" },
  ];
  const html = steps
    .map(
      (step, index) => `
        <button class="cycle-step" data-view="${step.view}" type="button">
          <span class="cycle-step-number">${index + 1}</span>
          <strong>${escapeHTML(step.title)}</strong>
          <span class="cycle-step-value">${escapeHTML(step.value)}</span>
          <small>${escapeHTML(step.meta)}</small>
        </button>`
    )
    .join("");
  targets.forEach((target) => {
    target.innerHTML = html;
  });
}

function cycleSetValueIfIdle(selector, value) {
  const element = $(selector);
  if (element && document.activeElement !== element) element.value = value;
}

function cycleStat(label, value, caption) {
  return statCard(label, value, caption);
}

/* ---------- Revisão ---------- */

function renderRevisions() {
  const today = cycleToday();
  populateSubjectSelect($("#revisionSubject"));
  populateTopicSelect($("#revisionTopic"), { includeEmpty: true, subjectId: $("#revisionSubject")?.value || "", emptyLabel: "Sem assunto específico" });
  $("#revisionSubject").disabled = state.subjects.length === 0;
  $("#revisionTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#revisionSubject")?.value);
  if (!$("#revisionBaseDate").value) $("#revisionBaseDate").value = today;
  cycleSetValueIfIdle("#cycleIntervals", state.cycleSettings.intervals.join(", "));
  cycleSetValueIfIdle("#cycleErrorIntervals", state.cycleSettings.errorIntervals.join(", "));
  $("#cycleAutoStudy").checked = state.cycleSettings.autoFromStudy;
  $("#cycleAutoWeak").checked = state.cycleSettings.autoWeak;
  $("#cycleExamAdapt").checked = state.cycleSettings.examAdapt;
  $("#cycleLevelLoad").checked = state.cycleSettings.levelLoad;
  $("#cycleCapQueue").checked = state.cycleSettings.capQueue;
  $("#cycleGradeFromQuestions").checked = state.cycleSettings.gradeFromQuestions;
  cycleSetValueIfIdle("#cycleMinAuto", state.cycleSettings.minAutoMinutes);
  cycleSetValueIfIdle("#cycleWeakAccuracy", state.cycleSettings.weakAccuracy);
  cycleSetValueIfIdle("#cycleWeakMin", state.cycleSettings.weakMinQuestions);

  const pending = state.revisions.filter((revision) => revision.status === "pending");
  const queue = cycleTodayQueue(today);
  const due = queue.revisions;
  const limit = cycleAddDays(today, 7);
  const next7 = pending.filter((revision) => revision.dueDate > today && revision.dueDate <= limit).length;
  const cutoff = cycleAddDays(today, -30);
  const recent = state.revisions.flatMap((revision) => revision.history).filter((entry) => entry.date >= cutoff);
  const kept = recent.filter((entry) => entry.result === "ok" || entry.result === "easy").length;
  $("#revisionStats").innerHTML = [
    cycleStat("Para hoje", String(due.length), due.length ? (queue.waitingRevisions ? `revisões na fila · ${queue.waitingRevisions} aguardam` : "revisões na fila") : queue.waitingRevisions ? `${queue.waitingRevisions} aguardam espaço` : "fila em dia"),
    cycleStat("Atrasadas", String(due.filter((revision) => revision.dueDate < today).length), "passaram da data prevista"),
    cycleStat("Próximos 7 dias", String(next7), `${cyclePlural(pending.length, "pendente", "pendentes")} no total`),
    cycleStat("Retenção (30 dias)", recent.length ? percent((kept / recent.length) * 100) : "–", recent.length ? `${cyclePlural(recent.length, "revisão feita", "revisões feitas")}` : "sem revisões ainda"),
  ].join("");

  $("#revisionQueue").innerHTML = due.length
    ? due
        .map((revision) => {
          const late = daysBetween(revision.dueDate, today);
          const when = late > 0 ? `${late} ${late === 1 ? "dia" : "dias"} de atraso` : "para hoje";
          return `
            <article class="revision-row ${late > 0 ? "overdue" : ""}">
              <div>
                <strong>${escapeHTML(revisionLabel(revision))}</strong>
                <small>${revisionStageLabel(revision)} · ${when} · estudado em ${formatDate(revision.baseDate)}</small>
              </div>
              <div class="inline-actions">
                <button class="mini-button success" data-cycle-action="openRevision" data-id="${revision.id}" type="button">Revisar</button>
                <button class="mini-button" data-cycle-action="quickReview" data-id="${revision.id}" type="button" title="Registra como revisada (nota Bom) e agenda a próxima pela regra de sempre">Já revisei</button>
                <button class="mini-button" data-cycle-action="finishRevision" data-id="${revision.id}" type="button">Encerrar</button>
                <button class="mini-button bad" data-cycle-action="deleteRevision" data-id="${revision.id}" type="button">Excluir</button>
              </div>
            </article>`;
        })
        .join("")
    : `<div class="empty-state">Nenhuma revisão pendente para hoje. Registre estudo no Pomodoro ou agende uma revisão manual.</div>`;

  const overdueCount = getDueRevisions(today).filter((revision) => revision.dueDate < today).length + getDueErrors(today).filter((entry) => entry.dueDate < today).length;
  if (overdueCount >= CYCLE_REDISTRIBUTE_MIN) {
    $("#revisionQueue").insertAdjacentHTML(
      "beforeend",
      `<div class="inline-actions"><button class="button secondary" data-cycle-action="redistributeOverdue" type="button">Redistribuir ${cyclePlural(overdueCount, "atrasada", "atrasadas")} (até ${state.cycleSettings.dailyLimit} por dia)</button></div>`
    );
  }

  const undoNote = cycleQuickUndoNote();
  if (undoNote) $("#revisionQueue").insertAdjacentHTML("afterbegin", undoNote);
  const note = cycleSustainabilityNote(today);
  const queueInfo = queue.waitingRevisions || queue.waitingErrors || queue.totalDue
    ? `<p class="muted-note">Fila de hoje: ${queue.revisions.length + queue.errors.length} de ${queue.totalDue} que vencem (limite de ${queue.limit} por dia, revisões e erros juntos${queue.doneToday ? `; ${queue.doneToday} já feitos hoje` : ""}). ${queue.waitingRevisions + queue.waitingErrors ? "O resto aguarda e entra nos próximos dias, os mais urgentes primeiro." : ""}</p>`
    : "";
  if (queueInfo || note) {
    $("#revisionQueue").insertAdjacentHTML(
      "beforeend",
      `${queueInfo}${queue.waitingRevisions + queue.waitingErrors ? `<div class="inline-actions"><button class="mini-button" data-cycle-action="queueMore" type="button">Revisar mais 5 hoje</button></div>` : ""}${note ? `<div class="retest-box leech-box"><p><strong>${escapeHTML(note.title)}</strong></p><p style="font-weight:500">${escapeHTML(note.text)}</p></div>` : ""}`
    );
  }

  const duplicated = cycleConsolidatePlan(state.revisions);
  if (duplicated.remove.length) {
    $("#revisionQueue").insertAdjacentHTML(
      "beforeend",
      `<div class="inline-actions"><button class="button secondary" data-cycle-action="consolidateRevisions" type="button">Unificar ${cyclePlural(duplicated.remove.length, "revisão repetida", "revisões repetidas")} de ${cyclePlural(duplicated.groups, "assunto", "assuntos")}</button></div>`
    );
  }

  renderRevisionSession(due);
  renderRevisionUpcoming(pending, today);
  renderRevisionTrail(today);
  renderReminderPanel();
}

function renderRevisionSession(due) {
  const box = $("#revisionSession");
  const revision = state.revisions.find((item) => item.id === cycleUI.sessionId && item.status === "pending");
  if (!revision) {
    cycleUI.sessionId = "";
    cycleUI.revealed = false;
    box.innerHTML = due.length
      ? `<div class="empty-state">${due.length} ${due.length === 1 ? "revisão aguarda" : "revisões aguardam"} você.</div>
         <button class="button primary" data-cycle-action="startSession" type="button">Iniciar sessão de revisão</button>`
      : `<div class="empty-state">Sem revisões para fazer agora. Quando houver, a sessão guiada aparece aqui.</div>`;
    return;
  }

  const isLaw = revision.kind === "law";
  const plan = isLaw ? state.lawPlans.find((item) => item.id === revision.lawPlanId) : null;
  const prompt = isLaw
    ? "Sem abrir a lei, recite o que lembra deste trecho: regra geral, prazos, exceções e palavras-chave."
    : "Sem olhar nada, explique em voz alta ou por escrito o que você lembra deste assunto: conceito, regras, exceções e pegadinhas.";
  const position = getQueueRevisions().findIndex((item) => item.id === revision.id) + 1;
  let suggestedResult = "";

  let body = `
    <div class="recall-box">
      <label>
        O que eu lembro (opcional, fica salvo no histórico)
        <textarea id="revisionRecall" rows="5" placeholder="Escreva com suas palavras antes de conferir...">${escapeHTML(cycleUI.recall)}</textarea>
      </label>
    </div>`;

  if (!cycleUI.revealed) {
    body += `<div class="inline-actions"><button class="button primary" data-cycle-action="revealSession" type="button">Mostrar material para conferir</button></div>`;
  } else {
    const materials = getRevisionMaterials(revision);
    const sections = [];
    const objective = revision.topicId ? cycleObjectiveGrade(state.questionLogs, revision.topicId) : null;
    suggestedResult = cycleSuggestResult(objective);
    if (materials.stats) {
      const solid = materials.stats.guessed ? ` (${percent(materials.stats.solidAccuracy)} sem os acertos no chute)` : "";
      sections.push(`<div class="session-block"><span class="field-title">Desempenho em questões</span><p>${percent(materials.stats.accuracy)} de acerto em ${materials.stats.total} ${materials.stats.total === 1 ? "questão" : "questões"}${solid}.</p></div>`);
    }
    if (revision.topicId && revision.kind !== "law") {
      sections.push(
        suggestedResult
          ? `<div class="session-block"><span class="field-title">O que as suas questões sugerem</span><p>${percent(objective.solidAccuracy)} de acerto sem chutes em ${objective.total} questões dos últimos ${objective.days} dias: <strong>${CYCLE_RESULT_LABELS[suggestedResult]}</strong>. Marque a sua nota abaixo; se ela for melhor do que as questões sustentam, o app registra a mais cautelosa.</p></div>`
          : `<div class="session-block"><span class="field-title">Nota objetiva</span><p>${objective ? `Só ${objective.total} ${objective.total === 1 ? "questão" : "questões"} deste assunto nos últimos ${objective.days} dias.` : "Nenhuma questão deste assunto nos últimos dias."} Lance pelo menos ${CYCLE_OBJECTIVE_MIN} para a revisão ter uma nota objetiva. <button class="mini-button" data-view="questoes" type="button">Lançar questões</button></p></div>`
      );
    }
    if (materials.errors.length) {
      sections.push(`<div class="session-block"><span class="field-title">Erros ainda abertos neste tema</span>${materials.errors
        .map((entry) => `<p class="pre-wrap"><strong>${escapeHTML(cycleExcerpt(entry.statement, 110))}</strong><br />Correto: ${escapeHTML(cycleExcerpt(entry.correctAnswer, 140))}${entry.rule ? `<br />Regra: ${escapeHTML(cycleExcerpt(entry.rule, 140))}` : ""}</p>`)
        .join("")}</div>`);
    }
    if (materials.cards.length) {
      sections.push(`<div class="session-block"><span class="field-title">Flashcards deste tema</span>${materials.cards
        .map((card) => `<p><strong>${escapeHTML(cycleExcerpt(richTextToPlain(card.front), 110))}</strong><br />${escapeHTML(cycleExcerpt(richTextToPlain(card.back), 180))}</p>`)
        .join("")}</div>`);
    }
    const references = [
      ...materials.legal.map((item) => `${item.title}${item.reference ? ` (${item.reference})` : ""}`),
      ...materials.cases.map((item) => `${item.court}: ${item.title}`),
    ];
    if (references.length) {
      sections.push(`<div class="session-block"><span class="field-title">Leis e julgados cadastrados</span><p>${references.map(escapeHTML).join("<br />")}</p></div>`);
    }
    if (isLaw && plan?.url) {
      sections.push(`<div class="session-block"><a class="button secondary" href="${escapeHTML(plan.url)}" target="_blank" rel="noopener noreferrer">Abrir a lei para conferir</a></div>`);
    }
    if (!sections.length) {
      sections.push(`<div class="session-block"><p>Não há flashcards, erros ou leis cadastrados para este tema. Confira no seu material e avalie sua lembrança.</p></div>`);
    }
    const intervals = revisionIntervals();
    const hint = (result) => {
      const step = cycleLeveledStep(cycleScheduledStep(revision.stage, result, intervals, revision.subjectId), cycleToday(), { revisionId: revision.id });
      return step.done ? "encerra" : `volta em ${step.gap} ${step.gap === 1 ? "dia" : "dias"}`;
    };
    body += `
      ${sections.join("")}
      <div class="session-block">
        <span class="field-title">Como foi a sua lembrança?</span>
        <div class="rating-row">
          ${["forgot", "hard", "ok", "easy"]
            .map(
              (result) => `<button class="button rating-${result}${result === suggestedResult ? " suggested" : ""}" data-cycle-action="rateRevision" data-result="${result}" data-id="${revision.id}" type="button">
                <strong>${CYCLE_RESULT_LABELS[result]}</strong><small>${hint(result)}${result === suggestedResult ? " · sugerido pelas questões" : ""}</small></button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  box.innerHTML = `
    <div class="session-head">
      <div>
        <p class="eyebrow">${revisionStageLabel(revision)} · revisão ${position} de ${due.length}</p>
        <h3>${escapeHTML(revisionLabel(revision))}</h3>
      </div>
      <button class="mini-button" data-cycle-action="skipSession" type="button">Pular</button>
    </div>
    ${revision.kind === "weak" ? `<p class="session-note">Reforço automático: seu acerto neste assunto ficou abaixo da meta. Revise os erros abaixo e refaça questões do tema depois.</p>` : ""}
    <p class="session-prompt">${escapeHTML(prompt)}</p>
    ${body}`;
}

function cycleExcerpt(text, max = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function renderRevisionUpcoming(pending, today) {
  const container = $("#revisionUpcoming");
  const horizon = cycleAddDays(today, 14);
  const future = pending.filter((revision) => revision.dueDate > today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const shown = future.filter((revision) => revision.dueDate <= horizon);
  if (!future.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma revisão futura agendada ainda.</div>`;
    return;
  }
  const groups = new Map();
  shown.forEach((revision) => {
    const list = groups.get(revision.dueDate) || [];
    list.push(revision);
    groups.set(revision.dueDate, list);
  });
  const later = future.length - shown.length;
  container.innerHTML =
    [...groups.entries()]
      .map(
        ([date, list]) => `
          <div class="upcoming-day">
            <strong>${escapeHTML(cycleWeekdayShort(date))}, ${formatDate(date)}</strong>
            <ul>${list.map((revision) => `<li>${escapeHTML(revisionLabel(revision))} <small>${revisionStageLabel(revision)}</small></li>`).join("")}</ul>
          </div>`
      )
      .join("") + (later > 0 ? `<p class="muted-note">+ ${later} ${later === 1 ? "revisão" : "revisões"} depois dos próximos 14 dias.</p>` : "");
  if (!shown.length) {
    container.innerHTML = `<div class="empty-state">Nada nos próximos 14 dias. ${later} ${later === 1 ? "revisão agendada" : "revisões agendadas"} mais adiante.</div>`;
  }
}

/* ---------- Caderno de erros ---------- */

function cycleReasonOptions(selected, { withAll = false } = {}) {
  const all = withAll ? `<option value="">Todos os motivos</option>` : "";
  return all + Object.entries(ERROR_REASONS).map(([key, label]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${escapeHTML(label)}</option>`).join("");
}

function errorMatchesBase(entry, filters, today, search) {
  const status = errorStatus(entry);
  if (filters.reason && entry.reason !== filters.reason) return false;
  if (filters.status === "pending" && status === "mastered") return false;
  if (filters.status === "due" && !(status !== "mastered" && entry.dueDate && entry.dueDate <= today)) return false;
  if (filters.status === "mastered" && status !== "mastered") return false;
  if (search) {
    const haystack = [entry.statement, typeof erroNotesText === "function" ? erroNotesText(entry.notes) : "", entry.myAnswer, entry.correctAnswer, entry.foundation, entry.rule, entry.source, entry.tags.join(" "), getEntryScopeLabel(entry), ERROR_REASONS[entry.reason]].join(" ");
    const normalized = typeof normalizeSearchText === "function" ? normalizeSearchText(haystack) : haystack.toLowerCase();
    if (!normalized.includes(search)) return false;
  }
  return true;
}

function errorExcerpt(entry, max = 80) {
  return cycleExcerpt(entry.statement, max) || ((entry.images || []).length ? "Questão em print" : "Erro sem enunciado");
}

function errorFormSet(open) {
  cycleUI.errorFormOpen = open;
  $("#errorForm")?.classList.toggle("hidden", !open);
  $("#errorNewBtn")?.classList.toggle("hidden", open);
}

/** Abre o formulário já na matéria/assunto que está selecionado no menu. Também usado ao colar um print fora do formulário. */
function errorFormOpen() {
  const filters = cycleUI.errorFilters;
  if (!cycleUI.errorEditId && !cycleUI.errorPrefill) {
    cycleUI.errorPrefill = {
      subjectId: filters.subject && filters.subject !== "none" ? filters.subject : "",
      topicId: filters.topic && filters.topic !== "none" ? filters.topic : "",
      date: "",
    };
  }
  cycleUI.errorFormOpen = true;
  renderCycle();
}

function errorNavBadges(item) {
  return `${item.due ? `<span class="nav-due" title="para refazer hoje">${item.due}</span>` : ""}<span class="nav-num">${item.total}</span>`;
}

function errorNavHTML(nav, filters) {
  const open = cycleUI.errorNavOpen;
  const item = (cls, active, subject, topic, label, counts, color) =>
    `<button type="button" class="error-nav-item ${cls} ${active ? "is-active" : ""}" data-cycle-action="errorNav" data-subject="${subject}" data-topic="${topic}" ${active ? 'aria-current="true"' : ""}${color ? ` style="--dot:${escapeHTML(color)}"` : ""}>${color !== undefined ? '<i class="nav-dot" aria-hidden="true"></i>' : ""}<span class="nav-name">${escapeHTML(label)}</span>${errorNavBadges(counts)}</button>`;

  const groups = nav.subjects.map((subject) => {
    const isOpen = open[subject.id] ?? filters.subject === subject.id;
    const hasTopics = subject.topics.length > 0;
    const topics = [
      ...subject.topics.map((topic) => item("is-topic", filters.subject === subject.id && filters.topic === topic.id, subject.id, topic.id, topic.name, topic)),
      hasTopics && subject.noTopic.total ? item("is-topic is-muted", filters.subject === subject.id && filters.topic === "none", subject.id, "none", "Sem assunto específico", subject.noTopic) : "",
    ].join("");
    return `
      <div class="error-nav-group ${isOpen ? "is-open" : ""}">
        <div class="error-nav-row">
          <button type="button" class="error-nav-toggle" data-cycle-action="errorNavToggle" data-subject="${subject.id}" aria-expanded="${isOpen && hasTopics}" aria-label="${isOpen ? "Recolher" : "Expandir"} assuntos de ${escapeHTML(subject.name)}" ${hasTopics ? "" : "disabled"}><span aria-hidden="true">›</span></button>
          ${item("is-subject", filters.subject === subject.id && !filters.topic, subject.id, "", subject.name, subject, subject.color || "#0f766e")}
        </div>
        ${isOpen && hasTopics ? `<div class="error-nav-topics">${topics}</div>` : ""}
      </div>`;
  });
  const orphan = nav.orphan ? `<div class="error-nav-row">${item("is-subject is-muted", filters.subject === "none", "none", "", "Sem matéria", nav.orphan, "#94a3b8")}</div>` : "";
  const all = item("is-all", !filters.subject, "", "", "Todas as matérias", nav);
  return nav.total || filters.subject ? `${all}${groups.join("")}${orphan}` : `<div class="empty-state">O menu aparece quando houver erros.</div>`;
}

function errorCrumbHTML(filters, maps) {
  if (!filters.subject) return "";
  const subject = filters.subject === "none" ? "Sem matéria" : maps.subjectById.get(filters.subject)?.name || "";
  const topic = filters.topic ? (filters.topic === "none" ? "Sem assunto específico" : maps.topicById.get(filters.topic)?.name || "") : "";
  const link = (subjectId, label) => `<button class="crumb-link" type="button" data-cycle-action="errorNav" data-subject="${subjectId}" data-topic="">${escapeHTML(label)}</button>`;
  return `<nav class="error-crumb" aria-label="Local no caderno">${link("", "Todas")}<span aria-hidden="true">›</span>${topic ? `${link(filters.subject, subject)}<span aria-hidden="true">›</span><strong>${escapeHTML(topic)}</strong>` : `<strong>${escapeHTML(subject)}</strong>`}</nav>`;
}

function renderErrors() {
  const today = cycleToday();
  const filters = cycleUI.errorFilters;
  if (cycleUI.errorPrefill) cycleUI.errorFormOpen = true;

  populateSubjectSelect($("#errorSubject"));
  populateTopicSelect($("#errorTopic"), { includeEmpty: true, subjectId: $("#errorSubject")?.value || "", emptyLabel: "Sem assunto específico" });
  $("#errorSubject").disabled = state.subjects.length === 0;
  $("#errorTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#errorSubject")?.value);
  const reasonSelect = $("#errorReason");
  if (!reasonSelect.options.length) reasonSelect.innerHTML = cycleReasonOptions("conhecimento");
  if (!$("#errorDate").value) $("#errorDate").value = today;

  // Filtro de matéria/assunto: descarta o que não existe mais.
  const maps = erroMaps(state.subjects, state.topics);
  if (filters.subject && filters.subject !== "none" && !maps.subjectById.has(filters.subject)) filters.subject = "";
  if (!filters.subject) filters.topic = "";
  if (filters.topic && filters.topic !== "none" && maps.topicById.get(filters.topic)?.subjectId !== filters.subject) filters.topic = "";
  filters.topic = filters.topic || "";

  $("#errorFilterReason").innerHTML = cycleReasonOptions(filters.reason, { withAll: true });
  $("#errorFilterStatus").value = filters.status;
  cycleSetValueIfIdle("#errorSearch", filters.search);
  errorUpdateDuplicateWarning();

  if (cycleUI.errorPrefill) {
    const prefill = cycleUI.errorPrefill;
    cycleUI.errorPrefill = null;
    if (prefill.subjectId) $("#errorSubject").value = prefill.subjectId;
    populateTopicSelect($("#errorTopic"), { includeEmpty: true, subjectId: $("#errorSubject").value, emptyLabel: "Sem assunto específico" });
    $("#errorTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#errorSubject").value);
    if (prefill.topicId) $("#errorTopic").value = prefill.topicId;
    if (prefill.date) $("#errorDate").value = prefill.date;
    window.setTimeout(() => $("#errorStatement")?.focus(), 80);
  }
  errorFormSet(cycleUI.errorFormOpen || Boolean(cycleUI.errorEditId));

  const all = state.errorNotebook;
  const open = all.filter((entry) => !entry.mastered);
  const errQueue = cycleTodayQueue(today);
  const dueCount = errQueue.errors.length;
  const reasonCounts = Object.keys(ERROR_REASONS).map((key) => ({ key, count: all.filter((entry) => entry.reason === key).length })).sort((a, b) => b.count - a.count);
  const topReason = reasonCounts[0]?.count ? reasonCounts[0] : null;
  const errOverdue = getDueErrors(today).filter((entry) => entry.dueDate < today).length;
  const redistribute = $("#errorRedistribute");
  const showRedistribute = errOverdue >= CYCLE_REDISTRIBUTE_MIN; // com poucos atrasados o botão só atrapalha
  if (redistribute) {
    redistribute.classList.toggle("hidden", !showRedistribute);
    redistribute.innerHTML = showRedistribute ? `<button class="button secondary" data-cycle-action="redistributeOverdue" type="button">Redistribuir ${cyclePlural(errOverdue, "erro atrasado", "erros atrasados")} (até ${state.cycleSettings.dailyLimit} por dia)</button>` : "";
  }
  $("#errorStats").innerHTML = [
    cycleStat("Para refazer hoje", String(dueCount), dueCount ? (errQueue.waitingErrors ? `venceram · ${errQueue.waitingErrors} aguardam` : "venceram na revisão") : errQueue.waitingErrors ? `${errQueue.waitingErrors} aguardam espaço` : "nada vencido"),
    cycleStat("Não dominados", String(open.length), `${all.filter((entry) => errorStatus(entry) === "review").length} em revisão`),
    cycleStat("Dominados", String(all.length - open.length), `${all.length} no caderno`),
    cycleStat("Motivo mais comum", topReason ? ERROR_REASONS[topReason.key] : "–", topReason ? `${topReason.count} ${topReason.count === 1 ? "erro" : "erros"}` : "sem erros ainda"),
  ].join("");

  renderErrorCharts(reasonCounts);
  updateErrorFormMode();

  // Situação, motivo e busca valem para o menu e para a lista; matéria/assunto só para a lista.
  const search = typeof normalizeSearchText === "function" ? normalizeSearchText(filters.search) : filters.search.toLowerCase();
  const base = all.filter((entry) => errorMatchesBase(entry, filters, today, search));
  const nav = buildErrorNav(base, state.subjects, state.topics, today, { subject: filters.subject, topic: filters.topic });
  $("#errorNav").innerHTML = errorNavHTML(nav, filters);
  $("#errorCrumb").innerHTML = errorCrumbHTML(filters, maps);

  const matches = base
    .filter((entry) => erroScopeMatches(erroEntryScope(entry, maps), filters))
    .sort((a, b) => Number(a.mastered) - Number(b.mastered) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || b.date.localeCompare(a.date));

  if (typeof erroCloudStatusRefresh === "function") erroCloudStatusRefresh();
  $("#errorListSummary").textContent = all.length
    ? `${matches.length} de ${all.length} ${all.length === 1 ? "erro" : "erros"} no filtro atual.`
    : "Seu caderno está vazio.";

  if (!matches.length) {
    $("#errorList").innerHTML = all.length
      ? `<div class="empty-state">Nenhum erro com esses filtros.</div>`
      : `<div class="empty-state"><p>Quando você errar uma questão, registre aqui o porquê e como não errar de novo. Dá para colar o print da questão com Ctrl+V.</p><button class="button primary" data-cycle-action="openErrorForm" type="button">Registrar o primeiro erro</button></div>`;
    return;
  }
  $("#errorList").innerHTML = groupErrorsByScope(matches, state.subjects, state.topics, filters)
    .map(
      (group) => `
        <section class="error-group">
          ${group.title ? `<h4 class="error-group-title">${group.color ? `<i class="nav-dot" style="--dot:${escapeHTML(group.color)}" aria-hidden="true"></i>` : ""}${escapeHTML(group.title)}<small>${cyclePlural(group.items.length, "erro", "erros")}</small></h4>` : ""}
          ${group.items.map((entry) => errorCardHTML(entry, today)).join("")}
        </section>`
    )
    .join("");
  erroImgHydrate($("#errorList"));
}

function renderErrorCharts(reasonCounts) {
  const all = state.errorNotebook;
  const maxReason = Math.max(1, ...reasonCounts.map((item) => item.count));
  const reasons = reasonCounts.filter((item) => item.count > 0);
  $("#errorReasonChart").innerHTML = reasons.length
    ? reasons
        .map(
          (item) => `
            <div class="performance-row">
              <div class="performance-top"><strong>${escapeHTML(ERROR_REASONS[item.key])}</strong><strong>${item.count}</strong></div>
              <div class="progress-track"><div class="progress-fill" style="--progress:${(item.count / maxReason) * 100}%; --fill:var(--coral)"></div></div>
            </div>`
        )
        .join("")
    : `<div class="empty-state">O gráfico aparece quando houver erros registrados.</div>`;

  const bySubject = state.subjects
    .map((subject) => ({ subject, count: all.filter((entry) => getEntrySubjectId(entry) === subject.id).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxSubject = Math.max(1, ...bySubject.map((item) => item.count));
  $("#errorSubjectChart").innerHTML = bySubject.length
    ? bySubject
        .map(
          (item) => `
            <div class="performance-row">
              <div class="performance-top"><strong>${escapeHTML(item.subject.name)}</strong><strong>${item.count}</strong></div>
              <div class="progress-track"><div class="progress-fill" style="--progress:${(item.count / maxSubject) * 100}%; --fill:${item.subject.color || "#0f766e"}"></div></div>
            </div>`
        )
        .join("")
    : `<div class="empty-state">Sem erros por matéria ainda.</div>`;
}

function errorCardHTML(entry, today) {
  const status = errorStatus(entry);
  const retesting = cycleUI.errorRetest.id === entry.id;
  const answerHidden = retesting && !cycleUI.errorRetest.open;
  const due = !entry.mastered && entry.dueDate && entry.dueDate <= today;
  const nextText = entry.mastered ? "dominado" : entry.dueDate ? (due ? "refazer hoje" : `próxima em ${formatDate(entry.dueDate)}`) : "";
  const tags = entry.tags.length ? `<div class="chip-row">${entry.tags.map((tag) => `<span class="tag">#${escapeHTML(tag)}</span>`).join("")}</div>` : "";
  const questionShots = erroShotsHTML(entry.images, "Print da questão");
  const answerShots = erroShotsHTML(entry.answerImages, "Print do gabarito");
  const retestArea = retesting
    ? answerHidden
      ? `<div class="retest-box"><p>Responda sem olhar o gabarito. Quando estiver pronto, confira.</p><button class="button primary" data-cycle-action="showErrorAnswer" data-id="${entry.id}" type="button">Mostrar gabarito</button></div>`
      : `<div class="retest-box"><p>Como foi desta vez?</p><div class="inline-actions">
           <button class="button ghost danger" data-cycle-action="errorResult" data-result="forgot" data-id="${entry.id}" type="button">Errei de novo</button>
           <button class="button secondary" data-cycle-action="errorResult" data-result="hard" data-id="${entry.id}" type="button">Acertei, mas chutei ou com dúvida</button>
           <button class="button primary" data-cycle-action="errorResult" data-result="ok" data-id="${entry.id}" type="button">Acertei</button>
           <button class="button primary" data-cycle-action="errorResult" data-result="easy" data-id="${entry.id}" type="button">Acertei fácil</button>
         </div></div>`
    : "";
  const showAnswer = !answerHidden && (entry.correctAnswer || answerShots);
  const leech = errorIsLeech(entry);
  const leechBox = leech && !answerHidden
    ? `<div class="retest-box leech-box"><p><strong>Reincidente:</strong> você errou este ${entry.lapses}×. Só refazer não está bastando. ${entry.rule ? "Releia a regra e veja se ela está clara o bastante." : "Escreva a regra de como não errar de novo."}</p><div class="inline-actions">
         <button class="mini-button success" data-cycle-action="errorReinforce" data-id="${entry.id}" type="button">Criar reforço do assunto</button>
         <button class="mini-button" data-cycle-action="errorToFlashcard" data-id="${entry.id}" type="button">Gerar flashcard</button>
         <button class="mini-button" data-cycle-action="editError" data-id="${entry.id}" type="button">${entry.rule ? "Reescrever a regra" : "Escrever a regra"}</button>
       </div></div>`
    : "";
  return `
    <article class="error-card status-${status} ${due ? "is-due" : ""}">
      <div class="performance-top">
        <div>
          <strong>${escapeHTML(getEntryScopeLabel(entry))}</strong>
          <small>${formatDate(entry.date)}${entry.source ? ` · ${escapeHTML(entry.source)}` : ""}</small>
        </div>
        <div class="chip-row"><span class="tag reason-tag">${escapeHTML(ERROR_REASONS[entry.reason])}</span>${leech ? `<span class="tag status-tag leech-tag">Reincidente</span>` : ""}<span class="tag status-tag status-${status}">${errorStatusLabel(entry)}</span></div>
      </div>
      <div class="error-block"><span class="field-title">Questão ou dúvida</span>${entry.statement ? `<p class="pre-wrap">${escapeHTML(entry.statement)}</p>` : ""}${questionShots}</div>
      ${entry.myAnswer && !answerHidden ? `<div class="error-block wrong"><span class="field-title">O que eu respondi</span><p class="pre-wrap">${escapeHTML(entry.myAnswer)}</p></div>` : ""}
      ${showAnswer ? `<div class="error-block right"><span class="field-title">Resposta correta</span>${entry.correctAnswer ? `<p class="pre-wrap">${escapeHTML(entry.correctAnswer)}</p>` : ""}${answerShots}</div>` : ""}
      ${entry.notes && !answerHidden ? `<div class="error-block notes"><span class="field-title">Meu caderno</span><div class="error-notes">${entry.notes}</div></div>` : ""}
      ${entry.foundation && !answerHidden ? `<div class="error-block"><span class="field-title">Fundamento</span><p class="pre-wrap">${escapeHTML(entry.foundation)}</p></div>` : ""}
      ${entry.rule && !answerHidden ? `<div class="error-block rule"><span class="field-title">Como não errar de novo</span><p class="pre-wrap">${escapeHTML(entry.rule)}</p></div>` : ""}
      ${tags}
      <div class="topic-meta">
        <span>Refeito ${entry.attempts}×</span>
        <span>Errou de novo ${entry.lapses}×</span>
        ${nextText ? `<span>${escapeHTML(nextText)}</span>` : ""}
      </div>
      ${retestArea}
      ${leechBox}
      <div class="inline-actions">
        ${entry.mastered ? `<button class="mini-button" data-cycle-action="reopenError" data-id="${entry.id}" type="button">Reabrir</button>` : `<button class="mini-button success" data-cycle-action="retestError" data-id="${entry.id}" type="button">${retesting ? "Reiniciar" : "Refazer agora"}</button>`}
        <button class="mini-button" data-cycle-action="errorToFlashcard" data-id="${entry.id}" type="button">Gerar flashcard</button>
        <button class="mini-button" data-cycle-action="editError" data-id="${entry.id}" type="button">Editar</button>
        ${entry.mastered ? "" : `<button class="mini-button" data-cycle-action="masterError" data-id="${entry.id}" type="button">Marcar dominado</button>`}
        <button class="mini-button bad" data-cycle-action="deleteError" data-id="${entry.id}" type="button">Excluir</button>
      </div>
    </article>`;
}

function updateErrorFormMode() {
  const editing = Boolean(cycleUI.errorEditId);
  $("#errorFormTitle").textContent = editing ? "Editar erro" : "Registrar erro";
  $("#errorSubmitBtn").textContent = editing ? "Salvar edição" : "Salvar no caderno";
  $("#errorCancelBtn").textContent = editing ? "Cancelar edição" : "Fechar";
}

/** Limpa o formulário. Com `keepContext`, mantém matéria, assunto, data e fonte para registrar vários erros seguidos. */
function resetErrorForm({ keepContext = false } = {}) {
  const kept = keepContext ? { subject: $("#errorSubject").value, topic: $("#errorTopic").value, date: $("#errorDate").value, source: $("#errorSource").value } : null;
  cycleUI.errorEditId = "";
  $("#errorForm").reset();
  if (kept) $("#errorSubject").value = kept.subject;
  populateTopicSelect($("#errorTopic"), { includeEmpty: true, subjectId: $("#errorSubject").value, emptyLabel: "Sem assunto específico" });
  $("#errorTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#errorSubject").value);
  if (kept) $("#errorTopic").value = kept.topic;
  $("#errorDate").value = kept ? kept.date : cycleToday();
  if (kept) $("#errorSource").value = kept.source;
  erroDraftReset();
  if (typeof erroNotesSet === "function") erroNotesSet("");
  errorFormMessage("");
  errorUpdateDuplicateWarning();
  updateErrorFormMode();
}

function errorFormMessage(text) {
  const box = $("#errorFormMsg");
  if (!box) return;
  box.textContent = text || "";
  box.classList.toggle("hidden", !text);
  if (text) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function fillErrorForm(entry) {
  cycleUI.errorEditId = entry.id;
  errorFormSet(true);
  $("#errorSubject").value = getEntrySubjectId(entry);
  populateTopicSelect($("#errorTopic"), { includeEmpty: true, subjectId: $("#errorSubject").value, emptyLabel: "Sem assunto específico" });
  $("#errorTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#errorSubject").value);
  $("#errorTopic").value = entry.topicId || "";
  $("#errorDate").value = entry.date;
  $("#errorSource").value = entry.source;
  $("#errorStatement").value = entry.statement;
  $("#errorMyAnswer").value = entry.myAnswer;
  $("#errorCorrect").value = entry.correctAnswer;
  $("#errorReason").value = entry.reason;
  $("#errorFoundation").value = entry.foundation;
  $("#errorRule").value = entry.rule;
  $("#errorTags").value = typeof hashtagsToInput === "function" ? hashtagsToInput(entry.tags) : entry.tags.join(" ");
  erroDraftReset(entry);
  if (typeof erroNotesSet === "function") erroNotesSet(entry.notes);
  errorFormMessage("");
  updateErrorFormMode();
  $("#errorForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Lei seca ---------- */

function renderLaw() {
  populateSubjectSelect($("#lawSubject"), { includeEmpty: true, emptyLabel: "Sem matéria" });
  $("#lawSubject").disabled = state.subjects.length === 0;
  const picker = $("#lawWeekdays");
  if (!picker.children.length) {
    picker.innerHTML = CYCLE_WEEKDAY_ORDER.map(
      (day) => `<label class="checkbox-line"><input type="checkbox" name="lawWeekday" value="${day}" ${CYCLE_DEFAULT_WEEKDAYS.includes(day) ? "checked" : ""} /> ${CYCLE_WEEKDAY_LABELS[day]}</label>`
    ).join("");
  }
  if (!$("#lawStartDate").value) $("#lawStartDate").value = cycleToday();
  if (!$("#lawEndDate").value) $("#lawEndDate").value = cycleAddDays(cycleToday(), 30);
  updateLawFormMode();

  const today = cycleToday();
  const summary = getCycleSummary();
  const infos = summary.laws;
  const active = infos.filter(({ info }) => !info.finished);
  const totalWork = infos.reduce((sum, { info }) => sum + info.total, 0);
  const doneWork = infos.reduce((sum, { info }) => sum + info.done, 0);
  const readTodayTotal = infos.reduce((sum, { info }) => sum + info.readToday, 0);
  $("#lawStats").innerHTML = [
    cycleStat("Planos ativos", String(active.length), `${infos.length - active.length} concluído(s)`),
    cycleStat("Meta de hoje", String(summary.lawPendingUnits), summary.lawPendingUnits ? `${summary.lawUnitLabel} ainda para ler` : active.length ? "meta cumprida ou dia de folga" : "sem planos ativos"),
    cycleStat("Lido hoje", String(readTodayTotal), "registrado nos planos"),
    cycleStat("Progresso geral", totalWork ? percent((doneWork / totalWork) * 100) : "–", totalWork ? `${doneWork} de ${totalWork} unidades` : "sem planos"),
  ].join("");

  $("#lawPlans").innerHTML = infos.length
    ? infos.map(({ plan, info }) => lawPlanCardHTML(plan, info, today)).join("")
    : `<div class="empty-state">Crie o primeiro plano (por exemplo, CF/88 arts. 1º a 250) e o app distribui as leituras por dia até a data final.</div>`;
}

function lawPlanCardHTML(plan, info, today) {
  const subject = getSubject(plan.subjectId);
  const weekdays = CYCLE_WEEKDAY_ORDER.filter((day) => plan.weekdays.includes(day)).map((day) => CYCLE_WEEKDAY_LABELS[day]).join(", ");
  const unit = plan.unitLabel;
  let todayLine;
  if (info.finished) {
    todayLine = `<p class="law-today done">Plano concluído. Parabéns! Revise pelos agendamentos da aba Revisão.</p>`;
  } else if (info.todayIsReading) {
    const left = Math.max(0, info.todayTarget - info.readToday);
    todayLine = left
      ? `<p class="law-today">Hoje: <strong>${escapeHTML(info.todayLabel)}</strong> (${info.todayTarget} ${escapeHTML(unit)})${info.readToday ? ` · já registrou ${info.readToday}` : ""}</p>`
      : `<p class="law-today done">Meta de hoje cumprida (${info.readToday} ${escapeHTML(unit)}).</p>`;
  } else {
    const next = info.rows[0];
    todayLine = `<p class="law-today rest">${info.notStarted ? "O plano começa em" : "Hoje é dia de folga."} ${next ? `Próxima leitura: <strong>${escapeHTML(cycleWeekdayShort(next.date))}, ${formatDate(next.date)}</strong> — ${escapeHTML(next.label)}` : ""}</p>`;
  }

  const showSchedule = Boolean(cycleUI.lawSchedule[plan.id]);
  let schedule = "";
  if (showSchedule) {
    const rows = info.rows.slice(0, 60);
    const history = plan.readLog.slice(-6).reverse();
    schedule = `
      <div class="law-schedule">
        <div class="table-wrap">
          <table class="law-schedule-table">
            <thead><tr><th>Data</th><th>Trecho</th><th>Qtde</th><th>Situação</th></tr></thead>
            <tbody>
              ${rows.length
                ? rows
                    .map((row) => {
                      const doneToday = row.isToday && info.readToday >= row.count;
                      const state_ = row.isToday ? (doneToday ? "Concluída" : "Hoje") : "Planejada";
                      return `<tr class="${row.isToday ? "is-today" : ""}"><td>${escapeHTML(cycleWeekdayShort(row.date))}, ${formatDate(row.date)}</td><td>${escapeHTML(row.label)}</td><td>${row.count}</td><td>${state_}</td></tr>`;
                    })
                    .join("")
                : `<tr><td colspan="4">Nada pendente.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${info.rows.length > 60 ? `<p class="muted-note">Mostrando os primeiros 60 dias de leitura.</p>` : ""}
        ${history.length ? `<p class="muted-note"><strong>Últimos registros:</strong> ${history.map((entry) => `${formatShortDate(entry.date)} (${escapeHTML(lawWorkLabel(plan, entry.fromWork, entry.toWork))})`).join(" · ")}</p>` : ""}
      </div>`;
  }

  const per = lawUnitsPerPass(plan);
  const offset = plan.doneWork % per;
  return `
    <article class="law-plan-card">
      <div class="performance-top">
        <div>
          <strong>${escapeHTML(plan.title)}</strong>
          <small>${subject ? `${escapeHTML(subject.name)} · ` : ""}${escapeHTML(unit)} ${plan.startUnit}–${plan.endUnit}${plan.passes > 1 ? ` · ${plan.passes} leituras` : ""} · ${formatDate(plan.startDate)} a ${formatDate(plan.endDate)}</small>
        </div>
        <span class="tag tone-${info.tone}">${escapeHTML(info.status)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="--progress:${clamp(info.pct, 0, 100)}%; --fill:${subject?.color || "var(--teal)"}"></div></div>
      <div class="topic-meta">
        <span>${info.done} de ${info.total} ${escapeHTML(unit)} (${percent(info.pct)})</span>
        ${plan.passes > 1 && !info.finished ? `<span>Leitura ${info.currentPass} de ${plan.passes}</span>` : ""}
        ${info.finished ? "" : `<span>${info.remainingDays} ${info.remainingDays === 1 ? "dia" : "dias"} de leitura · ritmo ${info.pacePerDay}/dia</span>`}
        <span>${escapeHTML(weekdays)}</span>
      </div>
      ${todayLine}
      ${info.finished ? "" : `
        <div class="law-register">
          ${info.todayIsReading && info.readToday < info.todayTarget ? `<button class="button primary" data-cycle-action="lawDone" data-id="${plan.id}" type="button">Concluí a meta de hoje</button>` : ""}
          <div class="law-register-field">
            <input id="lawReadInput-${plan.id}" type="number" min="${plan.startUnit}" max="${plan.endUnit}" placeholder="Li até o nº…" aria-label="Li até o número" ${offset ? `title="Você está em ${plan.startUnit + offset - 1}"` : ""} />
            <button class="button secondary" data-cycle-action="lawRegister" data-id="${plan.id}" type="button">Registrar</button>
          </div>
        </div>`}
      <div class="inline-actions">
        <button class="mini-button" data-cycle-action="toggleLawSchedule" data-id="${plan.id}" type="button">${showSchedule ? "Ocultar cronograma" : "Ver cronograma"}</button>
        ${plan.url ? `<a class="mini-button" href="${escapeHTML(plan.url)}" target="_blank" rel="noopener noreferrer">Abrir lei</a>` : ""}
        ${plan.readLog.length ? `<button class="mini-button" data-cycle-action="lawUndo" data-id="${plan.id}" type="button">Desfazer último registro</button>` : ""}
        <button class="mini-button" data-cycle-action="editLaw" data-id="${plan.id}" type="button">Editar</button>
        <button class="mini-button bad" data-cycle-action="deleteLaw" data-id="${plan.id}" type="button">Excluir</button>
      </div>
      ${schedule}
    </article>`;
}

function updateLawFormMode() {
  const editing = Boolean(cycleUI.lawEditId);
  $("#lawFormTitle").textContent = editing ? "Editar plano de leitura" : "Novo plano de leitura";
  $("#lawSubmitBtn").textContent = editing ? "Salvar plano" : "Criar plano";
  $("#lawCancelBtn").classList.toggle("hidden", !editing);
  $("#lawAlreadyReadLabel").classList.toggle("hidden", editing);
}

function resetLawForm() {
  cycleUI.lawEditId = "";
  $("#lawForm").reset();
  $("#lawStartDate").value = cycleToday();
  $("#lawEndDate").value = cycleAddDays(cycleToday(), 30);
  $$("input[name='lawWeekday']").forEach((input) => {
    input.checked = CYCLE_DEFAULT_WEEKDAYS.includes(Number(input.value));
  });
  updateLawFormMode();
}

function fillLawForm(plan) {
  cycleUI.lawEditId = plan.id;
  $("#lawTitle").value = plan.title;
  $("#lawSubject").value = plan.subjectId;
  $("#lawUnitLabel").value = plan.unitLabel;
  $("#lawStartUnit").value = plan.startUnit;
  $("#lawEndUnit").value = plan.endUnit;
  $("#lawPasses").value = plan.passes;
  $("#lawStartDate").value = plan.startDate;
  $("#lawEndDate").value = plan.endDate;
  $("#lawUrl").value = plan.url;
  $("#lawRevisions").checked = plan.scheduleRevisions;
  $("#lawAlreadyRead").value = "";
  $$("input[name='lawWeekday']").forEach((input) => {
    input.checked = plan.weekdays.includes(Number(input.value));
  });
  updateLawFormMode();
  $("#lawForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function cycleRefresh() {
  saveState();
  render();
}

function cycleStartSession(id = "") {
  const due = getQueueRevisions();
  const target = id ? state.revisions.find((revision) => revision.id === id) : due[0];
  if (!target) return;
  cycleUI.sessionId = target.id;
  cycleUI.revealed = false;
  cycleUI.recall = "";
  renderCycle();
  $("#revisionSession")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cycleNextDue(excludeId) {
  return getQueueRevisions().find((revision) => revision.id !== excludeId) || null;
}

function handleCycleAction(button) {
  const type = button.dataset.cycleAction;
  const id = button.dataset.id || "";

  if (typeof handleTodayAction === "function" && handleTodayAction(type, button)) return undefined;
  if (typeof handlePushAction === "function" && handlePushAction(type, button)) return undefined;
  if (typeof handleSessionAction === "function" && handleSessionAction(type, button)) return undefined;
  if (typeof handleMesclarAction === "function" && handleMesclarAction(type, button)) return undefined;

  /* lembretes */
  if (type === "reviewNow") {
    cycleUI.sessionId = "";
    setView("revisao", { scrollTop: true });
    cycleStartSession();
    return undefined;
  }
  if (type === "dismissBanner") {
    cycleUI.bannerHidden = true;
    renderCycle();
    return undefined;
  }
  if (type === "redistributeOverdue") {
    cycleRedistributeAction();
    return undefined;
  }
  if (type === "errorMergeDuplicate") {
    cycleUI.errorForceMerge = id;
    $("#errorForm").requestSubmit();
    return undefined;
  }
  if (type === "errorShowDuplicate") {
    const target = state.errorNotebook.find((entry) => entry.id === id);
    if (target) {
      cycleUI.errorFilters = { ...cycleUI.errorFilters, search: target.statement.trim().slice(0, 40), subject: "", topic: "", reason: "", status: "all" };
      renderCycle();
      $("#errorSearch")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return undefined;
  }
  if (type === "queueMore") {
    const today = cycleToday();
    cycleUI.extra = { date: today, count: (cycleUI.extra && cycleUI.extra.date === today ? cycleUI.extra.count : 0) + 5 };
    cycleRefresh();
    return undefined;
  }
  if (type === "consolidateRevisions") {
    cycleConsolidateAction();
    return undefined;
  }
  if (type === "notifyToggle") {
    cycleToggleNotifications();
    return undefined;
  }
  if (type === "notifyTest") {
    cycleTestNotification();
    return undefined;
  }
  if (type === "exportIcs") {
    cycleExportCalendar();
    return undefined;
  }
  if (type === "installApp") {
    cycleInstallApp();
    return undefined;
  }

  /* revisão */
  if (type === "startSession") return cycleStartSession();
  if (type === "openRevision") return cycleStartSession(id);
  if (type === "revealSession") {
    cycleUI.revealed = true;
    renderCycle();
    return undefined;
  }
  if (type === "skipSession") {
    const next = cycleNextDue(cycleUI.sessionId);
    cycleUI.sessionId = next ? next.id : "";
    cycleUI.revealed = false;
    cycleUI.recall = "";
    renderCycle();
    return undefined;
  }
  if (type === "rateRevision") {
    const chosen = button.dataset.result;
    const target = state.revisions.find((item) => item.id === id);
    const objective = target ? cycleObjectiveGrade(state.questionLogs, target.topicId) : null;
    const adjustment = cycleAdjustResult(chosen, objective);
    const result = adjustment.result;
    const step = completeRevision(id, result, cycleUI.recall, chosen);
    if (!step) return undefined;
    const next = cycleNextDue(id);
    cycleUI.sessionId = next ? next.id : "";
    cycleUI.revealed = false;
    cycleUI.recall = "";
    cycleRefresh();
    showToast(cycleRatedMessage({ step, result, chosen, adjustment, objective, tail: next ? "Segue a próxima da fila." : "Fila de hoje concluída." }));
    if (typeof todayAfterAction === "function") todayAfterAction("rev");
    return undefined;
  }
  if (type === "quickReview") {
    const done = quickReviewRevision(id);
    if (!done) return undefined;
    if (cycleUI.sessionId === id) {
      const next = cycleNextDue(id);
      cycleUI.sessionId = next ? next.id : "";
      cycleUI.revealed = false;
      cycleUI.recall = "";
    }
    cycleRefresh();
    showToast(cycleRatedMessage({ ...done }));
    if (typeof todayAfterAction === "function") todayAfterAction("rev");
    return undefined;
  }
  if (type === "undoQuickReview") {
    const restored = cycleUndoQuickReview();
    cycleRefresh();
    showToast(restored ? "Revisão desfeita: voltou para a fila." : "Não deu para desfazer: a revisão mudou desde então.");
    return undefined;
  }
  if (type === "finishRevision") {
    const revision = state.revisions.find((item) => item.id === id);
    if (!revision) return undefined;
    revision.status = "done";
    revision.updatedAt = new Date().toISOString();
    if (cycleUI.sessionId === id) cycleUI.sessionId = "";
    cycleRefresh();
    showToast("Revisão encerrada.");
    return undefined;
  }
  if (type === "deleteRevision") {
    if (!window.confirm("Excluir esta revisão agendada? Ela não será recriada automaticamente.")) return undefined;
    state.revisions = state.revisions.filter((revision) => revision.id !== id);
    if (cycleUI.sessionId === id) cycleUI.sessionId = "";
    cycleRefresh();
    showToast("Revisão excluída.");
    return undefined;
  }
  if (type === "backfillRevisions") {
    const since = cycleAddDays(cycleToday(), -CYCLE_BACKFILL_DAYS);
    const created = syncAutoRevisions({ since, force: true });
    cycleRefresh();
    showToast(created ? `${created} ${created === 1 ? "revisão criada" : "revisões criadas"} a partir dos últimos ${CYCLE_BACKFILL_DAYS} dias.` : "Nada novo para criar nos últimos dias.");
    return undefined;
  }

  /* caderno de erros */
  if (type === "errorFromQuestion") {
    const log = state.questionLogs.find((item) => item.id === id);
    cycleUI.errorEditId = "";
    cycleUI.errorPrefill = log ? { subjectId: getEntrySubjectId(log), topicId: log.topicId || "", date: log.date } : null;
    cycleUI.errorFormOpen = true;
    setView("erros", { scrollTop: true });
    return undefined;
  }
  if (type === "openErrorForm") {
    if (cycleUI.errorEditId) resetErrorForm();
    errorFormOpen();
    return undefined;
  }
  if (type === "errorNav") {
    const filters = cycleUI.errorFilters;
    filters.subject = button.dataset.subject || "";
    filters.topic = filters.subject ? button.dataset.topic || "" : "";
    if (filters.subject) cycleUI.errorNavOpen[filters.subject] = true;
    renderCycle();
    return undefined;
  }
  if (type === "errorNavToggle") {
    const subjectId = button.dataset.subject;
    const wasOpen = cycleUI.errorNavOpen[subjectId] ?? cycleUI.errorFilters.subject === subjectId;
    cycleUI.errorNavOpen[subjectId] = !wasOpen;
    renderCycle();
    return undefined;
  }
  if (type === "editError") {
    const entry = state.errorNotebook.find((item) => item.id === id);
    if (entry) fillErrorForm(entry);
    return undefined;
  }
  if (type === "cancelErrorEdit") {
    resetErrorForm();
    errorFormSet(false);
    return undefined;
  }
  if (type === "deleteError") {
    if (!window.confirm("Excluir este erro do caderno?")) return undefined;
    const removed = state.errorNotebook.find((entry) => entry.id === id);
    if (removed) erroEntryImagesDelete(removed);
    state.errorNotebook = state.errorNotebook.filter((entry) => entry.id !== id);
    if (cycleUI.errorEditId === id) resetErrorForm();
    cycleRefresh();
    showToast("Erro excluído.");
    return undefined;
  }
  if (type === "retestError") {
    cycleUI.errorRetest = { id, open: false };
    renderCycle();
    return undefined;
  }
  if (type === "showErrorAnswer") {
    cycleUI.errorRetest = { id, open: true };
    renderCycle();
    return undefined;
  }
  if (type === "errorResult") {
    const step = retestErrorEntry(id, button.dataset.result);
    cycleUI.errorRetest = { id: "", open: false };
    cycleRefresh();
    if (step) {
      const days = `${step.gap} ${step.gap === 1 ? "dia" : "dias"}`;
      const exam = `${step.examDate ? " (encurtado pela data da prova)" : ""}${step.leveled ? " (ajustado para um dia mais leve)" : ""}`;
      if (step.result === "forgot") showToast(step.leech ? `Errou de novo (${CYCLE_LEECH_LAPSES}× ou mais). Veja as sugestões para este erro reincidente.` : `Sem problema: volta em ${days}${exam}.`);
      else if (step.done) showToast("Erro dominado!");
      else if (step.result === "hard") showToast(`Acertou com dúvida. Volta em ${days} para firmar${exam}.`);
      else if (step.result === "easy") showToast(`Fácil! Volta em ${days}${exam}.`);
      else showToast(`Acertou. Volta em ${days}${exam}.`);
    }
    if (typeof todayAfterAction === "function") todayAfterAction("err");
    return undefined;
  }
  if (type === "errorReinforce") {
    const entry = state.errorNotebook.find((item) => item.id === id);
    if (!entry) return undefined;
    const made = errorCreateReinforcement(entry);
    if (made.error) {
      showToast(made.error);
      return undefined;
    }
    cycleRefresh();
    showToast(made.existing ? "Já existe um reforço aberto para este assunto." : "Reforço criado: aparece nas revisões de hoje.");
    return undefined;
  }
  if (type === "masterError" || type === "reopenError") {
    const entry = state.errorNotebook.find((item) => item.id === id);
    if (!entry) return undefined;
    if (type === "masterError") {
      entry.mastered = true;
      entry.dueDate = "";
    } else {
      entry.mastered = false;
      entry.stage = 0;
      entry.dueDate = cycleAddDays(cycleToday(), state.cycleSettings.errorIntervals[0]);
    }
    entry.updatedAt = new Date().toISOString();
    cycleRefresh();
    return undefined;
  }
  if (type === "errorToFlashcard") {
    const entry = state.errorNotebook.find((item) => item.id === id);
    if (!entry) return undefined;
    const subjectId = getEntrySubjectId(entry);
    if (!subjectId) {
      showToast("Vincule uma matéria ao erro para gerar o flashcard.");
      return undefined;
    }
    const hasShots = (entry.images || []).length || (entry.answerImages || []).length;
    const back = [entry.correctAnswer || (hasShots ? "Veja o print no caderno de erros." : ""), entry.foundation ? `Fundamento: ${entry.foundation}` : "", entry.rule ? `Regra: ${entry.rule}` : ""].filter(Boolean).join("\n\n");
    state.flashcards.push(normalizeFlashcard({ subjectId, topicId: entry.topicId, front: entry.statement || "Questão registrada em print (abra o caderno de erros).", back, difficulty: "hard", priority: "Alta" }));
    cycleRefresh();
    showToast("Flashcard criado (dificuldade: difícil).");
    return undefined;
  }
  if (type === "clearErrorFilters") {
    cycleUI.errorFilters = { search: "", subject: "", topic: "", reason: "", status: "all" };
    $("#errorSearch").value = "";
    renderCycle();
    return undefined;
  }

  /* lei seca */
  const plan = state.lawPlans.find((item) => item.id === id);
  if (type === "toggleLawSchedule") {
    cycleUI.lawSchedule[id] = !cycleUI.lawSchedule[id];
    renderCycle();
    return undefined;
  }
  if (type === "cancelLawEdit") {
    resetLawForm();
    return undefined;
  }
  if (type === "editLaw") {
    if (plan) fillLawForm(plan);
    return undefined;
  }
  if (type === "deleteLaw") {
    if (!plan || !window.confirm(`Excluir o plano "${plan.title}"? As revisões já agendadas são mantidas.`)) return undefined;
    state.lawPlans = state.lawPlans.filter((item) => item.id !== id);
    if (cycleUI.lawEditId === id) resetLawForm();
    cycleRefresh();
    showToast("Plano excluído.");
    return undefined;
  }
  if (type === "lawDone" || type === "lawRegister") {
    if (!plan) return undefined;
    const today = cycleToday();
    let units = 0;
    if (type === "lawDone") {
      const info = buildLawSchedule(plan, today);
      units = Math.max(0, info.todayTarget - info.readToday);
    } else {
      const input = document.getElementById(`lawReadInput-${plan.id}`);
      const result = lawUnitsFromPosition(plan, input?.value);
      if (result.error) {
        showToast(result.error);
        return undefined;
      }
      units = result.units;
    }
    const from = plan.doneWork;
    const registered = lawRegisterWork(plan, units, today);
    if (!registered) {
      showToast("Nada novo para registrar.");
      return undefined;
    }
    if (plan.scheduleRevisions) scheduleLawRevision(plan, from, plan.doneWork, today);
    cycleRefresh();
    showToast(`${registered} ${plan.unitLabel} registrados${plan.scheduleRevisions ? "; revisões agendadas" : ""}.`);
    if (typeof todayAfterAction === "function") todayAfterAction("law");
    return undefined;
  }
  if (type === "lawUndo") {
    if (!plan || !plan.readLog.length) return undefined;
    const last = plan.readLog[plan.readLog.length - 1];
    if (last.toWork !== plan.doneWork) {
      showToast("Só é possível desfazer o registro mais recente.");
      return undefined;
    }
    plan.readLog.pop();
    plan.doneWork = last.fromWork;
    plan.updatedAt = new Date().toISOString();
    const key = `law:${plan.id}:${last.date}`;
    const linked = state.revisions.find((revision) => revision.originKey === key && revision.status === "pending" && revision.history.length === 0);
    if (linked) {
      if ((linked.lawFromWork ?? 0) >= last.fromWork) {
        state.revisions = state.revisions.filter((revision) => revision.id !== linked.id);
      } else {
        linked.lawToWork = last.fromWork;
        linked.label = `${plan.title}: ${lawWorkLabel(plan, linked.lawFromWork, linked.lawToWork)}`;
      }
    }
    cycleRefresh();
    showToast("Último registro desfeito.");
    return undefined;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

function bindCycleEvents() {
  if (typeof bindCadernoEvents === "function") bindCadernoEvents();
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cycle-action]");
    if (button) handleCycleAction(button);
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "revisionRecall") cycleUI.recall = event.target.value;
    if (event.target.id === "errorSearch") {
      cycleUI.errorFilters.search = event.target.value;
      renderCycle();
    }
    if (event.target.id === "errorStatement") {
      window.clearTimeout(cycleUI.dupTimer);
      cycleUI.dupTimer = window.setTimeout(errorUpdateDuplicateWarning, 250);
    }
  });

  $("#revisionSubject").addEventListener("change", () => {
    populateTopicSelect($("#revisionTopic"), { includeEmpty: true, subjectId: $("#revisionSubject").value, emptyLabel: "Sem assunto específico" });
    $("#revisionTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#revisionSubject").value);
  });
  $("#errorSubject").addEventListener("change", () => {
    populateTopicSelect($("#errorTopic"), { includeEmpty: true, subjectId: $("#errorSubject").value, emptyLabel: "Sem assunto específico" });
    $("#errorTopic").disabled = !state.topics.some((topic) => topic.subjectId === $("#errorSubject").value);
  });

  [
    ["#errorFilterReason", "reason"],
    ["#errorFilterStatus", "status"],
  ].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => {
      cycleUI.errorFilters[key] = event.target.value;
      renderCycle();
    });
  });

  $("#revisionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const subjectId = $("#revisionSubject").value;
    if (!subjectId) {
      showToast("Escolha a matéria da revisão.");
      return;
    }
    const topicId = $("#revisionTopic").value;
    const baseDate = $("#revisionBaseDate").value || cycleToday();
    const today = cycleToday();
    createRevision({
      kind: "manual",
      subjectId,
      topicId,
      originKey: `manual:${cycleUid()}`,
      baseDate,
      dueDate: $("#revisionToday").checked ? today : "",
    });
    $("#revisionToday").checked = false;
    $("#revisionBaseDate").value = today;
    cycleRefresh();
    showToast("Revisão agendada.");
  });

  $("#cycleSettingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.cycleSettings.intervals = normalizeCycleIntervals($("#cycleIntervals").value, CYCLE_DEFAULT_INTERVALS);
    state.cycleSettings.errorIntervals = normalizeCycleIntervals($("#cycleErrorIntervals").value, CYCLE_DEFAULT_ERROR_INTERVALS);
    state.cycleSettings.autoFromStudy = $("#cycleAutoStudy").checked;
    state.cycleSettings.autoWeak = $("#cycleAutoWeak").checked;
    state.cycleSettings.examAdapt = $("#cycleExamAdapt").checked;
    state.cycleSettings.levelLoad = $("#cycleLevelLoad").checked;
    state.cycleSettings.capQueue = $("#cycleCapQueue").checked;
    state.cycleSettings.gradeFromQuestions = $("#cycleGradeFromQuestions").checked;
    state.cycleSettings.minAutoMinutes = cycleInt($("#cycleMinAuto").value, 5, 120, CYCLE_MIN_AUTO_MINUTES);
    state.cycleSettings.weakAccuracy = cycleInt($("#cycleWeakAccuracy").value, 30, 95, 70);
    state.cycleSettings.weakMinQuestions = cycleInt($("#cycleWeakMin").value, 5, 100, 10);
    $("#cycleIntervals").value = state.cycleSettings.intervals.join(", ");
    $("#cycleErrorIntervals").value = state.cycleSettings.errorIntervals.join(", ");
    cycleRefresh();
    showToast("Configurações do ciclo salvas.");
  });

  $("#errorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const forcedMerge = cycleUI.errorForceMerge; // vem do botão "Somar mais um erro nele" do aviso
    cycleUI.errorForceMerge = "";
    const subjectId = $("#errorSubject").value;
    const statement = $("#errorStatement").value.trim();
    const correctAnswer = $("#errorCorrect").value.trim();
    const notes = erroNotesGet();
    const hasContent = statement || correctAnswer || erroNotesText(notes) || erroNotesImageIds(notes).length || erroDraft.question.length || erroDraft.answer.length;
    if (!subjectId) {
      errorFormMessage("Escolha a matéria do erro. Se ainda não tem matéria, crie uma em “Nova matéria”.");
      return;
    }
    if (!hasContent) {
      errorFormMessage("Escreva alguma coisa (questão, explicação ou anotação) ou cole um print antes de salvar.");
      return;
    }
    errorFormMessage("");
    const submitButton = $("#errorSubmitBtn");
    submitButton.disabled = true; // evita salvar duas vezes enquanto os prints são gravados
    try {
      const shots = await erroDraftCommit();
      const topicId = $("#errorTopic").value;
      const existing = state.errorNotebook.find((entry) => entry.id === cycleUI.errorEditId);
      let repeated = null;
      const data = {
        subjectId: getTopic(topicId)?.subjectId || subjectId,
        topicId,
        date: $("#errorDate").value || cycleToday(),
        source: $("#errorSource").value,
        statement,
        myAnswer: $("#errorMyAnswer").value,
        correctAnswer,
        images: shots.images,
        answerImages: shots.answerImages,
        notes,
        reason: $("#errorReason").value,
        foundation: $("#errorFoundation").value,
        rule: $("#errorRule").value,
        tags: $("#errorTags").value,
      };
      if (existing) {
        const kept = new Set(erroNotesImageIds(notes));
        erroNotesImageIds(existing.notes).filter((id) => !kept.has(id)).forEach((id) => erroImgDelete(id));
        const updated = normalizeErrorEntry({ ...existing, ...data, updatedAt: new Date().toISOString() });
        Object.assign(existing, updated);
      } else {
        const firstGap = state.cycleSettings.errorIntervals[0];
        const duplicate = forcedMerge ? state.errorNotebook.find((entry) => entry.id === forcedMerge) : errorFindDuplicate(state.errorNotebook, data);
        const sumUp =
          duplicate &&
          (Boolean(forcedMerge) ||
          window.confirm(
            `Este erro parece já estar no caderno (cadastrado em ${duplicate.date.split("-").reverse().join("/")}${duplicate.lapses ? `, errado ${duplicate.lapses}× depois` : ""}).\n\nOK: somar mais um erro nele, sem duplicar.\nCancelar: salvar como um registro novo mesmo assim.`
          ));
        if (sumUp) {
          const { entry: merged, droppedImages } = errorRegisterRepeat(duplicate, normalizeErrorEntry({ ...data, createdAt: new Date().toISOString() }));
          droppedImages.forEach((image) => erroImgDelete(image.id));
          repeated = merged;
        } else {
          state.errorNotebook.push(normalizeErrorEntry({ ...data, dueDate: cycleAddDays(data.date, firstGap), createdAt: new Date().toISOString() }));
        }
      }
      resetErrorForm({ keepContext: !existing }); // erro novo: segue aberto, na mesma matéria, para o próximo
      if (existing) errorFormSet(false);
      if (typeof erroCloudKick === "function") erroCloudKick(); // manda os prints novos para a conta online
      cycleRefresh();
      showToast(
        shots.failed
          ? "Erro salvo, mas o navegador não guardou os prints de forma permanente. Eles somem ao fechar a aba."
          : existing
            ? "Erro atualizado."
            : repeated
              ? `Erro repetido: somei mais um nele (agora ${repeated.lapses}×). Ele volta em ${Math.max(1, Math.round((cycleDate(repeated.dueDate) - cycleDate(cycleToday())) / 86400000))} ${Math.round((cycleDate(repeated.dueDate) - cycleDate(cycleToday())) / 86400000) <= 1 ? "dia" : "dias"} para refazer.`
              : "Erro salvo. Ele volta para você refazer amanhã."
      );
      if (!existing) $("#errorStatement")?.focus();
    } finally {
      submitButton.disabled = false;
    }
  });

  $("#lawForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#lawTitle").value.trim();
    const startUnit = Number($("#lawStartUnit").value);
    const endUnit = Number($("#lawEndUnit").value);
    const startDate = $("#lawStartDate").value;
    const endDate = $("#lawEndDate").value;
    if (!title || !Number.isFinite(startUnit) || !Number.isFinite(endUnit) || endUnit < startUnit || !startDate || !endDate) {
      showToast("Preencha título, intervalo (do nº ao nº) e as datas.");
      return;
    }
    if (endDate < startDate) {
      showToast("A data final não pode ser anterior ao início.");
      return;
    }
    const weekdays = $$("input[name='lawWeekday']:checked").map((input) => Number(input.value));
    if (!weekdays.length) {
      showToast("Marque ao menos um dia da semana para ler.");
      return;
    }
    const data = {
      title,
      subjectId: $("#lawSubject").value,
      unitLabel: $("#lawUnitLabel").value,
      url: $("#lawUrl").value,
      startUnit,
      endUnit,
      passes: $("#lawPasses").value,
      startDate,
      endDate,
      weekdays,
      scheduleRevisions: $("#lawRevisions").checked,
    };
    const existing = state.lawPlans.find((plan) => plan.id === cycleUI.lawEditId);
    if (existing) {
      Object.assign(existing, normalizeLawPlan({ ...existing, ...data, updatedAt: new Date().toISOString() }));
    } else {
      const plan = normalizeLawPlan({ ...data });
      const already = Number($("#lawAlreadyRead").value);
      if (Number.isFinite(already) && already >= plan.startUnit) {
        plan.doneWork = Math.min(lawUnitsPerPass(plan), already - plan.startUnit + 1);
      }
      state.lawPlans.push(plan);
    }
    resetLawForm();
    cycleRefresh();
    showToast(existing ? "Plano atualizado." : "Plano criado. O cronograma já está pronto.");
  });

  $("#reminderForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const morning = $("#reminderTime").value;
    const evening = $("#eveningTime").value;
    if (!cycleIsTime(morning)) {
      showToast("Informe o horário do aviso da manhã.");
      return;
    }
    state.cycleSettings.reminderTime = morning;
    state.cycleSettings.eveningTime = cycleIsTime(evening) ? evening : "";
    state.cycleSettings.dailyLimit = cycleInt($("#dailyLimit").value, 1, 200, 12);
    state.cycleSettings.backupDays = cycleInt($("#backupDays").value, 0, 90, 7);
    cycleRefresh();
    showToast("Horários dos lembretes salvos.");
  });

  cycleRegisterServiceWorker();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    cycleUI.installPrompt = event;
    renderReminderPanel();
  });
  window.addEventListener("appinstalled", () => {
    cycleUI.installPrompt = null;
    renderReminderPanel();
  });
  window.setInterval(cycleReminderTick, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) cycleReminderTick();
  });
  window.setTimeout(cycleReminderTick, 1500);
  if (typeof bindTodayEvents === "function") bindTodayEvents();
  if (typeof bindSessionEvents === "function") bindSessionEvents();
  if (typeof bindMesclarEvents === "function") bindMesclarEvents();
}


/* ------------------------------------------------------------------ */
/* Lembretes automáticos (site estático: notificação, selo, banner,   */
/* agenda .ics e app instalável)                                       */
/* ------------------------------------------------------------------ */

const CYCLE_NOTIFY_KEY_PREFIX = "ymEstudos.cycleNotify.";
const CYCLE_ICS_DAYS = 90;

/**
 * Redistribui revisões (e, se passados, os erros do caderno) atrasadas respeitando um máximo por dia,
 * somando o que já vence em cada dia. Mais antigas primeiro; não mexe no que já vence hoje ou depois.
 * Itens de erro voltam com kind: "error".
 */
function cycleRedistributeOverdue(revisions, today, limit, errors = []) {
  const perDay = {};
  const count = (date) => {
    perDay[date] = (perDay[date] || 0) + 1;
  };
  revisions.filter((revision) => revision.status === "pending" && revision.dueDate >= today).forEach((revision) => count(revision.dueDate));
  const openErrors = (errors || []).filter((entry) => !entry.mastered && entry.dueDate);
  openErrors.filter((entry) => entry.dueDate >= today).forEach((entry) => count(entry.dueDate));
  const overdue = [
    ...revisions.filter((revision) => revision.status === "pending" && revision.dueDate < today).map((revision) => ({ id: revision.id, dueDate: revision.dueDate, error: false })),
    ...openErrors.filter((entry) => entry.dueDate < today).map((entry) => ({ id: entry.id, dueDate: entry.dueDate, error: true })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || Number(a.error) - Number(b.error));
  const changes = [];
  let day = today;
  overdue.forEach((item) => {
    for (let guard = 0; (perDay[day] || 0) >= limit && guard < 400; guard += 1) day = cycleAddDays(day, 1);
    count(day);
    changes.push(item.error ? { id: item.id, dueDate: day, kind: "error" } : { id: item.id, dueDate: day });
  });
  return changes;
}

function cycleReminderMessage({ revDue = 0, revOverdue = 0, errorsDue = 0, lawLabel = "", backupDue = false, flashDue = 0 } = {}) {
  const parts = [];
  if (revDue) {
    parts.push(`${cyclePlural(revDue, "revisão", "revisões")}${revOverdue ? ` (${cyclePlural(revOverdue, "atrasada", "atrasadas")})` : ""}`);
  }
  if (flashDue) parts.push(cyclePlural(flashDue, "flashcard", "flashcards"));
  if (errorsDue) parts.push(`${cyclePlural(errorsDue, "erro", "erros")} para refazer`);
  if (lawLabel) parts.push(`Lei seca: ${lawLabel}`);
  if (backupDue) parts.push("backup semanal pendente");
  if (!parts.length) return null;
  return {
    title: revOverdue ? "Revisões atrasadas: não deixe o conteúdo esfriar" : revDue || errorsDue || flashDue || lawLabel ? "Hora de revisar" : "Lembrete do Estudos Track",
    body: parts.join(" · "),
  };
}

function cycleMessageInput(summary) {
  const first = summary.lawToday[0];
  return {
    revDue: summary.revDue,
    revOverdue: summary.revOverdue,
    errorsDue: summary.errorsDue,
    lawLabel: first ? `${first.info.todayLabel}${summary.lawToday.length > 1 ? ` (+${summary.lawToday.length - 1})` : ""}` : "",
    backupDue: typeof backupIsDue === "function" ? backupIsDue().due : false,
    flashDue: typeof getFlashDueCount === "function" ? getFlashDueCount() : 0,
  };
}

/* ---------- agenda .ics ---------- */

function cycleIcsEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Dobra linhas em 75 octetos (RFC 5545), sem partir caracteres UTF-8. */
function cycleIcsFold(line) {
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const size = (char) => (encoder ? encoder.encode(char).length : 1);
  const out = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const width = size(char);
    if (bytes + width > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += width;
  }
  out.push(current);
  return out.join("\r\n ");
}

function cycleIcsStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function cycleIcsLocal(dateISO, time, addMinutes = 0) {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute + addMinutes);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

/** events: [{ uid, date: "AAAA-MM-DD", time: "HH:MM", minutes, summary, description }] */
function buildIcs(events, { now = new Date(), calendarName = "Estudos Track: revisões" } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Estudos Track//Revisao//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${cycleIcsEscape(calendarName)}`];
  events.forEach((event) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${cycleIcsStamp(now)}`,
      `DTSTART:${cycleIcsLocal(event.date, event.time)}`,
      `DTEND:${cycleIcsLocal(event.date, event.time, event.minutes || 30)}`,
      `SUMMARY:${cycleIcsEscape(event.summary)}`,
      `DESCRIPTION:${cycleIcsEscape(event.description || "")}`,
      "BEGIN:VALARM",
      "TRIGGER:PT0M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${cycleIcsEscape(event.summary)}`,
      "END:VALARM",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(cycleIcsFold).join("\r\n")}\r\n`;
}

/**
 * Etapas futuras de uma cadeia de revisão, supondo que cada revisão seja feita no dia
 * previsto e avaliada como "Bom" (o intervalo é contado entre uma revisão e a seguinte).
 */
function cycleProjectStages(stage, dueDate, intervals) {
  const out = [];
  let date = dueDate;
  for (let next = stage + 1; next < intervals.length; next += 1) {
    date = cycleAddDays(date, intervals[next]);
    out.push({ stage: next, date });
  }
  return out;
}

/**
 * Agrupa por dia o que entra na agenda: o que já está agendado (atrasados vão para hoje) e as
 * etapas futuras previstas. Entrada pura: itens já com texto pronto.
 */
function cycleCalendarGroups({ revisions = [], intervals = [], errors = [], errorIntervals = [], lawRows = [], flashDue = 0, today, horizon }) {
  const byDate = new Map();
  const bucket = (date) => {
    const key = date < today ? today : date;
    if (!byDate.has(key)) byDate.set(key, { date: key, rev: [], revNext: [], err: [], errNext: [], law: [], fc: 0 });
    return byDate.get(key);
  };
  revisions.forEach((revision) => {
    bucket(revision.dueDate).rev.push(`${revision.label} (R${Math.min(revision.stage + 1, intervals.length)}/${intervals.length})`);
    // Revisão atrasada será feita hoje: as etapas seguintes contam a partir daí.
    cycleProjectStages(revision.stage, revision.dueDate < today ? today : revision.dueDate, intervals).forEach((step) => {
      if (step.date <= horizon) bucket(step.date).revNext.push(`${revision.label} (R${step.stage + 1}/${intervals.length})`);
    });
  });
  errors.forEach((entry) => {
    bucket(entry.dueDate).err.push(entry.text);
    cycleProjectStages(entry.stage, entry.dueDate < today ? today : entry.dueDate, errorIntervals).forEach((step) => {
      if (step.date <= horizon) bucket(step.date).errNext.push(entry.text);
    });
  });
  lawRows.forEach((row) => bucket(row.date).law.push(row.text));
  if (flashDue > 0) bucket(today).fc = flashDue;
  return [...byDate.values()].filter((group) => group.date <= horizon).sort((a, b) => a.date.localeCompare(b.date));
}

function cycleCalendarEvent(group, time) {
  const parts = [];
  if (group.rev.length) parts.push(cyclePlural(group.rev.length, "revisão", "revisões"));
  if (group.revNext.length) parts.push(cyclePlural(group.revNext.length, "revisão prevista", "revisões previstas"));
  if (group.err.length) parts.push(cyclePlural(group.err.length, "erro", "erros"));
  if (group.errNext.length) parts.push(cyclePlural(group.errNext.length, "refação prevista", "refações previstas"));
  if (group.fc) parts.push(cyclePlural(group.fc, "flashcard", "flashcards"));
  if (group.law.length) parts.push("lei seca");
  const lines = [];
  const section = (title, items) => {
    if (!items.length) return;
    lines.push(`${title}:`);
    items.slice(0, 15).forEach((item) => lines.push(`- ${item}`));
    if (items.length > 15) lines.push(`+ ${items.length - 15} outros`);
  };
  section("Revisões", group.rev);
  section("Revisões previstas (se você acertar as anteriores)", group.revNext);
  section("Erros para refazer", group.err);
  section("Refações previstas", group.errNext);
  if (group.fc) lines.push(`Flashcards para revisar: ${group.fc}`);
  section("Lei seca", group.law);
  return {
    uid: `${group.date}-ciclo@estudostrack`,
    date: group.date,
    time,
    minutes: 30,
    summary: `Estudos Track: ${parts.join(", ")}`,
    description: lines.join("\n"),
  };
}

function getCycleCalendarEvents(days = CYCLE_ICS_DAYS) {
  ensureCycleState();
  const today = cycleToday();
  const horizon = cycleAddDays(today, days);
  const lawRows = [];
  state.lawPlans.forEach((plan) => {
    buildLawSchedule(plan, today).rows.forEach((row) => lawRows.push({ date: row.date, text: `${plan.title}: ${row.label}` }));
  });
  return cycleCalendarGroups({
    revisions: state.revisions
      .filter((revision) => revision.status === "pending")
      .map((revision) => ({ label: revisionLabel(revision), stage: revision.stage, dueDate: revision.dueDate })),
    intervals: state.cycleSettings.intervals,
    errors: state.errorNotebook
      .filter((entry) => !entry.mastered && entry.dueDate)
      .map((entry) => ({ text: cycleExcerpt(entry.statement, 70), stage: entry.stage, dueDate: entry.dueDate })),
    errorIntervals: state.cycleSettings.errorIntervals,
    lawRows,
    flashDue: typeof getFlashDueCount === "function" ? getFlashDueCount() : 0,
    today,
    horizon,
  }).map((group) => cycleCalendarEvent(group, state.cycleSettings.reminderTime));
}

function cycleExportCalendar() {
  const events = getCycleCalendarEvents();
  if (!events.length) {
    showToast("Não há revisões, erros ou leituras agendados para exportar.");
    return;
  }
  const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `estudos-track-revisoes-${cycleToday()}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  showToast(`Agenda com ${cyclePlural(events.length, "dia", "dias")} exportada, incluindo as etapas futuras previstas. Importe no seu calendário.`);
}

/* ---------- notificações, selo e instalação ---------- */

function cycleNotifyKey() {
  return `${CYCLE_NOTIFY_KEY_PREFIX}${state?.profile?.id || "default"}`;
}

function cycleNotifyRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(cycleNotifyKey()) || "{}");
    return { enabled: Boolean(raw.enabled), last: raw.last && typeof raw.last === "object" ? raw.last : {} };
  } catch {
    return { enabled: false, last: {} };
  }
}

function cycleNotifyWrite(data) {
  try {
    localStorage.setItem(cycleNotifyKey(), JSON.stringify(data));
  } catch {
    /* armazenamento indisponível: o aviso apenas não é lembrado */
  }
}

function cycleNotifySupported() {
  return typeof Notification !== "undefined";
}

function cycleBaseTitle() {
  return cycleUI.badgeCount > 0 ? `(${cycleUI.badgeCount}) ${APP_TITLE}` : APP_TITLE;
}

function cycleApplyBadge(count) {
  cycleUI.badgeCount = count;
  // Não sobrescreve o título do cronômetro do Pomodoro ("25:00 - Foco | ...").
  if (!document.title.includes(" | ")) document.title = cycleBaseTitle();
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch {
    /* recurso opcional */
  }
}

async function cycleShowNotification(message) {
  if (!cycleNotifySupported() || Notification.permission !== "granted") return false;
  const options = {
    body: message.body,
    icon: "assets/favicon-estudos-track.png",
    badge: "assets/favicon-estudos-track.png",
    tag: "estudos-track-revisao",
    data: { view: "revisao" },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(message.title, options);
      return true;
    }
  } catch {
    /* cai para a notificação comum */
  }
  try {
    const notification = new Notification(message.title, options);
    notification.onclick = () => {
      window.focus();
      setView("revisao", { scrollTop: true });
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** Dispara o aviso do dia quando um horário configurado já passou e ainda não foi avisado. */
function cycleMaybeNotify(summary) {
  if (typeof isProfileAuthenticated !== "function" || !isProfileAuthenticated()) return;
  const store = cycleNotifyRead();
  if (!store.enabled || !cycleNotifySupported() || Notification.permission !== "granted") return;
  const times = [state.cycleSettings.reminderTime, state.cycleSettings.eveningTime].filter(Boolean);
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const today = cycleToday();
  const reached = times.filter((time) => clock >= time && store.last[time] !== today);
  if (!reached.length) return;
  reached.forEach((time) => {
    store.last[time] = today;
  });
  cycleNotifyWrite(store);
  const message = cycleReminderMessage(cycleMessageInput(summary));
  if (message) cycleShowNotification(message);
}

function cycleReminderTick() {
  try {
    if (!state || typeof isProfileAuthenticated !== "function" || !isProfileAuthenticated()) {
      cycleApplyBadge(0);
      return;
    }
    ensureCycleState();
    const summary = getCycleSummary();
    cycleApplyBadge(summary.revDue + summary.errorsDue + summary.lawToday.length);
    cycleMaybeNotify(summary);
  } catch (error) {
    console.error("Ciclo de estudos (lembretes):", error);
  }
}

async function cycleToggleNotifications() {
  const store = cycleNotifyRead();
  if (store.enabled) {
    store.enabled = false;
    cycleNotifyWrite(store);
    renderReminderPanel();
    showToast("Notificações desativadas neste dispositivo.");
    return;
  }
  if (!cycleNotifySupported()) {
    showToast("Este navegador não oferece notificações. Use o banner e a agenda .ics.");
    return;
  }
  let permission = Notification.permission;
  // Pedir também quando reportado como "denied": em bloqueio real o navegador responde na hora, sem perguntar.
  if (permission !== "granted") permission = await Notification.requestPermission();
  if (permission !== "granted") {
    renderReminderPanel();
    showToast("As notificações estão bloqueadas. Libere nas configurações do site no navegador.");
    return;
  }
  store.enabled = true;
  cycleNotifyWrite(store);
  renderReminderPanel();
  cycleReminderTick();
  showToast("Notificações ativadas neste dispositivo.");
}

async function cycleTestNotification() {
  if (!cycleNotifySupported() || Notification.permission !== "granted") {
    showToast("Ative as notificações primeiro.");
    return;
  }
  const message = cycleReminderMessage(cycleMessageInput(getCycleSummary())) || { title: "Lembretes ativos", body: "Nada vence hoje. Quando houver revisões, o aviso chega neste horário." };
  const ok = await cycleShowNotification(message);
  showToast(ok ? "Aviso de teste enviado." : "Não foi possível exibir a notificação.");
}

async function cycleInstallApp() {
  const prompt = cycleUI.installPrompt;
  if (!prompt) return;
  prompt.prompt();
  try {
    await prompt.userChoice;
  } catch {
    /* escolha ignorada */
  }
  cycleUI.installPrompt = null;
  renderReminderPanel();
}

function cycleRegisterServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!secure) return;
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker não registrado:", error));
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "open-view" && typeof isProfileAuthenticated === "function" && isProfileAuthenticated()) {
      setView(event.data.view || "revisao", { scrollTop: true });
    }
  });
}

function cycleRedistributeAction() {
  const today = cycleToday();
  const limit = state.cycleSettings.dailyLimit;
  const changes = cycleRedistributeOverdue(state.revisions, today, limit, state.errorNotebook);
  if (!changes.length) {
    showToast("Não há revisões nem erros atrasados.");
    return;
  }
  const errorChanges = changes.filter((change) => change.kind === "error");
  const revisionChanges = changes.filter((change) => change.kind !== "error");
  const what = [revisionChanges.length ? cyclePlural(revisionChanges.length, "revisão atrasada", "revisões atrasadas") : "", errorChanges.length ? cyclePlural(errorChanges.length, "erro atrasado", "erros atrasados") : ""].filter(Boolean).join(" e ");
  const lastDay = changes.reduce((max, change) => (change.dueDate > max ? change.dueDate : max), today);
  const spanDays = daysBetween(today, lastDay) + 1;
  if (!window.confirm(`Redistribuir ${what} em ${cyclePlural(spanDays, "dia", "dias")}, com no máximo ${limit} por dia (revisões e erros juntos)? Os mais antigos vêm primeiro.`)) return;
  const now = new Date().toISOString();
  changes.forEach((change) => {
    const item = (change.kind === "error" ? state.errorNotebook : state.revisions).find((entry) => entry.id === change.id);
    if (item) {
      item.dueDate = change.dueDate;
      item.updatedAt = now;
    }
  });
  cycleRefresh();
  showToast(`${cyclePlural(changes.length, "item redistribuído", "itens redistribuídos")} até ${formatShortDate(lastDay)}.`);
}

function renderReviewBanner(summary) {
  const banner = $("#reviewBanner");
  if (!banner) return;
  const total = summary.revDue + summary.errorsDue;
  const authenticated = typeof isProfileAuthenticated === "function" && isProfileAuthenticated();
  const show = authenticated && total > 0 && !["revisao", "hoje"].includes(state.ui.view) && !cycleUI.bannerHidden;
  banner.classList.toggle("hidden", !show);
  if (!show) return;
  banner.classList.toggle("urgent", summary.revOverdue > 0);
  const parts = [];
  if (summary.revDue) {
    parts.push(`${cyclePlural(summary.revDue, "revisão", "revisões")}${summary.revOverdue ? ` (${cyclePlural(summary.revOverdue, "atrasada", "atrasadas")})` : ""}`);
  }
  if (summary.errorsDue) parts.push(`${cyclePlural(summary.errorsDue, "erro", "erros")} para refazer`);
  banner.innerHTML = `
    <div><strong>Hora de revisar:</strong> ${escapeHTML(parts.join(" · "))}</div>
    <div class="inline-actions">
      ${summary.revDue ? `<button class="button primary" data-cycle-action="reviewNow" type="button">Revisar</button>` : ""}
      ${summary.errorsDue ? `<button class="button secondary" data-view="erros" type="button">Erros</button>` : ""}
      ${summary.revOverdue + summary.errOverdue > state.cycleSettings.dailyLimit ? `<button class="button ghost" data-cycle-action="redistributeOverdue" type="button">Redistribuir atrasadas</button>` : ""}
      <button class="mini-button" data-cycle-action="dismissBanner" type="button" title="Esconder este aviso por enquanto">Depois</button>
    </div>`;
}

function renderReminderPanel() {
  const status = $("#reminderStatus");
  if (!status) return;
  const settings = state.cycleSettings;
  cycleSetValueIfIdle("#reminderTime", settings.reminderTime);
  cycleSetValueIfIdle("#eveningTime", settings.eveningTime);
  cycleSetValueIfIdle("#dailyLimit", settings.dailyLimit);
  cycleSetValueIfIdle("#backupDays", settings.backupDays);
  const store = cycleNotifyRead();
  const toggle = $("#notifyToggleBtn");
  let text;
  let tone = "warn";
  if (!cycleNotifySupported()) {
    text = "Este navegador não oferece notificações. O banner, o selo na aba e a agenda .ics continuam funcionando.";
  } else if (Notification.permission === "denied") {
    text = "As notificações estão bloqueadas neste navegador. Libere nas configurações do site para receber os avisos.";
    tone = "bad";
  } else if (store.enabled && Notification.permission === "granted") {
    const times = [settings.reminderTime, settings.eveningTime].filter(Boolean).join(" e ");
    text = `Notificações ativas neste dispositivo, com aviso às ${times}.`;
    tone = "good";
  } else {
    text = "Notificações desativadas neste dispositivo.";
  }
  status.className = `reminder-status tone-${tone}`;
  status.textContent = text;
  if (toggle) toggle.textContent = store.enabled && cycleNotifySupported() && Notification.permission === "granted" ? "Desativar notificações" : "Ativar notificações neste dispositivo";
  $("#installAppBtn")?.classList.toggle("hidden", !cycleUI.installPrompt);
  if (typeof renderPushPanel === "function") renderPushPanel();
}

/* ---------- trilha de fixação ---------- */

function renderRevisionTrail(today) {
  const container = $("#revisionTrail");
  if (!container) return;
  const intervals = revisionIntervals();
  $("#revisionTrailLegend").textContent = `Aprendizado → ${intervals.map((days, index) => `R${index + 1} (${days}d)`).join(" → ")} → Fixado. O primeiro intervalo é a revisão; os demais são as revisões espaçadas.`;
  const pending = state.revisions.filter((revision) => revision.status === "pending").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const fixed = state.revisions.filter((revision) => revision.status === "done").length;
  const shown = pending.slice(0, 40);
  const rows = shown
    .map((revision) => {
      const left = daysBetween(today, revision.dueDate);
      let tone = "good";
      let status = `em ${cyclePlural(left, "dia", "dias")}`;
      if (revision.dueDate < today) {
        tone = "bad";
        status = `atrasada ${cyclePlural(daysBetween(revision.dueDate, today), "dia", "dias")}`;
      } else if (revision.dueDate === today) {
        tone = "warn";
        status = "hoje";
      }
      const steps = intervals
        .map((days, index) => {
          const cls = index < revision.stage ? "done" : index === revision.stage ? "current" : "";
          return `<li class="${cls}" title="R${index + 1} · ${cyclePlural(days, "dia", "dias")}">${index + 1}</li>`;
        })
        .join("");
      return `
        <div class="trail-row">
          <div class="trail-info"><strong>${escapeHTML(revisionLabel(revision))}</strong><small>aprendido em ${formatDate(revision.baseDate)}</small></div>
          <ol class="trail-steps" aria-label="Etapas da fixação">
            <li class="done" title="Aprendizado">A</li>${steps}<li class="final" title="Fixado">✓</li>
          </ol>
          <span class="tag tone-${tone}">${escapeHTML(status)}</span>
        </div>`;
    })
    .join("");
  container.innerHTML =
    (rows || `<div class="empty-state">Nenhum assunto em fixação ainda. Registre um estudo de 10 minutos ou mais e a trilha começa sozinha.</div>`) +
    (pending.length > shown.length ? `<p class="muted-note">Mostrando os 40 mais próximos de ${pending.length} em andamento.</p>` : "") +
    `<p class="muted-note">${cyclePlural(fixed, "assunto fixado", "assuntos fixados")} até agora.</p>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cycleReviewStep,
    buildLawSchedule,
    lawWorkSegments,
    lawWorkLabel,
    lawUnitsFromPosition,
    lawRegisterWork,
    lawTotalWork,
    normalizeLawPlan,
    normalizeCycleIntervals,
    normalizeCycleSettings,
    normalizeRevision,
    cycleAddDays,
    normalizeWeights,
    normalizeStudyWeekdays,
    cycleRedistributeOverdue,
    cycleConsolidatePlan,
    errorRetestResult,
    errorStatementKey,
    errorStatementNormalize,
    errorStatementTokens,
    errorStatementSimilarity,
    errorFindDuplicate,
    errorRegisterRepeat,
    cycleNextExamDate,
    cycleCapGapForExam,
    cycleScheduledStep,
    cycleLoadByDate,
    cycleLevelRadius,
    cycleLevelGap,
    cycleLeveledStep,
    cycleCapacitySlack,
    cyclePriority,
    cycleTodayQueue,
    cycleObjectiveGrade,
    quickReviewRevision,
    cycleUndoQuickReview,
    cycleQuickUndoNote,
    cycleRatedMessage,
    cycleSuggestResult,
    cycleAdjustResult,
    cycleSteadyLoad,
    cycleSustainabilityNote,
    cycleCapacityDueDate,
    cycleDaysBetween,
    errorIsLeech,
    errorDueCompare,
    cycleOpenStudyChain,
    cycleReminderMessage,
    cycleProjectStages,
    cycleCalendarGroups,
    cycleCalendarEvent,
    cycleIcsEscape,
    cycleIcsFold,
    buildIcs,
  };
}
