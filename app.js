const PROFILE_ROOT_KEY = "ymEstudos.profiles.v1";
const PROFILE_KEY_PREFIX = "ymEstudos.profile.";
const ACTIVE_SESSION_PROFILE_KEY = "ymEstudos.activeSessionProfile.v1";
const SOURCE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SOURCE_TEXT_LIMIT = 180000;
const LEGAL_IMAGE_MAX_BYTES = 2_500_000;

const titles = {
  dashboard: "Painel",
  controle: "Controle",
  plano: "Matérias",
  questoes: "Questões",
  flashcards: "Flashcards",
  anotacoes: "Anotações",
  jurisprudencias: "Jurisprudências",
  pomodoro: "Pomodoro",
  relatorios: "Relatórios",
  conta: "Conta",
};
const APP_TITLE = "estudos track";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const uid = () => {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === "function" ? randomUUID.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

let state = loadState();
let timer = {
  interval: null,
  running: false,
  mode: "focus",
  remaining: state.settings.focusMinutes * 60,
  elapsedFocusSeconds: 0,
  elapsedSinceLongBreakSeconds: 0,
  cycle: 1,
  subjectId: "",
  topicId: "",
};
const syncingSources = new Set();
let pomodoroAudioContext = null;
let lofiTickInterval = null;
let lofiTickStep = 0;

function todayISO() {
  return toISODate(new Date());
}

function toISODate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value) {
  if (!value) return "";
  return parseISODate(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatShortDate(value) {
  return parseISODate(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function formatMinutes(minutes) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h && m) return `${h}h ${m}min`;
  if (h) return `${h}h`;
  return `${m}min`;
}

function percent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  sessionStorage.removeItem(ACTIVE_SESSION_PROFILE_KEY);
  return createEmptyState();
}

function readJSON(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function getProfilesRoot() {
  const root = readJSON(PROFILE_ROOT_KEY);
  return {
    activeProfileId: typeof root?.activeProfileId === "string" ? root.activeProfileId : "",
    profiles: Array.isArray(root?.profiles) ? root.profiles : [],
  };
}

function profileStorageKey(profileId) {
  return `${PROFILE_KEY_PREFIX}${profileId}.v1`;
}

function normalizeProfileLogin(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function profilePinHash(name, pin) {
  return simpleHash(`${normalizeProfileLogin(name)}::${String(pin || "")}`);
}

function findProfileRecordByName(root, name) {
  const login = normalizeProfileLogin(name);
  return root.profiles.find((profile) => (profile.login || normalizeProfileLogin(profile.name)) === login);
}

function makeProfile(profile = {}) {
  return {
    id: profile.id || `perfil-${uid()}`,
    name: typeof profile.name === "string" ? profile.name : "",
    pinHash: typeof profile.pinHash === "string" ? profile.pinHash : "",
    createdAt: profile.createdAt || todayISO(),
  };
}

function looksLikeHTML(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function normalizeRichText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return sanitizeNoteHTML(looksLikeHTML(raw) ? raw : textToRichHTML(raw));
}

function renderRichText(value) {
  return sanitizeNoteHTML(looksLikeHTML(value) ? value : textToRichHTML(value || ""));
}

function richTextToPlain(value) {
  const raw = String(value || "");
  return (looksLikeHTML(raw) ? plainTextFromHTML(raw) : raw).replace(/\s+/g, " ").trim();
}

function normalizeHashtags(value) {
  const raw = Array.isArray(value) ? value.join(" ") : String(value || "");
  const tags = raw
    .split(/[\s,;]+/)
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((tag) => tag.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean);
  return [...new Set(tags.map((tag) => tag.toLowerCase()))];
}

function hashtagsToInput(tags = []) {
  return normalizeHashtags(tags)
    .map((tag) => `#${tag}`)
    .join(" ");
}

function normalizeFlashcard(card = {}) {
  const validDifficulties = ["hard", "medium", "easy"];
  const difficulty = validDifficulties.includes(card.difficulty) ? card.difficulty : "medium";
  return {
    id: card.id || uid(),
    subjectId: typeof card.subjectId === "string" ? card.subjectId : "",
    topicId: card.topicId || "",
    front: normalizeRichText(card.front),
    back: normalizeRichText(card.back),
    priority: card.priority || "Média",
    difficulty,
    createdAt: card.createdAt || todayISO(),
    dueDate: card.dueDate || todayISO(),
    nextDueReviewNumber: Number(card.nextDueReviewNumber || 0),
    reviews: Number(card.reviews || 0),
    correct: Number(card.correct || 0),
    wrong: Number(card.wrong || 0),
    lastReviewed: card.lastReviewed || "",
    updatedAt: card.updatedAt || "",
  };
}

function normalizeCaseItem(item = {}) {
  return {
    id: item.id || uid(),
    subjectId: typeof item.subjectId === "string" ? item.subjectId : "",
    topicId: typeof item.topicId === "string" ? item.topicId : "",
    title: typeof item.title === "string" ? item.title : "Jurisprudência sem título",
    date: item.date || todayISO(),
    theme: typeof item.theme === "string" ? item.theme : "",
    summary: normalizeRichText(item.summary),
    tags: normalizeHashtags(item.tags || item.hashtags || ""),
    source: typeof item.source === "string" ? item.source : "",
  };
}

function normalizeSource(source = {}) {
  return {
    id: source.id || uid(),
    category: normalizeCategoryName(source.category) || "Sem categoria",
    title: source.title || "Fonte sem nome",
    url: source.url || "",
    content: sanitizeNoteHTML(source.content || ""),
    lastImportedContent: sanitizeNoteHTML(source.lastImportedContent || ""),
    pendingContent: sanitizeNoteHTML(source.pendingContent || ""),
    autoSync: Boolean(source.autoSync),
    lastSyncAttemptAt: source.lastSyncAttemptAt || "",
    lastSyncedAt: source.lastSyncedAt || "",
    lastSyncStatus: source.lastSyncStatus || "",
    lastSyncError: source.lastSyncError || "",
    lastSyncHash: source.lastSyncHash || "",
    appliedSyncHash: source.appliedSyncHash || "",
    pendingSyncHash: source.pendingSyncHash || "",
    pendingSyncedAt: source.pendingSyncedAt || "",
    createdAt: source.createdAt || todayISO(),
    updatedAt: source.updatedAt || new Date().toISOString(),
  };
}

function normalizeLegalMaterial(item = {}) {
  const validTypes = ["law", "table", "image"];
  const title = typeof item.title === "string" ? item.title.trim() : "";
  return {
    id: item.id || uid(),
    type: validTypes.includes(item.type) ? item.type : "law",
    subjectId: typeof item.subjectId === "string" ? item.subjectId : "",
    topicId: typeof item.topicId === "string" ? item.topicId : "",
    title: title || "Material sem título",
    reference: typeof item.reference === "string" ? item.reference.trim() : "",
    content: typeof item.content === "string" ? item.content.trim() : "",
    source: typeof item.source === "string" ? item.source.trim() : "",
    createdAt: item.createdAt || todayISO(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

function normalizeState(candidate, fallbackProfileId = "") {
  const empty = createEmptyState({ id: fallbackProfileId || candidate.profile?.id, name: candidate.profile?.name, createdAt: candidate.profile?.createdAt });
  return {
    version: 2,
    profile: makeProfile(candidate.profile || empty.profile),
    subjects: Array.isArray(candidate.subjects) ? candidate.subjects : empty.subjects,
    topics: Array.isArray(candidate.topics) ? candidate.topics : empty.topics,
    questionLogs: Array.isArray(candidate.questionLogs) ? candidate.questionLogs : empty.questionLogs,
    studyLogs: Array.isArray(candidate.studyLogs) ? candidate.studyLogs : empty.studyLogs,
    flashcards: Array.isArray(candidate.flashcards) ? candidate.flashcards.map(normalizeFlashcard) : empty.flashcards,
    sources: Array.isArray(candidate.sources) ? candidate.sources.map(normalizeSource) : empty.sources,
    notes: Array.isArray(candidate.notes) ? candidate.notes : empty.notes,
    categories: Array.isArray(candidate.categories) ? candidate.categories.map(normalizeCategoryName).filter(Boolean) : empty.categories,
    goals: Array.isArray(candidate.goals) ? candidate.goals : empty.goals,
    cases: {
      STJ: Array.isArray(candidate.cases?.STJ) ? candidate.cases.STJ.map(normalizeCaseItem) : [],
      STF: Array.isArray(candidate.cases?.STF) ? candidate.cases.STF.map(normalizeCaseItem) : [],
    },
    legalMaterials: Array.isArray(candidate.legalMaterials) ? candidate.legalMaterials.map(normalizeLegalMaterial) : empty.legalMaterials,
    media: {
      url: typeof candidate.media?.url === "string" ? candidate.media.url : "",
    },
    account: {
      name: typeof candidate.account?.name === "string" ? candidate.account.name : "",
      email: typeof candidate.account?.email === "string" ? candidate.account.email : "",
    },
    settings: {
      focusMinutes: Number(candidate.settings?.focusMinutes) || 25,
      breakMinutes: Number(candidate.settings?.breakMinutes) || 5,
      longBreakMinutes: Number(candidate.settings?.longBreakMinutes) || 30,
      longBreakEveryMinutes: Number(candidate.settings?.longBreakEveryMinutes) || 120,
      cycles: Number(candidate.settings?.cycles) || 4,
      tickLofiEnabled: candidate.settings?.tickLofiEnabled !== false,
    },
    flashcardSettings: {
      reviewCounter: Number(candidate.flashcardSettings?.reviewCounter || 0),
      intervals: {
        hard: Number(candidate.flashcardSettings?.intervals?.hard) || 4,
        medium: Number(candidate.flashcardSettings?.intervals?.medium) || 8,
        easy: Number(candidate.flashcardSettings?.intervals?.easy) || 12,
      },
    },
      ui: {
        view: candidate.ui?.view || "dashboard",
        theme: candidate.ui?.theme === "dark" ? "dark" : "light",
        caseCourt: candidate.ui?.caseCourt || "STJ",
        caseSearch: typeof candidate.ui?.caseSearch === "string" ? candidate.ui.caseSearch : "",
        caseSubjectFilter: typeof candidate.ui?.caseSubjectFilter === "string" ? candidate.ui.caseSubjectFilter : "",
        caseTopicFilter: typeof candidate.ui?.caseTopicFilter === "string" ? candidate.ui.caseTopicFilter : "",
        reportRange: candidate.ui?.reportRange || "day",
      controlRange: candidate.ui?.controlRange || "week",
      controlDayDate: candidate.ui?.controlDayDate || todayISO(),
      controlWeekDate: candidate.ui?.controlWeekDate || todayISO(),
      controlMonth: candidate.ui?.controlMonth || todayISO().slice(0, 7),
      controlYear: Number(candidate.ui?.controlYear) || new Date().getFullYear(),
      activeFlashcardId: candidate.ui?.activeFlashcardId || "",
      flashcardAnswerOpen: Boolean(candidate.ui?.flashcardAnswerOpen),
      flashcardReviewOrder: candidate.ui?.flashcardReviewOrder === "due" ? "due" : "random",
      flashcardReviewScope: ["all", "subject", "topic"].includes(candidate.ui?.flashcardReviewScope) ? candidate.ui.flashcardReviewScope : "all",
      flashcardReviewSubjectId: candidate.ui?.flashcardReviewSubjectId || "",
      flashcardReviewTopicId: candidate.ui?.flashcardReviewTopicId || "",
      activeSourceId: candidate.ui?.activeSourceId || "",
      activeSourceEditId: candidate.ui?.activeSourceEditId || "",
      activeNoteId: candidate.ui?.activeNoteId || "",
      activeCaseEditId: candidate.ui?.activeCaseEditId || "",
      activeFlashcardEditId: candidate.ui?.activeFlashcardEditId || "",
    },
  };
}

function createEmptyState(profile = {}) {
  return {
    version: 2,
    profile: makeProfile(profile),
    subjects: [],
    topics: [],
    questionLogs: [],
    studyLogs: [],
    flashcards: [],
    sources: [],
    notes: [],
    categories: [],
    goals: [],
    cases: { STJ: [], STF: [] },
    legalMaterials: [],
    media: { url: "" },
    account: { name: "", email: "" },
    settings: { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 30, longBreakEveryMinutes: 120, cycles: 4, tickLofiEnabled: true },
    flashcardSettings: {
      reviewCounter: 0,
      intervals: { hard: 4, medium: 8, easy: 12 },
    },
      ui: {
        view: "dashboard",
        theme: "light",
        caseCourt: "STJ",
        caseSearch: "",
        caseSubjectFilter: "",
        caseTopicFilter: "",
        reportRange: "day",
      controlRange: "week",
      controlDayDate: todayISO(),
      controlWeekDate: todayISO(),
      controlMonth: todayISO().slice(0, 7),
      controlYear: new Date().getFullYear(),
      activeFlashcardId: "",
      flashcardAnswerOpen: false,
      flashcardReviewOrder: "random",
      flashcardReviewScope: "all",
      flashcardReviewSubjectId: "",
      flashcardReviewTopicId: "",
      activeSourceId: "",
      activeSourceEditId: "",
      activeNoteId: "",
      activeCaseEditId: "",
      activeFlashcardEditId: "",
    },
  };
}

function createSeedState() {
  const profile = state?.profile || {};
  const now = new Date();
  const s1 = uid();
  const s2 = uid();
  const s3 = uid();
  const t1 = uid();
  const t2 = uid();
  const t3 = uid();
  const t4 = uid();
  const t5 = uid();
  const day = (offset) => toISODate(addDays(now, offset));

  return {
    ...createEmptyState(profile),
    version: 2,
    subjects: [
      { id: s1, name: "Direito Constitucional", color: "#0f766e", goalHours: 5 },
      { id: s2, name: "Direito Administrativo", color: "#c2410c", goalHours: 4 },
      { id: s3, name: "Português", color: "#2563eb", goalHours: 3 },
    ],
    topics: [
      { id: t1, subjectId: s1, name: "Controle de constitucionalidade", priority: "Alta" },
      { id: t2, subjectId: s1, name: "Direitos fundamentais", priority: "Média" },
      { id: t3, subjectId: s2, name: "Atos administrativos", priority: "Alta" },
      { id: t4, subjectId: s2, name: "Improbidade administrativa", priority: "Média" },
      { id: t5, subjectId: s3, name: "Sintaxe do período composto", priority: "Alta" },
    ],
    questionLogs: [
      { id: uid(), topicId: t1, correct: 18, wrong: 6, date: day(-6), notes: "Revisar efeitos da decisão." },
      { id: uid(), topicId: t2, correct: 21, wrong: 4, date: day(-4), notes: "" },
      { id: uid(), topicId: t3, correct: 13, wrong: 9, date: day(-2), notes: "Confusão entre anulação e revogação." },
      { id: uid(), topicId: t5, correct: 16, wrong: 8, date: day(-1), notes: "Orações subordinadas." },
    ],
    studyLogs: [
      { id: uid(), topicId: t1, minutes: 50, date: day(-6), source: "Manual", note: "Lei seca e resumo." },
      { id: uid(), topicId: t2, minutes: 70, date: day(-5), source: "Pomodoro", note: "Questões comentadas." },
      { id: uid(), topicId: t3, minutes: 45, date: day(-3), source: "Manual", note: "" },
      { id: uid(), topicId: t4, minutes: 60, date: day(-2), source: "Pomodoro", note: "Jurisprudência." },
      { id: uid(), topicId: t5, minutes: 35, date: day(-1), source: "Manual", note: "" },
      { id: uid(), topicId: t1, minutes: 25, date: day(0), source: "Pomodoro", note: "Revisão rápida." },
    ],
    flashcards: [
      {
        id: uid(),
        topicId: t1,
        front: "Quando cabe controle concentrado de constitucionalidade?",
        back: "Quando a discussão recai diretamente sobre a validade constitucional de lei ou ato normativo perante a Constituição.",
        priority: "Alta",
        difficulty: "hard",
        createdAt: day(-3),
        dueDate: day(0),
        nextDueReviewNumber: 0,
        reviews: 0,
        correct: 0,
        wrong: 0,
        lastReviewed: "",
      },
      {
        id: uid(),
        topicId: t3,
        front: "Diferença entre anulação e revogação do ato administrativo.",
        back: "Anulação decorre de ilegalidade e pode ter efeitos retroativos; revogação decorre de conveniência e oportunidade.",
        priority: "Média",
        difficulty: "medium",
        createdAt: day(-2),
        dueDate: day(0),
        nextDueReviewNumber: 0,
        reviews: 0,
        correct: 0,
        wrong: 0,
        lastReviewed: "",
      },
    ],
    cases: {
      STJ: [
        {
          id: uid(),
          topicId: t4,
          title: "Improbidade administrativa e dolo específico",
          date: day(-10),
          theme: "Tema repetitivo",
          summary: "Registrar a tese, fundamentos centrais e impacto em questões sobre responsabilização.",
          source: "",
        },
      ],
      STF: [
        {
          id: uid(),
          topicId: t1,
          title: "Controle concentrado e efeitos da decisão",
          date: day(-8),
          theme: "ADI",
          summary: "Separar efeitos, modulação e legitimados para revisão antes do simulado.",
          source: "",
        },
      ],
    },
    media: { url: "" },
    settings: { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 30, longBreakEveryMinutes: 120, cycles: 4, tickLofiEnabled: true },
      ui: {
        view: "dashboard",
        theme: state?.ui?.theme === "dark" ? "dark" : "light",
        caseCourt: "STJ",
        caseSearch: "",
        caseSubjectFilter: "",
        caseTopicFilter: "",
        reportRange: "day",
      controlRange: "week",
      activeFlashcardId: "",
      flashcardAnswerOpen: false,
      flashcardReviewOrder: "random",
      flashcardReviewScope: "all",
      flashcardReviewSubjectId: "",
      flashcardReviewTopicId: "",
    },
  };
}

function saveState() {
  state.profile = makeProfile(state.profile);
  const root = getProfilesRoot();
  const previousRecord = root.profiles.find((profile) => profile.id === state.profile.id) || {};
  const login = normalizeProfileLogin(state.profile.name || previousRecord.name);
  if (!login || !state.profile.pinHash) return;
  const profileRecord = {
    id: state.profile.id,
    name: state.profile.name || "Perfil sem nome",
    login,
    pinHash: state.profile.pinHash || previousRecord.pinHash || "",
    updatedAt: new Date().toISOString(),
  };
  const profiles = root.profiles.filter((profile) => {
    const profileLogin = profile.login || normalizeProfileLogin(profile.name);
    return profile.id !== state.profile.id && profileLogin !== login;
  });
  profiles.push(profileRecord);
  profiles.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  sessionStorage.setItem(ACTIVE_SESSION_PROFILE_KEY, state.profile.id);
  localStorage.setItem(profileStorageKey(state.profile.id), JSON.stringify(state));
  localStorage.setItem(PROFILE_ROOT_KEY, JSON.stringify({ activeProfileId: "", profiles }));
}

function getSubject(id) {
  return state.subjects.find((subject) => subject.id === id);
}

function getTopic(id) {
  return state.topics.find((topic) => topic.id === id);
}

function getTopicLabel(topicId) {
  const topic = getTopic(topicId);
  if (!topic) return "Assunto removido";
  const subject = getSubject(topic.subjectId);
  return `${subject?.name || "Sem matéria"}: ${topic.name}`;
}

function getEntrySubjectId(entry = {}) {
  return entry.subjectId || getTopic(entry.topicId)?.subjectId || "";
}

function getEntryScopeLabel(entry = {}) {
  if (entry.topicId && getTopic(entry.topicId)) return getTopicLabel(entry.topicId);
  const subject = getSubject(getEntrySubjectId(entry));
  return subject ? subject.name : "Sem vínculo";
}

function resolveSubjectTopic(subjectSelector, topicSelector) {
  const topicId = $(topicSelector)?.value || "";
  const topic = getTopic(topicId);
  return {
    subjectId: topic?.subjectId || $(subjectSelector)?.value || "",
    topicId,
  };
}

function getTopicColor(topicId) {
  const topic = getTopic(topicId);
  const subject = topic ? getSubject(topic.subjectId) : null;
  return subject?.color || "#0f766e";
}

function getTopicStats(topicId) {
  const logs = state.questionLogs.filter((log) => log.topicId === topicId);
  const correct = logs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = logs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const total = correct + wrong;
  return {
    correct,
    wrong,
    total,
    accuracy: total ? (correct / total) * 100 : 0,
  };
}

function getSubjectStats(subjectId) {
  const questionLogs = state.questionLogs.filter((log) => getEntrySubjectId(log) === subjectId);
  const studyLogs = state.studyLogs.filter((log) => getEntrySubjectId(log) === subjectId);
  const correct = questionLogs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = questionLogs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const minutes = studyLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const total = correct + wrong;
  return {
    minutes,
    correct,
    wrong,
    total,
    accuracy: total ? (correct / total) * 100 : 0,
  };
}

function getRangePredicate(range) {
  const today = parseISODate(todayISO());
  const year = today.getFullYear();
  const month = today.getMonth();
  const monday = addDays(today, -((today.getDay() + 6) % 7));

  if (range === "day") {
    const date = todayISO();
    return (log) => log.date === date;
  }

  if (range === "week") {
    return (log) => {
      const date = parseISODate(log.date);
      return date >= monday && date <= today;
    };
  }

  if (range === "month") {
    return (log) => {
      const date = parseISODate(log.date);
      return date.getFullYear() === year && date.getMonth() === month;
    };
  }

  return (log) => {
    const date = parseISODate(log.date);
    return date.getFullYear() === year;
  };
}

function getRangeLabel(range) {
  return { day: "hoje", week: "na semana", month: "no mês", year: "no ano" }[range] || "no período";
}

function setView(view) {
  state.ui.view = view;
  saveState();
  render();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function populateTopicSelect(select, { includeEmpty = false, subjectId = "", emptyLabel = "Sem vínculo" } = {}) {
  if (!select) return;
  const current = select.value;
  const options = state.topics
    .filter((topic) => !subjectId || topic.subjectId === subjectId)
    .map((topic) => {
      const subject = getSubject(topic.subjectId);
      return `<option value="${topic.id}">${escapeHTML(subject?.name || "Sem matéria")} - ${escapeHTML(topic.name)}</option>`;
    })
    .join("");
  const topicIsAvailable = state.topics.some((topic) => topic.id === current && (!subjectId || topic.subjectId === subjectId));
  select.innerHTML = `${includeEmpty ? `<option value="">${escapeHTML(emptyLabel)}</option>` : ""}${options}`;
  if (topicIsAvailable || (includeEmpty && current === "")) {
    select.value = current;
  }
}

function populateSubjectSelect(select, { includeEmpty = false, emptyLabel = "Sem matéria" } = {}) {
  if (!select) return;
  const current = select.value;
  const options = state.subjects.map((subject) => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join("");
  select.innerHTML = `${includeEmpty ? `<option value="">${escapeHTML(emptyLabel)}</option>` : ""}${options}`;
  if (state.subjects.some((subject) => subject.id === current)) {
    select.value = current;
  } else if (includeEmpty) {
    select.value = "";
  }
}

function populateFlashcardReviewSelectors() {
  const orderSelect = $("#flashcardReviewOrder");
  const scopeSelect = $("#flashcardReviewScope");
  const subjectSelect = $("#flashcardReviewSubject");
  const topicSelect = $("#flashcardReviewTopic");
  if (!orderSelect || !scopeSelect || !subjectSelect || !topicSelect) return;

  state.ui.flashcardReviewOrder = state.ui.flashcardReviewOrder === "due" ? "due" : "random";
  state.ui.flashcardReviewScope = ["all", "subject", "topic"].includes(state.ui.flashcardReviewScope) ? state.ui.flashcardReviewScope : "all";

  if (!state.subjects.some((subject) => subject.id === state.ui.flashcardReviewSubjectId)) {
    state.ui.flashcardReviewSubjectId = state.subjects[0]?.id || "";
  }
  if (!state.topics.some((topic) => topic.id === state.ui.flashcardReviewTopicId)) {
    state.ui.flashcardReviewTopicId = state.topics[0]?.id || "";
  }

  orderSelect.value = state.ui.flashcardReviewOrder;
  scopeSelect.value = state.ui.flashcardReviewScope;
  subjectSelect.innerHTML = state.subjects.map((subject) => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join("");
  topicSelect.innerHTML = state.topics
    .map((topic) => {
      const subject = getSubject(topic.subjectId);
      return `<option value="${topic.id}">${escapeHTML(subject?.name || "Sem matéria")} - ${escapeHTML(topic.name)}</option>`;
    })
    .join("");
  subjectSelect.value = state.ui.flashcardReviewSubjectId;
  topicSelect.value = state.ui.flashcardReviewTopicId;

  const scope = state.ui.flashcardReviewScope;
  subjectSelect.closest("label").hidden = scope !== "subject";
  topicSelect.closest("label").hidden = scope !== "topic";
  subjectSelect.disabled = scope !== "subject" || state.subjects.length === 0;
  topicSelect.disabled = scope !== "topic" || state.topics.length === 0;
}

function populateCaseFilterSelectors() {
  const subjectSelect = $("#caseSubjectFilter");
  const topicSelect = $("#caseTopicFilter");
  const searchInput = $("#caseSearch");
  if (!subjectSelect || !topicSelect || !searchInput) return;

  if (!state.subjects.some((subject) => subject.id === state.ui.caseSubjectFilter)) state.ui.caseSubjectFilter = "";
  if (!state.topics.some((topic) => topic.id === state.ui.caseTopicFilter)) state.ui.caseTopicFilter = "";
  const selectedTopic = getTopic(state.ui.caseTopicFilter);
  if (state.ui.caseSubjectFilter && selectedTopic && selectedTopic.subjectId !== state.ui.caseSubjectFilter) {
    state.ui.caseTopicFilter = "";
  }

  const subjectOptions = state.subjects
    .map((subject) => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`)
    .join("");
  const topicOptions = state.topics
    .filter((topic) => !state.ui.caseSubjectFilter || topic.subjectId === state.ui.caseSubjectFilter)
    .map((topic) => {
      const subject = getSubject(topic.subjectId);
      return `<option value="${topic.id}">${escapeHTML(subject?.name || "Sem matéria")} - ${escapeHTML(topic.name)}</option>`;
    })
    .join("");

  if (document.activeElement !== searchInput) searchInput.value = state.ui.caseSearch || "";
  subjectSelect.innerHTML = `<option value="">Todas as matérias</option>${subjectOptions}`;
  topicSelect.innerHTML = `<option value="">Todos os assuntos</option>${topicOptions}`;
  subjectSelect.value = state.ui.caseSubjectFilter || "";
  topicSelect.value = state.ui.caseTopicFilter || "";
  subjectSelect.disabled = state.subjects.length === 0;
  topicSelect.disabled = state.topics.length === 0;
}

function ensureFormDefaults() {
  $("#questionDate").value ||= todayISO();
  $("#studyDate").value ||= todayISO();
  $("#caseDate").value ||= todayISO();
  $("#focusMinutes").value = state.settings.focusMinutes;
  $("#breakMinutes").value = state.settings.breakMinutes;
  $("#longBreakMinutes").value = state.settings.longBreakMinutes || 30;
  $("#longBreakEveryMinutes").value = state.settings.longBreakEveryMinutes || 120;
  $("#cycleTotal").value = state.settings.cycles;
  $("#musicUrl").value = state.media.url;
  $("#hardInterval").value = state.flashcardSettings.intervals.hard;
  $("#mediumInterval").value = state.flashcardSettings.intervals.medium;
  $("#easyInterval").value = state.flashcardSettings.intervals.easy;
  $("#controlDayDate").value = state.ui.controlDayDate || todayISO();
  $("#controlWeekDate").value = state.ui.controlWeekDate || todayISO();
  $("#controlMonthInput").value = state.ui.controlMonth || todayISO().slice(0, 7);
  $("#controlYearInput").value = state.ui.controlYear || new Date().getFullYear();
  $("#goalDate").value ||= todayISO();
  $("#accountName").value = state.account.name || state.profile.name || "";
  $("#accountEmail").value = state.account.email || "";
}

function applyTheme() {
  const isDark = state.ui.theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
}

function isProfileAuthenticated() {
  return Boolean(sessionStorage.getItem(ACTIVE_SESSION_PROFILE_KEY));
}

function applyProfileLock() {
  document.body.classList.toggle("profile-locked", !isProfileAuthenticated());
}

function render() {
  applyTheme();
  applyProfileLock();
  ensureFormDefaults();
  renderNavigation();
  renderProfilePanel();
  renderSelectors();
  renderDashboard();
  renderControl();
  renderGoals();
  renderPlan();
  renderQuestions();
  renderFlashcards();
  renderNotes();
  renderCases();
  renderPomodoro();
  renderReports();
  drawStudyCanvas();
}

function renderNavigation() {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === state.ui.view));
  $$(".nav-button, .topbar-actions .button, .quick-actions .button").forEach((button) => {
    if (button.dataset.view) button.classList.toggle("active", button.dataset.view === state.ui.view);
  });
  $("#pageTitle").textContent = titles[state.ui.view] || "Painel";
  $("#currentDate").textContent = new Date().toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const themeToggle = $("#themeToggleBtn");
  if (themeToggle) {
    const isDark = state.ui.theme === "dark";
    themeToggle.textContent = isDark ? "Modo claro" : "Modo escuro";
    themeToggle.setAttribute("aria-pressed", String(isDark));
  }
}

function renderProfilePanel() {
  const isAuthenticated = isProfileAuthenticated();
  const name = state.profile?.name?.trim();
  $("#profileLabel").textContent = isAuthenticated && name ? `Perfil: ${name}` : "Entrar no meu perfil";
  if (document.activeElement !== $("#profileName")) {
    $("#profileName").value = isAuthenticated ? name || "" : "";
  }
  if (document.activeElement !== $("#profilePin")) $("#profilePin").value = "";
  $("#profileAccessBtn").textContent = isAuthenticated ? "Salvar acesso" : "Entrar";
  $("#logoutProfileBtn").disabled = !isAuthenticated;
  $("#profileStatus").textContent = isAuthenticated && name
    ? `Somente os dados de ${name} estão abertos nesta sessão. Use Sair ao terminar.`
    : "Digite nome e PIN. Se o perfil não existir, ele será criado zerado, sem dados antigos ou de outro usuário.";
}

function accessProfileByNameAndPin(name, pin) {
  const cleanName = String(name || "").trim().replace(/\s+/g, " ");
  const cleanPin = String(pin || "").trim();
  if (!cleanName) {
    showToast("Informe o nome do perfil.");
    return;
  }
  if (cleanPin.length < 4) {
    showToast("Use um PIN com pelo menos 4 números ou caracteres.");
    return;
  }

  const root = getProfilesRoot();
  const record = findProfileRecordByName(root, cleanName);
  const pinHash = profilePinHash(cleanName, cleanPin);

  if (record) {
    if (!record.pinHash) {
      state = createEmptyState({ name: cleanName, pinHash });
      saveState();
      resetTimer();
      render();
      showToast("Perfil novo cadastrado zerado.");
      return;
    }

    if (record.pinHash !== pinHash) {
      showToast("Nome ou PIN inválido.");
      return;
    }

    const savedProfile = readJSON(profileStorageKey(record.id));
    state = savedProfile
      ? normalizeState(savedProfile, record.id)
      : createEmptyState({ id: record.id, name: record.name || cleanName, pinHash: record.pinHash });
    state.profile.name = record.name || cleanName;
    state.profile.pinHash = record.pinHash;
    saveState();
    resetTimer();
    render();
    showToast("Perfil carregado.");
    return;
  }

  state = createEmptyState({ name: cleanName, pinHash });
  saveState();
  resetTimer();
  render();
  showToast("Perfil novo cadastrado zerado.");
}

function logoutProfile() {
  sessionStorage.removeItem(ACTIVE_SESSION_PROFILE_KEY);
  pauseTimer();
  state = createEmptyState();
  resetTimer();
  render();
  showToast("Perfil fechado nesta sessão.");
}

function renderSelectors() {
  populateSubjectSelect($("#topicSubject"));
  populateSubjectSelect($("#timerSubject"));
  populateSubjectSelect($("#studySubject"));
  populateSubjectSelect($("#flashcardSubject"));
  populateSubjectSelect($("#caseSubject"), { includeEmpty: true, emptyLabel: "Sem matéria" });
  populateSubjectSelect($("#legalMaterialSubject"), { includeEmpty: true, emptyLabel: "Sem matéria" });

  populateTopicSelect($("#questionTopic"));
  populateTopicSelect($("#timerTopic"), { includeEmpty: true, subjectId: $("#timerSubject")?.value || "", emptyLabel: "Sem assunto específico" });
  populateTopicSelect($("#studyTopic"), { includeEmpty: true, subjectId: $("#studySubject")?.value || "", emptyLabel: "Sem assunto específico" });
  populateTopicSelect($("#flashcardTopic"), { includeEmpty: true, subjectId: $("#flashcardSubject")?.value || "", emptyLabel: "Sem assunto específico" });
  populateTopicSelect($("#caseTopic"), { includeEmpty: true, subjectId: $("#caseSubject")?.value || "", emptyLabel: "Sem assunto específico" });
  populateTopicSelect($("#legalMaterialTopic"), { includeEmpty: true, subjectId: $("#legalMaterialSubject")?.value || "", emptyLabel: "Sem assunto específico" });
  populateFlashcardReviewSelectors();
  populateCaseFilterSelectors();

  const subjectsDisabled = state.subjects.length === 0;
  const topicsDisabled = state.topics.length === 0;
  $("#questionTopic").disabled = topicsDisabled;
  ["#timerSubject", "#studySubject", "#flashcardSubject"].forEach((selector) => {
    $(selector).disabled = subjectsDisabled;
  });
  ["#timerTopic", "#studyTopic", "#flashcardTopic", "#caseTopic", "#legalMaterialTopic"].forEach((selector) => {
    $(selector).disabled = topicsDisabled;
  });
  $("#caseSubject").disabled = subjectsDisabled;
  $("#legalMaterialSubject").disabled = subjectsDisabled;
  $("#topicSubject").disabled = state.subjects.length === 0;
}

function syncScopedTopicSelect(subjectSelector, topicSelector) {
  const subjectId = $(subjectSelector)?.value || "";
  populateTopicSelect($(topicSelector), { includeEmpty: true, subjectId, emptyLabel: "Sem assunto específico" });
}

function renderDashboard() {
  const todayMinutes = state.studyLogs.filter(getRangePredicate("day")).reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const weekMinutes = state.studyLogs.filter(getRangePredicate("week")).reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const monthMinutes = state.studyLogs.filter(getRangePredicate("month")).reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const correct = state.questionLogs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = state.questionLogs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const totalQuestions = correct + wrong;
  const accuracy = totalQuestions ? (correct / totalQuestions) * 100 : 0;
  const rankedWithQuestions = getRankedTopics().filter((item) => item.total > 0);
  const weak = rankedWithQuestions[rankedWithQuestions.length - 1];

  $("#sideTodayHours").textContent = formatMinutes(todayMinutes);
  $("#sideTodayMeta").textContent = `${formatMinutes(weekMinutes)} acumulados na semana.`;

  $("#statGrid").innerHTML = [
    statCard("Hoje", formatMinutes(todayMinutes), "tempo registrado"),
    statCard("Semana", formatMinutes(weekMinutes), `${formatMinutes(monthMinutes)} no mês`),
    statCard("Questões", String(totalQuestions), `${correct} acertos e ${wrong} erros`),
    statCard("Precisão", percent(accuracy), weak ? `Reforçar ${weak.name}` : "sem ponto fraco ainda"),
  ].join("");

  renderWeekChart();
  renderStrengthList();
}

function statCard(label, value, caption) {
  return `
    <article class="stat-card">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
      <small>${escapeHTML(caption)}</small>
    </article>
  `;
}

function renderControl() {
  const range = state.ui.controlRange || "week";
  $$(".segment[data-control-range]").forEach((button) => button.classList.toggle("active", button.dataset.controlRange === range));
  $$("[data-period-field]").forEach((field) => field.classList.toggle("active", field.dataset.periodField === range));

  const meta = getControlPeriodMeta(range);
  const studyLogs = state.studyLogs.filter((log) => isDateBetween(log.date, meta.start, meta.end));
  const questionLogs = state.questionLogs.filter((log) => isDateBetween(log.date, meta.start, meta.end));
  const minutes = studyLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const correct = questionLogs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = questionLogs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const total = correct + wrong;
  const activeDays = new Set(studyLogs.map((log) => log.date)).size;
  const average = activeDays ? Math.round(minutes / activeDays) : 0;
  const weakTopic = getWeakTopicForLogs(questionLogs);

  $("#controlStats").innerHTML = [
    statCard("Período", meta.label, meta.caption),
    statCard("Tempo", formatMinutes(minutes), `${activeDays} dias com estudo`),
    statCard("Média", formatMinutes(average), "por dia ativo"),
    statCard("Questões", String(total), weakTopic ? `Reforçar ${weakTopic.name}` : `${correct} acertos e ${wrong} erros`),
  ].join("");

  $("#controlTimelineTitle").textContent = meta.timelineTitle;
  renderControlTimeline(meta, studyLogs, questionLogs);
  renderControlGoals(range, studyLogs);
  renderControlHistory(studyLogs, questionLogs);
}

function getControlPeriodMeta(range) {
  const today = parseISODate(todayISO());

  if (range === "day") {
    const selected = parseISODate(state.ui.controlDayDate || todayISO());
    return {
      start: selected,
      end: selected,
      label: formatDate(toISODate(selected)),
      caption: "dia selecionado",
      timelineTitle: "Resumo do dia",
      unit: "day",
    };
  }

  if (range === "month") {
    const [year, month] = String(state.ui.controlMonth || todayISO().slice(0, 7)).split("-").map(Number);
    const monthStart = new Date(year || today.getFullYear(), (month || today.getMonth() + 1) - 1, 1);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    return {
      start: monthStart,
      end: monthEnd,
      label: monthStart.toLocaleDateString("pt-BR", { month: "long" }),
      caption: String(monthStart.getFullYear()),
      timelineTitle: "Dias do mês selecionado",
      unit: "day",
    };
  }

  if (range === "year") {
    const selectedYear = Number(state.ui.controlYear) || today.getFullYear();
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31);
    return {
      start: yearStart,
      end: yearEnd,
      label: String(selectedYear),
      caption: "ano selecionado",
      timelineTitle: "Meses do ano selecionado",
      unit: "month",
    };
  }

  const weekReference = parseISODate(state.ui.controlWeekDate || todayISO());
  const startOfWeek = addDays(weekReference, -((weekReference.getDay() + 6) % 7));
  return {
    start: startOfWeek,
    end: addDays(startOfWeek, 6),
    label: "Semana",
    caption: `${formatShortDate(toISODate(startOfWeek))} a ${formatShortDate(toISODate(addDays(startOfWeek, 6)))}`,
    timelineTitle: "Dias da semana",
    unit: "day",
  };
}

function isDateBetween(value, start, end) {
  const date = parseISODate(value);
  return date >= start && date <= end;
}

function getWeakTopicForLogs(questionLogs) {
  const byTopic = new Map();
  questionLogs.forEach((log) => {
    const current = byTopic.get(log.topicId) || { correct: 0, wrong: 0 };
    current.correct += Number(log.correct || 0);
    current.wrong += Number(log.wrong || 0);
    byTopic.set(log.topicId, current);
  });

  return Array.from(byTopic.entries())
    .map(([topicId, stats]) => {
      const total = stats.correct + stats.wrong;
      const topic = getTopic(topicId);
      return {
        id: topicId,
        name: topic?.name || "Assunto removido",
        total,
        accuracy: total ? (stats.correct / total) * 100 : 0,
      };
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => a.accuracy - b.accuracy)[0];
}

function renderControlTimeline(meta, studyLogs, questionLogs) {
  const rows = getControlTimelineRows(meta, studyLogs, questionLogs);
  const maxMinutes = Math.max(1, ...rows.map((row) => row.minutes));
  $("#controlTimeline").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
        <article class="control-row">
          <div class="control-row-top">
            <strong>${escapeHTML(row.label)}</strong>
            <span class="tag">${formatMinutes(row.minutes)}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="--progress:${clamp((row.minutes / maxMinutes) * 100, 0, 100)}%; --fill:#0f766e"></div>
          </div>
          <div class="control-metrics">
            <span>${row.sessions} sessões</span>
            <span>${row.questions} questões</span>
            <span>${percent(row.accuracy)} precisão</span>
          </div>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Nenhuma atividade no período.</div>`;
}

function getControlTimelineRows(meta, studyLogs, questionLogs) {
  if (meta.unit === "month") {
    return Array.from({ length: 12 }, (_, index) => {
      const label = new Date(meta.start.getFullYear(), index, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      const studies = studyLogs.filter((log) => parseISODate(log.date).getMonth() === index);
      const questions = questionLogs.filter((log) => parseISODate(log.date).getMonth() === index);
      return buildControlTimelineRow(label, studies, questions);
    });
  }

  const totalDays = Math.round((meta.end - meta.start) / 86400000) + 1;
  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(meta.start, index);
    const iso = toISODate(date);
    const label = meta.start.getTime() === meta.end.getTime() ? "Hoje" : formatShortDate(iso);
    const studies = studyLogs.filter((log) => log.date === iso);
    const questions = questionLogs.filter((log) => log.date === iso);
    return buildControlTimelineRow(label, studies, questions);
  });
}

function buildControlTimelineRow(label, studies, questions) {
  const minutes = studies.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const correct = questions.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = questions.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const total = correct + wrong;
  return {
    label,
    minutes,
    sessions: studies.length,
    questions: total,
    accuracy: total ? (correct / total) * 100 : 0,
  };
}

function renderControlGoals(range, studyLogs) {
  const multiplier = { day: 1 / 7, week: 1, month: 4, year: 52 }[range] || 1;
  const rows = state.subjects.map((subject) => {
    const minutes = studyLogs
      .filter((log) => getEntrySubjectId(log) === subject.id)
      .reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    const goalMinutes = Math.max(1, Math.round(Number(subject.goalHours || 0) * 60 * multiplier));
    return { subject, minutes, goalMinutes, progress: clamp((minutes / goalMinutes) * 100, 0, 100) };
  });

  $("#controlGoals").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
        <article class="control-row">
          <div class="control-row-top">
            <strong>${escapeHTML(row.subject.name)}</strong>
            <span class="tag">${formatMinutes(row.minutes)} / ${formatMinutes(row.goalMinutes)}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="--progress:${row.progress}%; --fill:${row.subject.color}"></div>
          </div>
          <div class="control-metrics">
            <span>${percent(row.progress)} da meta</span>
          </div>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Cadastre matérias para acompanhar metas.</div>`;
}

function renderGoals() {
  const today = parseISODate(todayISO());
  $("#goalList").innerHTML = state.goals.length
    ? [...state.goals]
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((goal) => {
          const target = parseISODate(goal.date);
          const days = Math.ceil((target - today) / 86400000);
          const label = days > 0 ? `${days} dias` : days === 0 ? "Hoje" : `${Math.abs(days)} dias atrás`;
          const status = days > 0 ? "faltam" : days === 0 ? "é hoje" : "passou";
          return `
            <article class="goal-card">
              <div class="goal-card-top">
                <div>
                  <span class="tag">${escapeHTML(goal.category || "Objetivo")}</span>
                  <strong>${escapeHTML(goal.title)}</strong>
                </div>
                <span class="tag">${formatDate(goal.date)}</span>
              </div>
              <div class="goal-days">${escapeHTML(label)}</div>
              <div class="control-metrics">
                <span>${escapeHTML(status)}</span>
              </div>
              <div class="inline-actions">
                <button class="mini-button bad" data-action="deleteGoal" data-id="${goal.id}" type="button">Excluir</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">Cadastre a data da prova ou outro objetivo para ver a contagem regressiva.</div>`;
}

function renderControlHistory(studyLogs, questionLogs) {
  const items = [
    ...studyLogs.map((log) => ({
      date: log.date,
      type: "Tempo",
      subjectId: log.subjectId || "",
      topicId: log.topicId,
      result: `${formatMinutes(log.minutes)} (${log.source || "Manual"})`,
    })),
    ...questionLogs.map((log) => ({
      date: log.date,
      type: "Questões",
      subjectId: log.subjectId || "",
      topicId: log.topicId,
      result: `${Number(log.correct || 0)} acertos, ${Number(log.wrong || 0)} erros`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));

  $("#controlHistory").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <tr>
          <td>${formatDate(item.date)}</td>
          <td>${escapeHTML(item.type)}</td>
          <td>${escapeHTML(getEntryScopeLabel(item))}</td>
          <td>${escapeHTML(item.result)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4">Nenhuma atividade registrada neste período.</td></tr>`;
}

function renderWeekChart() {
  const today = parseISODate(todayISO());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const iso = toISODate(date);
    const minutes = state.studyLogs.filter((log) => log.date === iso).reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    return { iso, minutes, label: formatShortDate(iso) };
  });
  const max = Math.max(1, ...days.map((day) => day.minutes));

  $("#weekChart").innerHTML = days
    .map((day) => {
      const height = clamp((day.minutes / max) * 100, day.minutes ? 12 : 2, 100);
      return `
        <div class="bar-item">
          <div class="bar" style="height:${height}%; --bar-color:#0f766e"></div>
          <strong>${formatMinutes(day.minutes)}</strong>
          <span>${escapeHTML(day.label)}</span>
        </div>
      `;
    })
    .join("");
}

function getRankedTopics() {
  return state.topics
    .map((topic) => {
      const stats = getTopicStats(topic.id);
      const subject = getSubject(topic.subjectId);
      return {
        ...topic,
        subjectName: subject?.name || "Sem matéria",
        color: subject?.color || "#0f766e",
        ...stats,
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.accuracy - a.accuracy;
      return b.total - a.total;
    });
}

function renderStrengthList() {
  const ranked = getRankedTopics().filter((topic) => topic.total > 0);
  const best = ranked[0];
  const weak = [...ranked].sort((a, b) => a.accuracy - b.accuracy)[0];
  const priority = [...ranked].sort((a, b) => {
    const priorityWeight = { Alta: 3, Média: 2, Baixa: 1 };
    return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0) || a.accuracy - b.accuracy;
  })[0];

  const insights = [
    best && { label: "Ponto forte", topic: best, caption: `${best.correct} acertos em ${best.total} questões` },
    weak && { label: "Ponto fraco", topic: weak, caption: `${weak.wrong} erros em ${weak.total} questões` },
    priority && { label: "Prioridade", topic: priority, caption: `Prioridade ${priority.priority.toLowerCase()} e ${percent(priority.accuracy)} de precisão` },
  ].filter(Boolean);

  $("#strengthList").innerHTML = insights.length
    ? insights
        .map(
          (item) => `
        <article class="insight-item">
          <div class="insight-top">
            <div>
              <span class="tag">${escapeHTML(item.label)}</span>
              <strong>${escapeHTML(item.topic.name)}</strong>
            </div>
            <strong>${percent(item.topic.accuracy)}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="--progress:${clamp(item.topic.accuracy, 0, 100)}%; --fill:${item.topic.color}"></div>
          </div>
          <small>${escapeHTML(item.caption)}</small>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Lance questões para visualizar pontos fortes e fracos.</div>`;
}

function renderPlan() {
  $("#subjectBoard").innerHTML = state.subjects.length
    ? state.subjects.map(renderSubjectCard).join("")
    : `<div class="empty-state">Adicione uma matéria para começar sua planilha.</div>`;
}

function renderSubjectCard(subject) {
  const topics = state.topics.filter((topic) => topic.subjectId === subject.id);
  const stats = getSubjectStats(subject.id);
  const weekMinutes = state.studyLogs
    .filter(getRangePredicate("week"))
    .filter((log) => getEntrySubjectId(log) === subject.id)
    .reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const goalMinutes = Number(subject.goalHours || 0) * 60;
  const goalProgress = goalMinutes ? clamp((weekMinutes / goalMinutes) * 100, 0, 100) : 0;

  return `
    <article class="subject-card" style="--subject-color:${subject.color}">
      <div class="subject-card-header">
        <div>
          <p class="eyebrow">Matéria</p>
          <h3>${escapeHTML(subject.name)}</h3>
        </div>
        <button class="mini-button bad" data-action="deleteSubject" data-id="${subject.id}" type="button">Excluir</button>
      </div>
      <div>
        <div class="insight-top">
          <span>Meta semanal</span>
          <strong>${formatMinutes(weekMinutes)} / ${formatMinutes(goalMinutes)}</strong>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="--progress:${goalProgress}%; --fill:${subject.color}"></div>
        </div>
      </div>
      <div class="topic-meta">
        <span class="tag">${topics.length} assuntos</span>
        <span class="tag">${percent(stats.accuracy)} questões</span>
        <span class="tag">${formatMinutes(stats.minutes)}</span>
      </div>
      <div class="topic-list">
        ${
          topics.length
            ? topics.map((topic) => renderTopicItem(topic, subject.color)).join("")
            : `<div class="empty-state">Nenhum assunto cadastrado.</div>`
        }
      </div>
    </article>
  `;
}

function renderTopicItem(topic, color) {
  const stats = getTopicStats(topic.id);
  return `
    <div class="topic-item">
      <div class="insight-top">
        <strong>${escapeHTML(topic.name)}</strong>
        <span class="tag">${escapeHTML(topic.priority)}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="--progress:${clamp(stats.accuracy, 0, 100)}%; --fill:${color}"></div>
      </div>
      <div class="topic-meta">
        <span>${stats.correct} acertos</span>
        <span>${stats.wrong} erros</span>
        <span>${percent(stats.accuracy)}</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button good" data-action="quickQuestion" data-result="correct" data-id="${topic.id}" type="button">+ acerto</button>
        <button class="mini-button bad" data-action="quickQuestion" data-result="wrong" data-id="${topic.id}" type="button">+ erro</button>
        <button class="mini-button" data-action="quickStudy" data-id="${topic.id}" type="button">+ 25 min</button>
        <button class="mini-button bad" data-action="deleteTopic" data-id="${topic.id}" type="button">Excluir</button>
      </div>
    </div>
  `;
}

function renderQuestions() {
  const recent = [...state.questionLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  $("#questionHistory").innerHTML = recent.length
    ? recent
        .map((log) => {
          const total = Number(log.correct || 0) + Number(log.wrong || 0);
          const accuracy = total ? (Number(log.correct || 0) / total) * 100 : 0;
          return `
            <tr>
              <td>${formatDate(log.date)}</td>
              <td>${escapeHTML(getEntryScopeLabel(log))}</td>
              <td>${Number(log.correct || 0)}</td>
              <td>${Number(log.wrong || 0)}</td>
              <td>${percent(accuracy)}</td>
              <td><button class="mini-button bad" data-action="deleteQuestion" data-id="${log.id}" type="button">Excluir</button></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6">Nenhum lançamento de questões.</td></tr>`;

  const ranked = getRankedTopics();
  $("#topicPerformance").innerHTML = ranked.length
    ? ranked
        .map(
          (topic) => `
        <article class="performance-row">
          <div class="performance-top">
            <div>
              <strong>${escapeHTML(topic.name)}</strong>
              <small>${escapeHTML(topic.subjectName)}</small>
            </div>
            <strong>${percent(topic.accuracy)}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="--progress:${clamp(topic.accuracy, 0, 100)}%; --fill:${topic.color}"></div>
          </div>
          <div class="topic-meta">
            <span>${topic.correct} acertos</span>
            <span>${topic.wrong} erros</span>
            <span>${topic.total} questões</span>
          </div>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Cadastre assuntos para acompanhar precisão.</div>`;
}

function renderFlashcards() {
  populateFlashcardReviewSelectors();
  updateFlashcardFormMode();
  const scopedCards = getScopedFlashcards();
  const dueCards = getDueFlashcards();
  $("#flashcardDueCount").textContent = `${dueCards.length} pendentes`;
  const summary = $("#flashcardReviewSummary");
  if (summary) {
    const orderLabel = state.ui.flashcardReviewOrder === "random" ? "sorteio aleatório" : "fila por vencimento";
    summary.textContent = `${dueCards.length} de ${scopedCards.length} cartões pendentes em ${getFlashcardScopeLabel()} - ${orderLabel}.`;
  }

  if (!state.flashcards.length) {
    $("#flashcardReview").innerHTML = `<div class="empty-state">Cadastre flashcards para iniciar suas revisões.</div>`;
    $("#flashcardLibrary").innerHTML = `<div class="empty-state">Sua biblioteca de flashcards aparecerá aqui.</div>`;
    return;
  }

  const activeCard = getActiveFlashcard(dueCards);
  renderFlashcardReview(activeCard, dueCards.length, scopedCards.length);
  renderFlashcardLibrary();
}

function flashcardRuleSort(a, b) {
  const priorityWeight = { Alta: 3, Média: 2, Baixa: 1 };
  const difficultyWeight = { hard: 3, medium: 2, easy: 1 };
  return (
    Number(a.nextDueReviewNumber || 0) - Number(b.nextDueReviewNumber || 0) ||
    (difficultyWeight[b.difficulty] || 0) - (difficultyWeight[a.difficulty] || 0) ||
    (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0) ||
    String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
  );
}

function shuffleFlashcards(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function flashcardMatchesReviewScope(card) {
  const scope = state.ui.flashcardReviewScope || "all";
  if (scope === "subject") {
    const subjectId = state.ui.flashcardReviewSubjectId;
    return Boolean(subjectId) && getEntrySubjectId(card) === subjectId;
  }
  if (scope === "topic") {
    const topicId = state.ui.flashcardReviewTopicId;
    return Boolean(topicId) && card.topicId === topicId;
  }
  return true;
}

function getScopedFlashcards() {
  return state.flashcards.filter(flashcardMatchesReviewScope);
}

function getDueFlashcards(cards = getScopedFlashcards()) {
  const counter = Number(state.flashcardSettings.reviewCounter || 0);
  return [...cards]
    .filter((card) => Number(card.nextDueReviewNumber || 0) <= counter)
    .sort(flashcardRuleSort);
}

function getFlashcardReviewQueue(cards = getDueFlashcards(), excludeId = "") {
  const queue = cards.filter((card) => card.id !== excludeId);
  return state.ui.flashcardReviewOrder === "random" ? shuffleFlashcards(queue) : queue.sort(flashcardRuleSort);
}

function getActiveFlashcard(dueCards) {
  const active = dueCards.find((card) => card.id === state.ui.activeFlashcardId);
  if (active) return active;

  const next = getFlashcardReviewQueue(dueCards)[0];
  const nextId = next?.id || "";
  if (state.ui.activeFlashcardId !== nextId || state.ui.flashcardAnswerOpen) {
    state.ui.activeFlashcardId = nextId;
    state.ui.flashcardAnswerOpen = false;
    saveState();
  }
  return next;
}

function getFlashcardScopeLabel() {
  const scope = state.ui.flashcardReviewScope || "all";
  if (scope === "subject") {
    const subject = getSubject(state.ui.flashcardReviewSubjectId);
    return subject ? `matéria ${subject.name}` : "matéria selecionada";
  }
  if (scope === "topic") {
    return `assunto ${getTopicLabel(state.ui.flashcardReviewTopicId)}`;
  }
  return "todos os flashcards";
}

function difficultyLabel(value) {
  return { hard: "Difícil", medium: "Média", easy: "Fácil" }[value] || "Média";
}

function updateFlashcardFormMode() {
  const editing = Boolean(state.ui.activeFlashcardEditId);
  const submit = $("#flashcardSubmitBtn");
  const cancel = $("#flashcardCancelEditBtn");
  if (submit) submit.textContent = editing ? "Salvar alterações" : "Salvar flashcard";
  if (cancel) cancel.classList.toggle("hidden", !editing);
}

function resetFlashcardForm() {
  $("#flashcardForm").reset();
  $("#flashcardFrontEditor").innerHTML = "";
  $("#flashcardBackEditor").innerHTML = "";
  state.ui.activeFlashcardEditId = "";
  updateFlashcardFormMode();
}

function fillFlashcardForm(card) {
  state.ui.activeFlashcardEditId = card.id;
  $("#flashcardSubject").value = getEntrySubjectId(card);
  syncScopedTopicSelect("#flashcardSubject", "#flashcardTopic");
  $("#flashcardTopic").value = card.topicId || "";
  $("#flashcardFrontEditor").innerHTML = renderRichText(card.front || "");
  $("#flashcardBackEditor").innerHTML = renderRichText(card.back || "");
  $("#flashcardPriority").value = card.priority || "Média";
  $("#flashcardDifficulty").value = card.difficulty || "medium";
  updateFlashcardFormMode();
}

function getDifficultyInterval(value) {
  return Number(state.flashcardSettings.intervals?.[value] || state.flashcardSettings.intervals?.medium || 8);
}

function renderFlashcardReview(card, dueCount, scopeCount = 0) {
  if (!card) {
    $("#flashcardReview").innerHTML = scopeCount
      ? `<div class="empty-state">Nenhum flashcard pendente em ${escapeHTML(getFlashcardScopeLabel())}. As regras de dificuldade foram preservadas.</div>`
      : `<div class="empty-state">Nenhum flashcard encontrado em ${escapeHTML(getFlashcardScopeLabel())}.</div>`;
    return;
  }

  const answer = state.ui.flashcardAnswerOpen
    ? `
      <div class="flashcard-face flashcard-answer">
        <strong>Resposta</strong>
        <div class="rich-card-content">${renderRichText(card.back)}</div>
      </div>
    `
    : "";

  $("#flashcardReview").innerHTML = `
    <div class="flashcard-review-top">
      <div>
        <span class="tag">${escapeHTML(card.priority || "Média")}</span>
        <span class="tag">${escapeHTML(difficultyLabel(card.difficulty))}</span>
        <strong>${escapeHTML(getEntryScopeLabel(card))}</strong>
      </div>
      <span class="tag">${dueCount > 1 ? `${dueCount} pendentes no filtro` : "Pendente no filtro"}</span>
    </div>
    <div class="flashcard-face">
      <strong>Frente</strong>
      <div class="rich-card-content">${renderRichText(card.front)}</div>
    </div>
    ${answer}
    <div class="flashcard-metrics">
      <span>${Number(card.reviews || 0)} revisões</span>
      <span>${Number(card.correct || 0)} acertos</span>
      <span>${Number(card.wrong || 0)} erros</span>
      <span>Repetição: ${getDifficultyInterval(card.difficulty)} cartões</span>
    </div>
    <div class="flashcard-actions">
      <button class="button secondary" data-action="showFlashcardAnswer" data-id="${card.id}" type="button">Mostrar resposta</button>
      <button class="button primary" data-action="reviewFlashcard" data-result="correct" data-id="${card.id}" type="button">Acertei</button>
      <button class="button ghost danger" data-action="reviewFlashcard" data-result="wrong" data-id="${card.id}" type="button">Errei</button>
      <button class="button ghost" data-action="nextFlashcard" type="button">Próximo</button>
      <button class="button ghost" data-action="editFlashcard" data-id="${card.id}" type="button">Editar</button>
      <button class="button ghost danger" data-action="deleteFlashcard" data-id="${card.id}" type="button">Excluir flashcard</button>
    </div>
    <div class="flashcard-actions">
      <button class="mini-button bad" data-action="setFlashcardDifficulty" data-difficulty="hard" data-id="${card.id}" type="button">Difícil</button>
      <button class="mini-button" data-action="setFlashcardDifficulty" data-difficulty="medium" data-id="${card.id}" type="button">Média</button>
      <button class="mini-button good" data-action="setFlashcardDifficulty" data-difficulty="easy" data-id="${card.id}" type="button">Fácil</button>
    </div>
  `;
}

function renderFlashcardLibrary() {
  const counter = Number(state.flashcardSettings.reviewCounter || 0);
  const sorted = [...state.flashcards].sort(flashcardRuleSort);
  $("#flashcardLibrary").innerHTML = sorted.length
    ? sorted
        .map((card) => {
          const isDue = Number(card.nextDueReviewNumber || 0) <= counter;
          return `
        <article class="flashcard-library-card">
          <div class="flashcard-card-top">
            <div>
              <span class="tag">${escapeHTML(card.priority || "Média")}</span>
              <span class="tag">${escapeHTML(difficultyLabel(card.difficulty))}</span>
              <strong>${escapeHTML(richTextToPlain(card.front))}</strong>
            </div>
            <span class="tag">${isDue ? "Pendente" : `Faltam ${Number(card.nextDueReviewNumber || 0) - counter}`}</span>
          </div>
          <div class="music-note rich-card-content">${renderRichText(card.back)}</div>
          <div class="flashcard-metrics">
            <span>${escapeHTML(getEntryScopeLabel(card))}</span>
            <span>${Number(card.reviews || 0)} revisões</span>
            <span>${Number(card.correct || 0)} acertos</span>
            <span>${Number(card.wrong || 0)} erros</span>
            <span>Repetição: ${getDifficultyInterval(card.difficulty)} cartões</span>
          </div>
          <div class="inline-actions">
            <button class="mini-button" data-action="studyFlashcard" data-id="${card.id}" type="button" ${isDue ? "" : "disabled"}>${isDue ? "Revisar" : "Aguardando"}</button>
            <button class="mini-button" data-action="editFlashcard" data-id="${card.id}" type="button">Editar</button>
            <button class="mini-button bad" data-action="deleteFlashcard" data-id="${card.id}" type="button">Excluir flashcard</button>
          </div>
        </article>
      `;
        })
        .join("")
    : `<div class="empty-state">Sua biblioteca de flashcards aparecerá aqui.</div>`;
}

function updateFlashcardReviewSettings({ silent = false } = {}) {
  const nextOrder = $("#flashcardReviewOrder")?.value === "due" ? "due" : "random";
  const nextScope = ["all", "subject", "topic"].includes($("#flashcardReviewScope")?.value) ? $("#flashcardReviewScope").value : "all";
  const nextSubjectId = $("#flashcardReviewSubject")?.value || state.ui.flashcardReviewSubjectId || "";
  const nextTopicId = $("#flashcardReviewTopic")?.value || state.ui.flashcardReviewTopicId || "";
  const changed =
    state.ui.flashcardReviewOrder !== nextOrder ||
    state.ui.flashcardReviewScope !== nextScope ||
    state.ui.flashcardReviewSubjectId !== nextSubjectId ||
    state.ui.flashcardReviewTopicId !== nextTopicId;

  state.ui.flashcardReviewOrder = nextOrder;
  state.ui.flashcardReviewScope = nextScope;
  state.ui.flashcardReviewSubjectId = nextSubjectId;
  state.ui.flashcardReviewTopicId = nextTopicId;

  if (changed) {
    state.ui.activeFlashcardId = "";
    state.ui.flashcardAnswerOpen = false;
  }

  saveState();
  renderFlashcards();
  if (!silent) showToast("Sessão de flashcards atualizada.");
}

function reviewFlashcard(cardId, isCorrect) {
  const card = state.flashcards.find((item) => item.id === cardId);
  if (!card) return;

  state.flashcardSettings.reviewCounter = Number(state.flashcardSettings.reviewCounter || 0) + 1;
  card.reviews = Number(card.reviews || 0) + 1;
  card.correct = Number(card.correct || 0) + (isCorrect ? 1 : 0);
  card.wrong = Number(card.wrong || 0) + (isCorrect ? 0 : 1);
  card.lastReviewed = todayISO();
  card.nextDueReviewNumber = Number(state.flashcardSettings.reviewCounter || 0) + getDifficultyInterval(card.difficulty);
  card.dueDate = todayISO();

  state.ui.flashcardAnswerOpen = false;
  state.ui.activeFlashcardId = getFlashcardReviewQueue(getDueFlashcards(), card.id)[0]?.id || "";
  saveState();
  renderFlashcards();
}

function resetAllStats() {
  state.questionLogs = [];
  state.studyLogs = [];
  state.flashcardSettings.reviewCounter = 0;
  state.flashcards = state.flashcards.map((card) => ({
    ...card,
    dueDate: todayISO(),
    nextDueReviewNumber: 0,
    reviews: 0,
    correct: 0,
    wrong: 0,
    lastReviewed: "",
  }));
  state.ui.flashcardAnswerOpen = false;
  state.ui.activeFlashcardId = "";
  pauseTimer();
  resetTimer();
}

function getSource(sourceId) {
  return state.sources.find((source) => source.id === sourceId);
}

function normalizeCategoryName(value) {
  return String(value || "").trim();
}

function getAllCategories() {
  const categories = [
    ...(Array.isArray(state.categories) ? state.categories : []),
    ...state.sources.map((source) => source.category),
    ...state.notes.map((note) => note.category),
  ]
    .map(normalizeCategoryName)
    .filter(Boolean);
  return [...new Set(categories)].sort((a, b) => a.localeCompare(b));
}

function ensureCategory(category) {
  const name = normalizeCategoryName(category);
  if (!name) return "";
  state.categories = Array.isArray(state.categories) ? state.categories : [];
  if (!state.categories.some((item) => item.toLowerCase() === name.toLowerCase())) {
    state.categories.push(name);
    state.categories.sort((a, b) => a.localeCompare(b));
  }
  return name;
}

function resolveCategory(selectSelector, inputSelector) {
  const typed = normalizeCategoryName($(inputSelector)?.value);
  const selected = normalizeCategoryName($(selectSelector)?.value);
  return ensureCategory(typed || selected);
}

function setCategoryFields(prefix, category) {
  const select = $(`#${prefix}CategorySelect`);
  const input = $(`#${prefix}CategoryNew`);
  if (!select || !input) return;
  const value = normalizeCategoryName(category);
  const hasOption = [...select.options].some((option) => option.value === value);
  select.value = hasOption ? value : "";
  input.value = hasOption ? "" : value;
}

function richTextHasContent(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  return wrapper.textContent.trim().length > 0;
}

function hasHighlightMarkup(html) {
  return /background(?:-color)?\s*:/i.test(String(html || ""));
}

function plainTextFromHTML(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  return wrapper.textContent.replace(/\s+/g, " ").trim();
}

function simpleHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function sourceContentHash(html) {
  return simpleHash(plainTextFromHTML(html));
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sourceSyncSummary(source) {
  if (syncingSources.has(source.id)) return "Sincronizando agora";
  if (source.pendingContent) return `Atualização detectada${source.pendingSyncedAt ? ` em ${formatDateTime(source.pendingSyncedAt)}` : ""}`;
  if (source.lastSyncError) return `Falha na sincronização: ${source.lastSyncError}`;
  if (source.lastSyncedAt) return `Sincronizado em ${formatDateTime(source.lastSyncedAt)}`;
  return source.autoSync ? "Sincronização automática ativada" : "Sincronização manual";
}

function clipSourceText(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  return clean.length > SOURCE_TEXT_LIMIT ? `${clean.slice(0, SOURCE_TEXT_LIMIT)}\n\n[Texto reduzido pelo limite de armazenamento do navegador.]` : clean;
}

function textToRichHTML(text) {
  return clipSourceText(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHTML(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function parseSourceDocument(rawText, contentType = "", fallbackTitle = "") {
  const text = String(rawText || "");
  const looksLikeHTML = /html/i.test(contentType) || /<\/?[a-z][\s\S]*>/i.test(text);
  if (!looksLikeHTML) {
    return { title: fallbackTitle, html: textToRichHTML(text) };
  }

  const documentHTML = new DOMParser().parseFromString(text, "text/html");
  documentHTML.querySelectorAll("script, style, noscript, svg, form, nav, header, footer").forEach((element) => element.remove());
  const title = documentHTML.querySelector("title")?.textContent.trim() || fallbackTitle;
  const container = documentHTML.querySelector("main, article, [role='main']") || documentHTML.body;
  return { title, html: textToRichHTML(container?.textContent || "") };
}

async function fetchSourceDocument(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const rawText = await response.text();
  return parseSourceDocument(rawText, response.headers.get("content-type") || "", url);
}

function sourceCanApplySync(source) {
  if (!richTextHasContent(source.content)) return true;
  if (hasHighlightMarkup(source.content)) return false;
  const currentHash = sourceContentHash(source.content);
  return !source.lastSyncHash || currentHash === source.lastSyncHash || currentHash === source.appliedSyncHash;
}

function applySyncedContent(source, html, hash) {
  source.content = sanitizeNoteHTML(html);
  source.appliedSyncHash = hash;
  source.pendingContent = "";
  source.pendingSyncHash = "";
  source.pendingSyncedAt = "";
}

async function syncSourceFromUrl(sourceId, options = {}) {
  const source = getSource(sourceId);
  if (!source || syncingSources.has(sourceId)) return;
  const safeUrl = getSafeExternalUrl(source.url);
  if (!safeUrl) {
    source.lastSyncError = "link inválido";
    source.lastSyncStatus = "Falha";
    saveState();
    renderNotes();
    return;
  }

  syncingSources.add(sourceId);
  source.lastSyncAttemptAt = new Date().toISOString();
  source.lastSyncStatus = "Sincronizando";
  source.lastSyncError = "";
  saveState();
  if (!options.silent) showToast("Tentando sincronizar a fonte pelo link.");

  try {
    const imported = await fetchSourceDocument(safeUrl);
    const html = sanitizeNoteHTML(imported.html || "");
    if (!richTextHasContent(html)) throw new Error("conteúdo vazio");
    const hash = sourceContentHash(html);
    const previousHash = source.lastSyncHash || "";
    const canApplyNow = sourceCanApplySync(source);
    source.lastImportedContent = html;
    source.lastSyncHash = hash;
    source.lastSyncedAt = new Date().toISOString();
    source.lastSyncError = "";
    source.updatedAt = new Date().toISOString();

    if (canApplyNow) {
      applySyncedContent(source, html, hash);
      source.lastSyncStatus = previousHash && previousHash !== hash ? "Atualizado automaticamente" : "Sincronizado";
    } else if (previousHash && previousHash !== hash) {
      source.pendingContent = html;
      source.pendingSyncHash = hash;
      source.pendingSyncedAt = new Date().toISOString();
      source.lastSyncStatus = "Atualização disponível";
    } else {
      source.lastSyncStatus = "Sincronizado";
    }

    if (imported.title && (!source.title || source.title === "Fonte sem nome")) {
      source.title = imported.title;
    }

    saveState();
    renderNotes();
    if (!options.silent) {
      showToast(source.pendingContent ? "Mudança detectada. Aplique quando quiser preservar ou refazer os grifos." : "Fonte sincronizada.");
    }
  } catch (error) {
    source.lastSyncStatus = "Falha";
    source.lastSyncError = "site bloqueou a leitura ou não retornou texto";
    saveState();
    renderNotes();
    if (!options.silent) showToast("Não foi possível sincronizar pelo link. Cole o texto manualmente no leitor.");
  } finally {
    syncingSources.delete(sourceId);
    renderNotes();
  }
}

function queueAutoSyncSources() {
  state.sources.forEach((source) => {
    if (!source.autoSync || syncingSources.has(source.id)) return;
    const lastAttempt = Date.parse(source.lastSyncAttemptAt || source.lastSyncedAt || "") || 0;
    if (Date.now() - lastAttempt < SOURCE_SYNC_INTERVAL_MS) return;
    window.setTimeout(() => syncSourceFromUrl(source.id, { silent: true }), 0);
  });
}

async function importCurrentSourceUrlToForm() {
  const safeUrl = getSafeExternalUrl($("#sourceUrl").value.trim());
  if (!safeUrl) {
    showToast("Informe um link válido para importar.");
    return;
  }

  $("#importSourceUrlBtn").disabled = true;
  showToast("Importando texto do link.");
  try {
    const imported = await fetchSourceDocument(safeUrl);
    const html = sanitizeNoteHTML(imported.html || "");
    if (!richTextHasContent(html)) throw new Error("conteúdo vazio");
    $("#sourceContentEditor").innerHTML = html;
    if (imported.title && !$("#sourceTitle").value.trim()) $("#sourceTitle").value = imported.title;
    showToast("Texto importado para o leitor da fonte.");
  } catch {
    showToast("Este site bloqueou a importação. Cole o texto manualmente no leitor.");
  } finally {
    $("#importSourceUrlBtn").disabled = false;
  }
}

function renderNotes() {
  renderCategorySelectors();
  renderCategoryList();
  renderSourceFormState();
  renderSourceSelectors();
  renderSourceLibrary();
  renderSourcePreview();
  renderNoteLibrary();
  queueAutoSyncSources();
}

function renderCategorySelectors() {
  const options = getAllCategories()
    .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
    .join("");
  const emptyOption = `<option value="">Escolher categoria</option>`;
  $("#sourceCategorySelect").innerHTML = emptyOption + options;
  $("#noteCategorySelect").innerHTML = emptyOption + options;
}

function renderCategoryList() {
  const categories = getAllCategories();
  $("#categoryList").innerHTML = categories.length
    ? categories
        .map(
          (category) => `
        <article class="category-card">
          <span class="tag">${escapeHTML(category)}</span>
          <button class="mini-button bad" data-action="deleteCategory" data-category="${escapeHTML(category)}" type="button">Excluir</button>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Crie categorias para organizar fontes, leis e anotações.</div>`;
}

function renderSourceFormState() {
  const editing = Boolean(state.ui.activeSourceEditId);
  $("#sourceSubmitBtn").textContent = editing ? "Salvar alterações da fonte" : "Salvar fonte";
  $("#cancelSourceEditBtn").classList.toggle("hidden", !editing);
}

function resetSourceForm() {
  $("#sourceForm").reset();
  $("#sourceContentEditor").innerHTML = "";
  $("#sourceAutoSync").checked = false;
  setCategoryFields("source", "");
}

function fillSourceForm(source) {
  if (!source) return;
  $("#sourceTitle").value = source.title || "";
  $("#sourceUrl").value = source.url || "";
  $("#sourceAutoSync").checked = Boolean(source.autoSync);
  $("#sourceContentEditor").innerHTML = sanitizeNoteHTML(source.content || "");
  setCategoryFields("source", source.category || "");
  renderSourceFormState();
}

function renderSourceSelectors() {
  const options = state.sources
    .map((source) => `<option value="${source.id}">${escapeHTML(source.category || "Sem categoria")} - ${escapeHTML(source.title)}</option>`)
    .join("");
  const emptyOption = `<option value="">Sem fonte vinculada</option>`;
  $("#activeSourceSelect").innerHTML = emptyOption + options;
  $("#noteSource").innerHTML = emptyOption + options;
  if (state.sources.some((source) => source.id === state.ui.activeSourceId)) {
    $("#activeSourceSelect").value = state.ui.activeSourceId;
  }
}

function renderSourceLibrary() {
  $("#sourceLibrary").innerHTML = state.sources.length
    ? [...state.sources]
        .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.title).localeCompare(String(b.title)))
        .map(
          (source) => `
        <article class="source-card">
          <div class="source-card-top">
            <div>
              <span class="tag">${escapeHTML(source.category || "Sem categoria")}</span>
              <strong>${escapeHTML(source.title)}</strong>
            </div>
            <span class="tag">${richTextHasContent(source.content) ? "Com grifos" : "Sem texto"}</span>
          </div>
          <p class="music-note">${escapeHTML(source.url)}</p>
          <div class="flashcard-metrics">
            <span>${source.autoSync ? "Sync automática" : "Sync manual"}</span>
            <span>${escapeHTML(sourceSyncSummary(source))}</span>
          </div>
          <div class="inline-actions">
            <button class="mini-button" data-action="selectSource" data-id="${source.id}" type="button">Usar</button>
            <button class="mini-button" data-action="syncSource" data-id="${source.id}" type="button">Sincronizar</button>
            ${richTextHasContent(source.content) || source.pendingContent ? `<button class="mini-button bad" data-action="clearSourceContent" data-id="${source.id}" type="button">Limpar texto</button>` : ""}
            <button class="mini-button" data-action="editSource" data-id="${source.id}" type="button">Editar</button>
            <button class="mini-button bad" data-action="deleteSource" data-id="${source.id}" type="button">Excluir fonte</button>
          </div>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Cadastre sites como Planalto, tribunais ou páginas de lei para usar como fonte.</div>`;
}

function renderSourcePreview() {
  const source = getSource(state.ui.activeSourceId);
  if (!source) {
    $("#sourcePreview").innerHTML = `<div class="empty-state">Selecione uma fonte para visualizar ou abrir o site base.</div>`;
    return;
  }

  const safeUrl = getSafeExternalUrl(source.url);
  if (!safeUrl) {
    $("#sourcePreview").innerHTML = `<div class="empty-state">O link desta fonte não é válido.</div>`;
    return;
  }

  $("#sourcePreview").innerHTML = `
    <div class="source-preview-actions">
      <a class="button secondary" href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">Abrir site base</a>
      <button class="button secondary" data-action="syncSource" data-id="${source.id}" type="button">Sincronizar agora</button>
      <button class="button ghost" data-action="useSourceInNote" data-id="${source.id}" type="button">Usar na anotação</button>
      <button class="button ghost" data-action="editSource" data-id="${source.id}" type="button">Editar fonte</button>
      <button class="button ghost danger" data-action="deleteSource" data-id="${source.id}" type="button">Excluir fonte</button>
    </div>
    <iframe src="${escapeHTML(safeUrl)}" title="${escapeHTML(source.title)}" loading="lazy"></iframe>
    <p class="music-note">${escapeHTML(sourceSyncSummary(source))}. Alguns sites oficiais bloqueiam visualização ou sincronização dentro do app; se isso acontecer, cole o trecho no leitor interno abaixo.</p>
    <section class="source-reader">
      <div class="source-card-top">
        <div>
          <span class="tag">${escapeHTML(source.category || "Sem categoria")}</span>
          <strong>Texto e grifos salvos nesta fonte</strong>
        </div>
        <span class="tag">${source.pendingContent ? "Atualização disponível" : "Vinculado ao link"}</span>
      </div>
      ${
        source.pendingContent
          ? `<div class="sync-alert">
              <strong>O site parece ter mudado.</strong>
              <span>A versão nova foi importada, mas seus grifos atuais foram preservados. Aplique a atualização quando quiser substituir o texto do leitor.</span>
              <button class="mini-button" data-action="applySourceSync" data-id="${source.id}" type="button">Aplicar texto atualizado</button>
            </div>`
          : ""
      }
      <div class="highlight-toolbar" aria-label="Marca-texto do leitor da fonte">
        <button class="mini-button marker-yellow" data-reader-highlight="yellow" type="button">Amarelo</button>
        <button class="mini-button marker-green" data-reader-highlight="green" type="button">Verde</button>
        <button class="mini-button marker-blue" data-reader-highlight="blue" type="button">Azul</button>
        <label class="color-control">
          Cor
          <input id="readerHighlightColor" type="color" value="#fff59d" />
        </label>
        <button class="mini-button" data-reader-highlight="custom" type="button">Cor escolhida</button>
        <button class="mini-button marker-clear" data-reader-highlight="clear" type="button">Limpar</button>
      </div>
      <div id="activeSourceReader" class="note-editor law-editor" contenteditable="true" role="textbox" aria-multiline="true">${sanitizeNoteHTML(source.content || "")}</div>
      <p class="music-note">Edite ou cole aqui o texto da lei. Depois selecione trechos, aplique o marca-texto e salve os grifos da fonte.</p>
      <div class="inline-actions">
        <button class="button primary" data-action="saveSourceReader" data-id="${source.id}" type="button">Salvar grifos da fonte</button>
        <button class="button ghost danger" data-action="clearSourceContent" data-id="${source.id}" type="button">Limpar texto da fonte</button>
      </div>
    </section>
  `;
}

function renderNoteLibrary() {
  $("#noteLibrary").innerHTML = state.notes.length
    ? [...state.notes]
        .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
        .map((note) => {
          const source = getSource(note.sourceId);
          return `
            <article class="note-card">
              <div class="note-card-top">
                <div>
                  <span class="tag">${escapeHTML(note.category)}</span>
                  <strong>${escapeHTML(note.title)}</strong>
                </div>
                <span class="tag">${formatDate((note.updatedAt || note.createdAt || todayISO()).slice(0, 10))}</span>
              </div>
              <div class="note-content">${sanitizeNoteHTML(note.content || "")}</div>
              <div class="flashcard-metrics">
                ${source ? `<span>Fonte: ${escapeHTML(source.title)}</span>` : `<span>Sem fonte vinculada</span>`}
              </div>
              <div class="inline-actions">
                <button class="mini-button" data-action="editNote" data-id="${note.id}" type="button">Editar</button>
                ${source ? `<button class="mini-button" data-action="selectSource" data-id="${source.id}" type="button">Abrir fonte</button>` : ""}
                <button class="mini-button bad" data-action="deleteNote" data-id="${note.id}" type="button">Excluir</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">Suas anotações com marca-texto aparecerão aqui.</div>`;
}

function applyHighlight(kind) {
  applyHighlightToEditor("#noteEditor", kind, "#noteHighlightColor");
}

function getRichEditorFromControl(control) {
  const selector = control.closest("[data-editor]")?.dataset.editor;
  const editor = selector ? $(selector) : null;
  if (editor) editor.focus();
  return editor;
}

function applyRichEditorCommand(control) {
  const editor = getRichEditorFromControl(control);
  if (!editor) return;
  const command = control.dataset.richCommand;
  if (command === "spacer") {
    document.execCommand("insertHTML", false, '<p style="margin-top: 0.85em; margin-bottom: 0.85em;"><br></p>');
    return;
  }
  if (command === "insertParagraph") {
    document.execCommand("formatBlock", false, "p");
    return;
  }
  document.execCommand(command, false, null);
}

function applyRichEditorHighlight(control) {
  const editor = getRichEditorFromControl(control);
  if (!editor) return;
  const colors = { yellow: "#fff59d", green: "#bbf7d0", blue: "#bfdbfe" };
  document.execCommand("backColor", false, colors[control.dataset.richHighlight] || colors.yellow);
}

function applyRichEditorColor(control) {
  const editor = getRichEditorFromControl(control);
  if (!editor) return;
  const color = $(control.dataset.richColor)?.value || "#0f172a";
  document.execCommand("foreColor", false, color);
}

function applyHighlightToEditor(editorSelector, kind, colorSelector) {
  const colors = { yellow: "#fff59d", green: "#bbf7d0", blue: "#bfdbfe" };
  const editor = $(editorSelector);
  if (!editor) return;
  editor.focus();
  if (kind === "clear") {
    document.execCommand("removeFormat", false, null);
    return;
  }
  const customColor = $(colorSelector)?.value;
  document.execCommand("backColor", false, kind === "custom" && customColor ? customColor : colors[kind] || colors.yellow);
}

function sanitizeNoteHTML(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  wrapper.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((element) => element.remove());
  wrapper.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (name === "href" || name === "src") element.removeAttribute(attribute.name);
      if (name === "style") {
        const safeStyle = attribute.value
          .split(";")
          .map((part) => part.trim())
          .filter((part) => /^(background|background-color|color|font-weight|font-style|text-decoration|text-align|line-height|margin-top|margin-bottom)\s*:/i.test(part))
          .join("; ");
        if (safeStyle) {
          element.setAttribute("style", safeStyle);
        } else {
          element.removeAttribute(attribute.name);
        }
      }
    });
  });
  return wrapper.innerHTML;
}

function renderCases() {
  const court = state.ui.caseCourt;
  $$(".segment[data-case-tab]").forEach((button) => button.classList.toggle("active", button.dataset.caseTab === court));
  $("#caseCourtLabel").textContent = court;
  $("#caseListTitle").textContent = court;
  populateCaseFilterSelectors();

  const allItems = [...state.cases[court]];
  const items = allItems.filter(caseMatchesFilters).sort((a, b) => b.date.localeCompare(a.date));
  const summary = $("#caseFilterSummary");
  if (summary) {
    summary.textContent = caseFilterSummary(items.length, allItems.length, court);
  }
  updateCaseFormMode();
  $("#caseList").innerHTML = items.length
    ? items.map((item) => renderCaseCard(item, court)).join("")
    : `<div class="empty-state">${allItems.length ? "Nenhuma jurisprudência encontrada com esses filtros." : "Nenhuma jurisprudência cadastrada nesta aba."}</div>`;
  renderLegalMaterials();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function caseMatchesFilters(item) {
  const topic = getTopic(item.topicId);
  const subjectId = getEntrySubjectId(item);
  const subject = getSubject(subjectId);
  const subjectFilter = state.ui.caseSubjectFilter || "";
  const topicFilter = state.ui.caseTopicFilter || "";
  const search = normalizeSearchText(state.ui.caseSearch);

  if (subjectFilter && subjectId !== subjectFilter) return false;
  if (topicFilter && item.topicId !== topicFilter) return false;
  if (!search) return true;

  const haystack = normalizeSearchText(
    [
      item.title,
      item.theme,
      richTextToPlain(item.summary),
      item.source,
      topic?.name,
      subject?.name,
      getEntryScopeLabel(item),
      normalizeHashtags(item.tags).map((tag) => `#${tag}`).join(" "),
    ].join(" ")
  );
  return haystack.includes(search);
}

function caseFilterSummary(resultCount, totalCount, court) {
  const filters = [
    state.ui.caseSearch ? "texto" : "",
    state.ui.caseSubjectFilter ? "matéria" : "",
    state.ui.caseTopicFilter ? "assunto" : "",
  ].filter(Boolean);
  const suffix = filters.length ? ` com filtro por ${filters.join(", ")}` : "";
  return `${resultCount} de ${totalCount} julgados em ${court}${suffix}.`;
}

function renderCaseTags(tags = []) {
  const normalized = normalizeHashtags(tags);
  return normalized.length
    ? `<div class="case-tags">${normalized.map((tag) => `<span class="hashtag">#${escapeHTML(tag)}</span>`).join("")}</div>`
    : "";
}

function updateCaseFormMode() {
  const editing = Boolean(state.ui.activeCaseEditId);
  const submit = $("#caseSubmitBtn");
  const cancel = $("#caseCancelEditBtn");
  if (submit) submit.textContent = editing ? "Salvar alterações" : "Salvar jurisprudência";
  if (cancel) cancel.classList.toggle("hidden", !editing);
}

function resetCaseForm() {
  $("#caseForm").reset();
  $("#caseSummaryEditor").innerHTML = "";
  $("#caseTags").value = "";
  $("#caseDate").value = todayISO();
  state.ui.activeCaseEditId = "";
  updateCaseFormMode();
}

function fillCaseForm(item, court) {
  state.ui.caseCourt = court;
  state.ui.activeCaseEditId = item.id;
  $("#caseTitle").value = item.title || "";
  $("#caseSubject").value = getEntrySubjectId(item);
  syncScopedTopicSelect("#caseSubject", "#caseTopic");
  $("#caseTopic").value = item.topicId || "";
  $("#caseDate").value = item.date || todayISO();
  $("#caseTheme").value = item.theme || "";
  $("#caseSummaryEditor").innerHTML = renderRichText(item.summary || "");
  $("#caseTags").value = hashtagsToInput(item.tags || []);
  $("#caseSource").value = item.source || "";
  updateCaseFormMode();
}

function renderCaseCard(item, court) {
  const link = item.source
    ? `<a href="${escapeHTML(item.source)}" target="_blank" rel="noopener noreferrer">Fonte</a>`
    : "";
  return `
    <article class="case-card">
      <div class="case-meta">
        <span class="tag">${escapeHTML(court)}</span>
        <span class="tag">${formatDate(item.date)}</span>
        ${item.theme ? `<span class="tag">${escapeHTML(item.theme)}</span>` : ""}
      </div>
      <h3>${escapeHTML(item.title)}</h3>
      <div class="case-content rich-card-content">${renderRichText(item.summary)}</div>
      <div class="case-meta">
        ${getEntrySubjectId(item) || item.topicId ? `<span>${escapeHTML(getEntryScopeLabel(item))}</span>` : ""}
        ${link}
      </div>
      ${renderCaseTags(item.tags)}
      <div class="inline-actions">
        <button class="mini-button" data-action="editCase" data-court="${court}" data-id="${item.id}" type="button">Editar</button>
        <button class="mini-button bad" data-action="deleteCase" data-court="${court}" data-id="${item.id}" type="button">Excluir</button>
      </div>
    </article>
  `;
}

function legalMaterialTypeLabel(type) {
  if (type === "table") return "Tabela";
  if (type === "image") return "Imagem/foto";
  return "Lei";
}

function slugifyFileName(value, fallback = "material") {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function parseLegalMaterialTable(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitLegalMaterialRow)
    .filter((row) => row.length > 1);
}

function legalMaterialTableToPlainText(content) {
  return parseLegalMaterialTable(content)
    .map((row) => row.join("\t"))
    .join("\n");
}

function legalMaterialTableToHTML(item) {
  const rows = parseLegalMaterialTable(item.content);
  if (!rows.length) return `<p>${escapeHTML(item.content || "")}</p>`;
  const [header, ...body] = rows;
  const bodyRows = body.length ? body : [header.map(() => "")];
  return `
    <table>
      <thead>
        <tr>${header.map((cell) => `<th>${escapeHTML(cell)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${bodyRows
          .map((row) => `<tr>${header.map((_, index) => `<td>${escapeHTML(row[index] || "")}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function escapeCSVCell(value) {
  const text = String(value ?? "");
  return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function legalMaterialTableToCSV(content) {
  return parseLegalMaterialTable(content)
    .map((row) => row.map(escapeCSVCell).join(";"))
    .join("\n");
}

function htmlTableToPlainText(html) {
  const documentHTML = new DOMParser().parseFromString(String(html || ""), "text/html");
  const table = documentHTML.querySelector("table");
  if (!table) return "";
  return Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((cell) => cell.textContent.replace(/\s+/g, " ").trim())
        .join("\t")
    )
    .filter(Boolean)
    .join("\n");
}

function getLegalMaterial(id) {
  return state.legalMaterials.find((item) => item.id === id);
}

function getLegalImageSource(item) {
  const content = String(item?.content || "").trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(content)) return content;
  return getSafeExternalUrl(content);
}

function getLegalImageExtension(src) {
  const type = /^data:image\/([^;]+)/i.exec(String(src || ""))?.[1] || "png";
  if (type === "jpeg") return "jpg";
  return type.replace(/[^a-z0-9]/gi, "") || "png";
}

function dataURLToBlob(dataUrl) {
  const [header, payload = ""] = String(dataUrl || "").split(",");
  const mime = /data:([^;]+)/i.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function readImageFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Arquivo de imagem inválido."));
      return;
    }
    if (file.size > LEGAL_IMAGE_MAX_BYTES) {
      reject(new Error("Imagem muito grande. Use uma imagem de até 2,5 MB."));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Não foi possível ler a imagem.")));
    reader.readAsDataURL(file);
  });
}

async function setLegalMaterialImageFromFile(file) {
  try {
    const dataUrl = await readImageFileAsDataURL(file);
    $("#legalMaterialType").value = "image";
    if (!$("#legalMaterialTitle").value.trim()) {
      $("#legalMaterialTitle").value = file.name?.replace(/\.[^.]+$/, "") || "Imagem";
    }
    $("#legalMaterialContent").value = dataUrl;
    showToast("Imagem carregada. Salve o material para guardar.");
  } catch (error) {
    showToast(error.message || "Não foi possível carregar a imagem.");
  }
}

function insertTextIntoTextarea(textarea, text) {
  const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
  const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  const nextPosition = start + text.length;
  textarea.selectionStart = nextPosition;
  textarea.selectionEnd = nextPosition;
}

async function handleLegalMaterialContentPaste(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const imageItem = Array.from(clipboard.items || []).find((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    await setLegalMaterialImageFromFile(file);
    return;
  }

  const html = clipboard.getData("text/html");
  const tableText = htmlTableToPlainText(html);
  if (tableText) {
    event.preventDefault();
    $("#legalMaterialType").value = "table";
    insertTextIntoTextarea(event.target, tableText);
    showToast("Tabela colada e preparada para salvar.");
    return;
  }

  const plainText = clipboard.getData("text/plain");
  const looksLikeTable = plainText.split(/\r?\n/).some((line) => line.split("\t").length > 1);
  if (looksLikeTable) {
    $("#legalMaterialType").value = "table";
  }
}

async function writeClipboardWithHTML(html, text) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

function downloadBlobFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyLegalMaterial(id, mode = "rich") {
  const item = getLegalMaterial(id);
  if (!item) return;
  try {
    if (item.type === "table") {
      const text = legalMaterialTableToPlainText(item.content) || item.content;
      const html = legalMaterialTableToHTML(item);
      if (mode === "text") {
        await navigator.clipboard.writeText(text);
        showToast("Tabela copiada como texto.");
      } else {
        await writeClipboardWithHTML(html, text);
        showToast("Tabela copiada para colar no Word ou editor.");
      }
      return;
    }

    if (item.type === "image") {
      const src = getLegalImageSource(item);
      if (!src) {
        showToast("Imagem sem arquivo válido.");
        return;
      }
      const html = `<img src="${escapeHTML(src)}" alt="${escapeHTML(item.title)}">`;
      await writeClipboardWithHTML(html, item.title || "Imagem");
      showToast("Imagem copiada para colar no Word ou editor.");
      return;
    }

    await navigator.clipboard.writeText(item.content || "");
    showToast("Texto copiado.");
  } catch {
    showToast("Não foi possível copiar. Selecione o conteúdo manualmente.");
  }
}

function downloadLegalMaterial(id) {
  const item = getLegalMaterial(id);
  if (!item) return;
  const baseName = slugifyFileName(item.title, "material");

  if (item.type === "table") {
    const csv = legalMaterialTableToCSV(item.content) || item.content || "";
    downloadBlobFile(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`);
    showToast("Tabela exportada em CSV.");
    return;
  }

  if (item.type === "image") {
    const src = getLegalImageSource(item);
    if (!src) {
      showToast("Imagem sem arquivo válido.");
      return;
    }
    if (src.startsWith("data:image/")) {
      const blob = dataURLToBlob(src);
      downloadBlobFile(blob, `${baseName}.${getLegalImageExtension(src)}`);
      showToast("Imagem baixada.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = `${baseName}.${getLegalImageExtension(src)}`;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    showToast("Imagem aberta para download.");
    return;
  }

  downloadBlobFile(new Blob([item.content || ""], { type: "text/plain;charset=utf-8" }), `${baseName}.txt`);
  showToast("Texto exportado.");
}

function legalMaterialMatchesFilters(item) {
  const topic = getTopic(item.topicId);
  const subjectId = getEntrySubjectId(item);
  const subject = getSubject(subjectId);
  const subjectFilter = state.ui.caseSubjectFilter || "";
  const topicFilter = state.ui.caseTopicFilter || "";
  const search = normalizeSearchText(state.ui.caseSearch);

  if (subjectFilter && subjectId !== subjectFilter) return false;
  if (topicFilter && item.topicId !== topicFilter) return false;
  if (!search) return true;

  const haystack = normalizeSearchText(
    [
      legalMaterialTypeLabel(item.type),
      item.title,
      item.reference,
      item.type === "image" ? "" : item.content,
      item.source,
      topic?.name,
      subject?.name,
      getEntryScopeLabel(item),
    ].join(" ")
  );
  return haystack.includes(search);
}

function renderLegalMaterials() {
  const list = $("#legalMaterialList");
  if (!list) return;

  const allItems = Array.isArray(state.legalMaterials) ? [...state.legalMaterials] : [];
  const items = allItems
    .filter(legalMaterialMatchesFilters)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const summary = $("#legalMaterialSummary");
  if (summary) {
    const filters = [
      state.ui.caseSearch ? "texto" : "",
      state.ui.caseSubjectFilter ? "matéria" : "",
      state.ui.caseTopicFilter ? "assunto" : "",
    ].filter(Boolean);
    const suffix = filters.length ? ` com filtro por ${filters.join(", ")}` : "";
    summary.textContent = `${items.length} de ${allItems.length} materiais${suffix}.`;
  }

  list.innerHTML = items.length
    ? items.map(renderLegalMaterialCard).join("")
    : `<div class="empty-state">${allItems.length ? "Nenhuma lei ou tabela encontrada com esses filtros." : "Nenhuma lei ou tabela cadastrada."}</div>`;
}

function renderLegalMaterialCard(item) {
  const safeSource = getSafeExternalUrl(item.source);
  const topicLabel = getEntrySubjectId(item) || item.topicId ? getEntryScopeLabel(item) : "";
  const copyLabel = item.type === "table" ? "Copiar tabela" : item.type === "image" ? "Copiar foto" : "Copiar texto";
  const downloadLabel = item.type === "table" ? "Baixar CSV" : item.type === "image" ? "Baixar foto" : "Baixar TXT";
  return `
    <article class="legal-material-card">
      <div class="legal-material-card-top">
        <div>
          <div class="case-meta">
            <span class="tag">${legalMaterialTypeLabel(item.type)}</span>
            ${item.reference ? `<span class="tag">${escapeHTML(item.reference)}</span>` : ""}
          </div>
          <h3>${escapeHTML(item.title)}</h3>
        </div>
        <div class="inline-actions">
          <button class="mini-button" data-action="copyLegalMaterial" data-id="${item.id}" type="button">${copyLabel}</button>
          ${item.type === "table" ? `<button class="mini-button" data-action="copyLegalMaterialText" data-id="${item.id}" type="button">Copiar texto</button>` : ""}
          <button class="mini-button" data-action="downloadLegalMaterial" data-id="${item.id}" type="button">${downloadLabel}</button>
          <button class="mini-button bad" data-action="deleteLegalMaterial" data-id="${item.id}" type="button">Excluir</button>
        </div>
      </div>
      ${renderLegalMaterialBody(item)}
      <div class="case-meta">
        ${topicLabel ? `<span>${escapeHTML(topicLabel)}</span>` : ""}
        ${safeSource ? `<a href="${escapeHTML(safeSource)}" target="_blank" rel="noopener noreferrer">Fonte</a>` : ""}
      </div>
    </article>
  `;
}

function renderLegalMaterialBody(item) {
  const content = String(item.content || "").trim();
  if (!content) return `<p class="legal-material-content">Sem conteúdo registrado.</p>`;
  if (item.type === "table") return renderLegalMaterialTable(content);
  if (item.type === "image") return renderLegalMaterialImage(item);
  return `<p class="legal-material-content">${escapeHTML(content)}</p>`;
}

function splitLegalMaterialRow(line) {
  const separator = line.includes("|") ? "|" : line.includes(";") ? ";" : "\t";
  return line.split(separator).map((cell) => cell.trim());
}

function renderLegalMaterialTable(content) {
  const rows = parseLegalMaterialTable(content);

  if (!rows.length) return `<p class="legal-material-content">${escapeHTML(content)}</p>`;

  return `
    <div class="legal-material-table">
      ${legalMaterialTableToHTML({ content })}
    </div>
  `;
}

function renderLegalMaterialImage(item) {
  const src = getLegalImageSource(item);
  if (!src) return `<p class="legal-material-content">Imagem sem arquivo válido.</p>`;
  return `
    <figure class="legal-material-image">
      <img src="${escapeHTML(src)}" alt="${escapeHTML(item.title || "Imagem")}" loading="lazy" />
      ${item.reference ? `<figcaption>${escapeHTML(item.reference)}</figcaption>` : ""}
    </figure>
  `;
}

function renderPomodoro() {
  const activeTopicId = timer.topicId || $("#timerTopic").value;
  const activeSubjectId = timer.subjectId || getTopic(activeTopicId)?.subjectId || $("#timerSubject").value;
  const timerFace = $(".timer-face");
  const modeLabel = timer.mode === "focus" ? "Foco" : timer.mode === "longBreak" ? "Descanso longo" : "Pausa curta";
  $("#timerTopicLabel").textContent = activeSubjectId ? getEntryScopeLabel({ subjectId: activeSubjectId, topicId: activeTopicId }) : "Selecione uma matéria";
  $("#timerMode").textContent = modeLabel;
  $("#cycleCounter").textContent = `Ciclo ${timer.cycle} de ${state.settings.cycles}`;
  $("#timerDisplay").textContent = secondsToClock(timer.remaining);
  updatePomodoroPageTitle(modeLabel);
  timerFace?.classList.toggle("break-mode", timer.mode === "break" || timer.mode === "longBreak");
  timerFace?.classList.toggle("long-break-mode", timer.mode === "longBreak");
  timerFace?.classList.toggle("timer-running", timer.running);
  $("#skipTimerBtn").textContent = timer.mode === "focus" ? "Pular foco" : "Pular descanso";
  $("#tickLofiToggleBtn").textContent = state.settings.tickLofiEnabled ? "Desligar lofi" : "Ligar lofi";
  renderMusicPlayer();

  const recent = [...state.studyLogs]
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 12);
  $("#studyHistory").innerHTML = recent.length
    ? recent
        .map(
          (log) => `
        <tr>
          <td>${formatDate(log.date)}</td>
          <td>${escapeHTML(getEntryScopeLabel(log))}</td>
          <td>${formatMinutes(log.minutes)}</td>
          <td>${escapeHTML(log.source || "Manual")}</td>
          <td><button class="mini-button bad" data-action="deleteStudy" data-id="${log.id}" type="button">Excluir</button></td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="5">Nenhuma sessão registrada.</td></tr>`;
}

function updatePomodoroPageTitle(modeLabel = "") {
  if (!timer.running && timer.mode === "focus" && timer.remaining === state.settings.focusMinutes * 60) {
    document.title = APP_TITLE;
    return;
  }

  const label = modeLabel || (timer.mode === "focus" ? "Foco" : timer.mode === "longBreak" ? "Descanso longo" : "Pausa curta");
  document.title = `${secondsToClock(timer.remaining)} - ${label} | ${APP_TITLE}`;
}

function renderMusicPlayer() {
  const player = $("#musicPlayer");
  const url = state.media.url.trim();
  if (!url) {
    player.innerHTML = `<div class="empty-state">Cole um link do YouTube ou Spotify para ouvir durante o Pomodoro.</div>`;
    return;
  }

  const embed = buildMediaEmbed(url);
  if (!embed) {
    const safeUrl = getSafeExternalUrl(url);
    if (!safeUrl) {
      player.innerHTML = `<div class="empty-state">Cole um link válido do YouTube ou Spotify.</div>`;
      return;
    }

    player.innerHTML = `
      <div class="empty-state">
        Link salvo. Não consegui incorporar esse endereço, mas você pode abrir a música em outra aba.
      </div>
      <a class="button secondary" href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">Abrir música</a>
    `;
    return;
  }

  player.innerHTML = `
    <iframe
      class="${embed.type === "youtube" ? "youtube-frame" : "spotify-frame"}"
      src="${escapeHTML(embed.src)}"
      title="${embed.type === "youtube" ? "Player do YouTube" : "Player do Spotify"}"
      allow="${embed.allow}"
      loading="lazy"
      allowfullscreen>
    </iframe>
    <p class="music-note">${escapeHTML(embed.note)}</p>
    <a class="button ghost" href="${escapeHTML(getSafeExternalUrl(url) || embed.src)}" target="_blank" rel="noopener noreferrer">Abrir no serviço</a>
  `;
}

function buildMediaEmbed(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      return videoId ? youtubeEmbed(videoId) : null;
    }

    if (host === "youtube.com" || host === "music.youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") return youtubeEmbed(url.searchParams.get("v"));
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed") return youtubeEmbed(parts[1]);
    }

    if (host === "open.spotify.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const [type, id] = parts;
      const supported = ["track", "playlist", "album", "episode", "show", "artist"];
      if (supported.includes(type) && id) {
        return {
          type: "spotify",
          src: `https://open.spotify.com/embed/${type}/${id}`,
          allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
          note: "Spotify pode pedir login dependendo do conteúdo ou do navegador.",
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getSafeExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function youtubeEmbed(videoId) {
  if (!videoId) return null;
  return {
    type: "youtube",
    src: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    note: "Se o vídeo bloquear incorporação, use o botão para abrir no YouTube.",
  };
}

function secondsToClock(value) {
  const safe = Math.max(0, Math.floor(value));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderReports() {
  const range = state.ui.reportRange;
  $$(".segment[data-report-range]").forEach((button) => button.classList.toggle("active", button.dataset.reportRange === range));

  const predicate = getRangePredicate(range);
  const studyLogs = state.studyLogs.filter(predicate);
  const questionLogs = state.questionLogs.filter(predicate);
  const minutes = studyLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const correct = questionLogs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = questionLogs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const total = correct + wrong;
  const accuracy = total ? (correct / total) * 100 : 0;

  $("#reportStats").innerHTML = [
    statCard("Tempo", formatMinutes(minutes), getRangeLabel(range)),
    statCard("Questões", String(total), `${correct} acertos e ${wrong} erros`),
    statCard("Precisão", percent(accuracy), "no período selecionado"),
    statCard("Sessões", String(studyLogs.length), "registros de estudo"),
  ].join("");

  renderSubjectTimeChart(studyLogs);
  renderSubjectAccuracyList(questionLogs);
}

function renderSubjectTimeChart(studyLogs) {
  const data = state.subjects.map((subject) => {
    const minutes = studyLogs
      .filter((log) => getEntrySubjectId(log) === subject.id)
      .reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    return { ...subject, minutes };
  });
  const max = Math.max(1, ...data.map((item) => item.minutes));
  $("#subjectTimeChart").innerHTML = data.some((item) => item.minutes)
    ? data
        .map(
          (item) => `
        <div class="horizontal-row">
          <span>${escapeHTML(item.name)}</span>
          <div class="horizontal-track">
            <div class="horizontal-fill" style="--progress:${clamp((item.minutes / max) * 100, 0, 100)}%; --fill:${item.color}"></div>
          </div>
          <strong>${formatMinutes(item.minutes)}</strong>
        </div>
      `
        )
        .join("")
    : `<div class="empty-state">Nenhum tempo registrado neste período.</div>`;
}

function renderSubjectAccuracyList(questionLogs) {
  const data = state.subjects.map((subject) => {
    const logs = questionLogs.filter((log) => getEntrySubjectId(log) === subject.id);
    const correct = logs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
    const wrong = logs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
    const total = correct + wrong;
    return { ...subject, correct, wrong, total, accuracy: total ? (correct / total) * 100 : 0 };
  });

  $("#subjectAccuracyList").innerHTML = data.some((item) => item.total)
    ? data
        .filter((item) => item.total)
        .sort((a, b) => a.accuracy - b.accuracy)
        .map(
          (item) => `
        <article class="insight-item">
          <div class="insight-top">
            <strong>${escapeHTML(item.name)}</strong>
            <strong>${percent(item.accuracy)}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="--progress:${clamp(item.accuracy, 0, 100)}%; --fill:${item.color}"></div>
          </div>
          <small>${item.correct} acertos, ${item.wrong} erros</small>
        </article>
      `
        )
        .join("")
    : `<div class="empty-state">Nenhuma questão lançada neste período.</div>`;
}

function drawStudyCanvas() {
  const canvas = $("#studyCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const totalMinutes = state.studyLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const correct = state.questionLogs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const wrong = state.questionLogs.reduce((sum, log) => sum + Number(log.wrong || 0), 0);
  const totalQuestions = correct + wrong;
  const accuracy = totalQuestions ? correct / totalQuestions : 0;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fbfc";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#edf8f6";
  roundRect(ctx, 26, 24, 260, 230, 8);
  ctx.fill();
  ctx.fillStyle = "#fff7ed";
  roundRect(ctx, 312, 42, 278, 204, 8);
  ctx.fill();

  state.subjects.slice(0, 6).forEach((subject, index) => {
    const x = 54 + index * 34;
    const bookHeight = 95 + ((getSubjectStats(subject.id).minutes % 90) || index * 12);
    ctx.fillStyle = subject.color;
    roundRect(ctx, x, 218 - bookHeight, 22, bookHeight, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillRect(x + 6, 132, 10, Math.max(12, bookHeight - 40));
  });

  ctx.strokeStyle = "#9fb0bf";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(448, 136, 58, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(448, 136, 58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * accuracy);
  ctx.stroke();

  ctx.fillStyle = "#17202a";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(percent(accuracy * 100), 448, 132);
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.fillStyle = "#64717f";
  ctx.fillText("precisão", 448, 158);

  ctx.fillStyle = "#17202a";
  ctx.textAlign = "left";
  ctx.font = "800 18px system-ui, sans-serif";
  ctx.fillText(formatMinutes(totalMinutes), 48, 258);
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.fillStyle = "#64717f";
  ctx.fillText("registrados no histórico", 48, 278);

  ctx.fillStyle = "#c2410c";
  for (let i = 0; i < 12; i += 1) {
    const x = 354 + (i % 6) * 32;
    const y = 210 + Math.floor(i / 6) * 24;
    ctx.globalAlpha = i < Math.round(accuracy * 12) ? 0.9 : 0.22;
    roundRect(ctx, x, y, 18, 14, 4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function resetTimer() {
  window.clearInterval(timer.interval);
  stopLofiTick();
  timer.interval = null;
  timer.running = false;
  timer.mode = "focus";
  timer.remaining = state.settings.focusMinutes * 60;
  timer.elapsedFocusSeconds = 0;
  timer.elapsedSinceLongBreakSeconds = 0;
  timer.cycle = 1;
  timer.subjectId = "";
  timer.topicId = "";
  renderPomodoro();
}

function getPomodoroAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!pomodoroAudioContext) pomodoroAudioContext = new AudioContextConstructor();
  return pomodoroAudioContext;
}

function unlockPomodoroAlarm() {
  const context = getPomodoroAudioContext();
  if (context?.state === "suspended") context.resume().catch(() => {});
}

function playPomodoroAlarm(type = "cycle") {
  const context = getPomodoroAudioContext();
  if (!context) return;

  const schedule = () => {
    const patterns = {
      break: [660, 880],
      focus: [880, 660],
      complete: [660, 880, 990],
      cycle: [740, 880],
    };
    const frequencies = patterns[type] || patterns.cycle;

    frequencies.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.18;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
    });

    if (navigator.vibrate) {
      navigator.vibrate(type === "complete" ? [160, 70, 160, 70, 220] : [140, 60, 140]);
    }
  };

  if (context.state === "suspended") {
    context.resume().then(schedule).catch(() => {});
    return;
  }

  schedule();
}

function playLofiTickPulse() {
  const context = getPomodoroAudioContext();
  if (!context || context.state === "suspended") return;

  const start = context.currentTime;
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const isAccent = lofiTickStep % 2 === 0;

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(isAccent ? 860 : 620, start);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(isAccent ? 1200 : 900, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(isAccent ? 0.055 : 0.038, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.085);

  oscillator.connect(filter).connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.1);
  lofiTickStep += 1;
}

function startLofiTick() {
  stopLofiTick();
  if (!state.settings.tickLofiEnabled || !timer.running) return;
  unlockPomodoroAlarm();
  playLofiTickPulse();
  lofiTickInterval = window.setInterval(playLofiTickPulse, 1000);
}

function stopLofiTick() {
  window.clearInterval(lofiTickInterval);
  lofiTickInterval = null;
}

function toggleLofiTick() {
  state.settings.tickLofiEnabled = !state.settings.tickLofiEnabled;
  saveState();
  if (state.settings.tickLofiEnabled && timer.running) {
    startLofiTick();
  } else {
    stopLofiTick();
  }
  renderPomodoro();
  showToast(state.settings.tickLofiEnabled ? "Lofi tic-tac ligado." : "Lofi tic-tac desligado.");
}

function startTimer() {
  if (timer.running) return;
  const { subjectId, topicId } = resolveSubjectTopic("#timerSubject", "#timerTopic");
  if (!subjectId) {
    showToast("Cadastre e selecione uma matéria para usar o Pomodoro.");
    return;
  }
  unlockPomodoroAlarm();
  if (!timer.subjectId) timer.subjectId = subjectId;
  if (!timer.topicId) timer.topicId = topicId;
  timer.running = true;
  timer.interval = window.setInterval(tickTimer, 1000);
  startLofiTick();
  renderPomodoro();
}

function pauseTimer() {
  window.clearInterval(timer.interval);
  stopLofiTick();
  timer.interval = null;
  timer.running = false;
  renderPomodoro();
}

function tickTimer() {
  timer.remaining -= 1;
  if (timer.mode === "focus") timer.elapsedFocusSeconds += 1;
  if (timer.mode !== "longBreak") timer.elapsedSinceLongBreakSeconds += 1;

  if (timer.remaining <= 0) {
    completeTimerBlock();
  }

  renderPomodoro();
  renderDashboard();
  renderReports();
}

function longBreakIsDue() {
  const everySeconds = Math.max(1, Number(state.settings.longBreakEveryMinutes || 120)) * 60;
  return timer.elapsedSinceLongBreakSeconds >= everySeconds || Number(timer.cycle || 1) >= Number(state.settings.cycles || 4);
}

function startBreakBlock(isLongBreak, skipped = false) {
  timer.mode = isLongBreak ? "longBreak" : "break";
  timer.remaining = (isLongBreak ? state.settings.longBreakMinutes : state.settings.breakMinutes) * 60;
  if (isLongBreak) timer.elapsedSinceLongBreakSeconds = 0;
  playPomodoroAlarm(isLongBreak ? "complete" : "break");
  showToast(
    isLongBreak
      ? `${skipped ? "Foco pulado." : "Bloco de foco encerrado."} Descanso longo iniciado.`
      : `${skipped ? "Foco pulado." : "Bloco de foco encerrado."} Pausa curta iniciada.`
  );
}

function startFocusBlock(skipped = false) {
  if (timer.mode === "longBreak") {
    timer.cycle = 1;
  } else {
    timer.cycle += 1;
  }
  timer.mode = "focus";
  timer.remaining = state.settings.focusMinutes * 60;
  playPomodoroAlarm("focus");
  showToast(skipped ? "Descanso pulado. Novo foco iniciado." : "Novo bloco de foco iniciado.");
}

function completeTimerBlock(options = {}) {
  const skipped = Boolean(options.skipped);

  if (timer.mode === "focus") {
    if (timer.elapsedFocusSeconds >= 60 || !skipped) {
      logPomodoroFocus();
    } else {
      timer.elapsedFocusSeconds = 0;
    }
    startBreakBlock(longBreakIsDue(), skipped);
    return;
  }

  if (timer.mode === "break" && timer.elapsedSinceLongBreakSeconds >= Math.max(1, Number(state.settings.longBreakEveryMinutes || 120)) * 60) {
    startBreakBlock(true, skipped);
    return;
  }

  startFocusBlock(skipped);
}

function skipTimerStep() {
  if (!timer.subjectId && timer.mode === "focus") {
    const { subjectId, topicId } = resolveSubjectTopic("#timerSubject", "#timerTopic");
    if (!subjectId) {
      showToast("Selecione uma matéria antes de pular a etapa.");
      return;
    }
    timer.subjectId = subjectId;
    timer.topicId = topicId;
  }
  completeTimerBlock({ skipped: true });
  renderPomodoro();
  renderDashboard();
  renderReports();
}

function logPomodoroFocus() {
  const selected = resolveSubjectTopic("#timerSubject", "#timerTopic");
  const subjectId = timer.subjectId || selected.subjectId;
  const topicId = timer.topicId || selected.topicId;
  const minutes = Math.max(1, Math.round(timer.elapsedFocusSeconds / 60));
  if (!subjectId || !minutes) return;
  state.studyLogs.push({
    id: uid(),
    subjectId,
    topicId,
    minutes,
    date: todayISO(),
    source: "Pomodoro",
    note: `Ciclo ${timer.cycle}`,
    createdAt: new Date().toISOString(),
  });
  timer.elapsedFocusSeconds = 0;
  saveState();
}

function finishTimerManually() {
  if (timer.mode !== "focus" || timer.elapsedFocusSeconds < 60) {
    showToast("O foco precisa ter pelo menos 1 minuto para registrar.");
    return;
  }
  logPomodoroFocus();
  resetTimer();
  render();
  showToast("Sessão registrada.");
}

function attachEvents() {
  document.addEventListener("mousedown", (event) => {
    const editorButton = event.target.closest("[data-rich-command], [data-rich-highlight], [data-rich-color], [data-highlight], [data-source-highlight], [data-reader-highlight]");
    if (editorButton) event.preventDefault();
  });

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }

    const caseTab = event.target.closest("[data-case-tab]");
    if (caseTab) {
      state.ui.caseCourt = caseTab.dataset.caseTab;
      saveState();
      renderCases();
      return;
    }

    const reportTab = event.target.closest("[data-report-range]");
    if (reportTab) {
      state.ui.reportRange = reportTab.dataset.reportRange;
      saveState();
      renderReports();
      return;
    }

    const controlTab = event.target.closest("[data-control-range]");
    if (controlTab) {
      state.ui.controlRange = controlTab.dataset.controlRange;
      saveState();
      renderControl();
      renderGoals();
      return;
    }

    const readerHighlight = event.target.closest("[data-reader-highlight]");
    if (readerHighlight) {
      applyHighlightToEditor("#activeSourceReader", readerHighlight.dataset.readerHighlight, "#readerHighlightColor");
      return;
    }

    const richCommand = event.target.closest("[data-rich-command]");
    if (richCommand) {
      applyRichEditorCommand(richCommand);
      return;
    }

    const richHighlight = event.target.closest("[data-rich-highlight]");
    if (richHighlight) {
      applyRichEditorHighlight(richHighlight);
      return;
    }

    const richColor = event.target.closest("[data-rich-color]");
    if (richColor) {
      applyRichEditorColor(richColor);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) handleAction(action);
  });

  $("#profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    accessProfileByNameAndPin($("#profileName").value, $("#profilePin").value);
  });

  $("#logoutProfileBtn").addEventListener("click", logoutProfile);

  $("#caseFilterForm").addEventListener("submit", (event) => {
    event.preventDefault();
    renderCases();
  });

  $("#caseSearch").addEventListener("input", (event) => {
    state.ui.caseSearch = event.target.value;
    saveState();
    renderCases();
  });

  $("#caseSubjectFilter").addEventListener("change", (event) => {
    state.ui.caseSubjectFilter = event.target.value;
    state.ui.caseTopicFilter = "";
    saveState();
    renderCases();
  });

  $("#caseTopicFilter").addEventListener("change", (event) => {
    state.ui.caseTopicFilter = event.target.value;
    saveState();
    renderCases();
  });

  $("#clearCaseFiltersBtn").addEventListener("click", () => {
    state.ui.caseSearch = "";
    state.ui.caseSubjectFilter = "";
    state.ui.caseTopicFilter = "";
    saveState();
    renderCases();
  });

  $("#caseCancelEditBtn").addEventListener("click", () => {
    resetCaseForm();
    saveState();
    renderCases();
    showToast("Edição da jurisprudência cancelada.");
  });

  $("#controlDayDate").addEventListener("change", (event) => {
    state.ui.controlDayDate = event.target.value || todayISO();
    saveState();
    renderControl();
  });

  $("#controlWeekDate").addEventListener("change", (event) => {
    state.ui.controlWeekDate = event.target.value || todayISO();
    saveState();
    renderControl();
  });

  $("#controlMonthInput").addEventListener("change", (event) => {
    state.ui.controlMonth = event.target.value || todayISO().slice(0, 7);
    saveState();
    renderControl();
  });

  $("#controlYearInput").addEventListener("change", (event) => {
    state.ui.controlYear = Number(event.target.value) || new Date().getFullYear();
    saveState();
    renderControl();
  });

  $("#goalForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#goalTitle").value.trim();
    const date = $("#goalDate").value;
    if (!title || !date) {
      showToast("Informe nome e data do objetivo.");
      return;
    }
    state.goals.push({
      id: uid(),
      title,
      date,
      category: $("#goalCategory").value.trim(),
      createdAt: new Date().toISOString(),
    });
    saveState();
    event.target.reset();
    $("#goalDate").value = todayISO();
    renderGoals();
    showToast("Objetivo salvo.");
  });

  $("#accountForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.account.name = $("#accountName").value.trim();
    state.account.email = $("#accountEmail").value.trim();
    state.profile.name = state.account.name || state.profile.name;
    saveState();
    renderProfilePanel();
    showToast("Login local salvo.");
  });

  $("#generateBackupBtn").addEventListener("click", () => {
    $("#backupCode").value = createBackupPayload();
    showToast("Backup gerado.");
  });

  $("#downloadBackupBtn").addEventListener("click", () => {
    downloadBackupFile();
  });

  $("#restoreBackupBtn").addEventListener("click", () => {
    restoreBackupFromText($("#backupCode").value);
  });

  $("#copyBackupBtn").addEventListener("click", async () => {
    const text = $("#backupCode").value || createBackupPayload();
    $("#backupCode").value = text;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Backup copiado.");
    } catch {
      showToast("Backup gerado. Copie manualmente o texto.");
    }
  });

  $("#resetStatsBtn").addEventListener("click", () => {
    if (!window.confirm("Zerar todas as estatísticas do site? Isso apaga históricos de tempo, questões, relatórios e estatísticas dos flashcards, mas mantém cadastros e anotações.")) return;
    resetAllStats();
    saveState();
    render();
    showToast("Estatísticas zeradas.");
  });

  $("#subjectForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#subjectName").value.trim();
    const goalHours = Number($("#subjectGoal").value);
    const color = $("#subjectColor").value;
    if (!name) return;
    state.subjects.push({ id: uid(), name, color, goalHours });
    saveState();
    event.target.reset();
    $("#subjectGoal").value = 3;
    $("#subjectColor").value = "#0f766e";
    render();
    showToast("Matéria adicionada.");
  });

  $("#topicForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const subjectId = $("#topicSubject").value;
    const name = $("#topicName").value.trim();
    const priority = $("#topicPriority").value;
    if (!subjectId || !name) return;
    state.topics.push({ id: uid(), subjectId, name, priority });
    saveState();
    event.target.reset();
    render();
    showToast("Assunto adicionado.");
  });

  $("#questionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const topicId = $("#questionTopic").value;
    const correct = Number($("#questionCorrect").value);
    const wrong = Number($("#questionWrong").value);
    if (!topicId || correct + wrong <= 0) {
      showToast("Informe ao menos uma questão.");
      return;
    }
    state.questionLogs.push({
      id: uid(),
      topicId,
      correct,
      wrong,
      date: $("#questionDate").value || todayISO(),
      notes: $("#questionNotes").value.trim(),
    });
    saveState();
    event.target.reset();
    $("#questionCorrect").value = 0;
    $("#questionWrong").value = 0;
    $("#questionDate").value = todayISO();
    render();
    showToast("Questões salvas.");
  });

  $("#caseForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const court = state.ui.caseCourt;
    const { subjectId, topicId } = resolveSubjectTopic("#caseSubject", "#caseTopic");
    const summary = sanitizeNoteHTML($("#caseSummaryEditor").innerHTML.trim());
    const title = $("#caseTitle").value.trim();
    if (!title || !richTextHasContent(summary)) {
      showToast("Preencha título e tese/resumo.");
      return;
    }
    const payload = normalizeCaseItem({
      id: uid(),
      subjectId,
      topicId,
      title,
      date: $("#caseDate").value || todayISO(),
      theme: $("#caseTheme").value.trim(),
      summary,
      tags: $("#caseTags").value,
      source: $("#caseSource").value.trim(),
    });
    const existing = state.cases[court].find((item) => item.id === state.ui.activeCaseEditId);
    if (existing) {
      payload.id = existing.id;
      Object.assign(existing, payload);
    } else {
      state.cases[court].push(payload);
    }
    resetCaseForm();
    saveState();
    render();
    showToast(existing ? "Jurisprudência atualizada." : `Jurisprudência do ${court} salva.`);
  });

  $("#legalMaterialForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const { subjectId, topicId } = resolveSubjectTopic("#legalMaterialSubject", "#legalMaterialTopic");
    const material = normalizeLegalMaterial({
      id: uid(),
      type: $("#legalMaterialType").value,
      subjectId,
      topicId,
      title: $("#legalMaterialTitle").value,
      reference: $("#legalMaterialReference").value,
      content: $("#legalMaterialContent").value,
      source: $("#legalMaterialSource").value,
      createdAt: todayISO(),
      updatedAt: new Date().toISOString(),
    });
    state.legalMaterials.push(material);
    saveState();
    event.target.reset();
    render();
    showToast(`${legalMaterialTypeLabel(material.type)} salva.`);
  });

  $("#legalMaterialImage").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await setLegalMaterialImageFromFile(file);
    event.target.value = "";
  });

  $("#legalMaterialContent").addEventListener("paste", (event) => {
    handleLegalMaterialContentPaste(event);
  });

  $("#timerSettingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.focusMinutes = clamp(Number($("#focusMinutes").value), 1, 240);
    state.settings.breakMinutes = clamp(Number($("#breakMinutes").value), 1, 120);
    state.settings.longBreakMinutes = clamp(Number($("#longBreakMinutes").value), 1, 180);
    state.settings.longBreakEveryMinutes = clamp(Number($("#longBreakEveryMinutes").value), 15, 480);
    state.settings.cycles = clamp(Number($("#cycleTotal").value), 1, 8);
    saveState();
    resetTimer();
    render();
    showToast("Pomodoro ajustado.");
  });

  $("#studyLogForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const { subjectId, topicId } = resolveSubjectTopic("#studySubject", "#studyTopic");
    const minutes = Number($("#studyMinutes").value);
    if (!subjectId) {
      showToast("Cadastre e selecione uma matéria para registrar tempo.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      showToast("Informe uma quantidade de minutos maior que zero.");
      return;
    }
    const selectedDate = $("#studyDate").value || todayISO();
    const selectedNote = $("#studyNote").value.trim();
    state.studyLogs.push({
      id: uid(),
      subjectId,
      topicId,
      minutes: Math.round(minutes),
      date: selectedDate,
      source: "Manual",
      note: selectedNote,
      createdAt: new Date().toISOString(),
    });
    saveState();
    $("#studySubject").value = subjectId;
    $("#studyTopic").value = topicId;
    $("#studyMinutes").value = 30;
    $("#studyDate").value = selectedDate;
    $("#studyNote").value = "";
    render();
    showToast("Tempo registrado.");
  });

  $("#flashcardForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const { subjectId, topicId } = resolveSubjectTopic("#flashcardSubject", "#flashcardTopic");
    const front = sanitizeNoteHTML($("#flashcardFrontEditor").innerHTML.trim());
    const back = sanitizeNoteHTML($("#flashcardBackEditor").innerHTML.trim());
    if (!subjectId || !richTextHasContent(front) || !richTextHasContent(back)) {
      showToast("Preencha matéria, frente e verso do flashcard.");
      return;
    }

    const card = normalizeFlashcard({
      id: state.ui.activeFlashcardEditId || uid(),
      subjectId,
      topicId,
      front,
      back,
      priority: $("#flashcardPriority").value,
      difficulty: $("#flashcardDifficulty").value,
      createdAt: todayISO(),
      dueDate: todayISO(),
      nextDueReviewNumber: Number(state.flashcardSettings.reviewCounter || 0),
      reviews: 0,
      correct: 0,
      wrong: 0,
      lastReviewed: "",
      updatedAt: new Date().toISOString(),
    });
    const existing = state.flashcards.find((item) => item.id === state.ui.activeFlashcardEditId);
    if (existing) {
      Object.assign(existing, {
        ...card,
        id: existing.id,
        reviews: existing.reviews,
        correct: existing.correct,
        wrong: existing.wrong,
        lastReviewed: existing.lastReviewed,
        nextDueReviewNumber: existing.nextDueReviewNumber,
        dueDate: existing.dueDate,
      });
    } else {
      state.flashcards.push(card);
    }
    state.ui.activeFlashcardId = card.id;
    state.ui.flashcardAnswerOpen = false;
    resetFlashcardForm();
    saveState();
    render();
    showToast(existing ? "Flashcard atualizado." : "Flashcard salvo.");
  });

  $("#flashcardSettingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.flashcardSettings.intervals.hard = clamp(Number($("#hardInterval").value), 1, 99);
    state.flashcardSettings.intervals.medium = clamp(Number($("#mediumInterval").value), 1, 99);
    state.flashcardSettings.intervals.easy = clamp(Number($("#easyInterval").value), 1, 99);
    saveState();
    renderFlashcards();
    showToast("Intervalos dos flashcards salvos.");
  });

  $("#flashcardReviewForm").addEventListener("submit", (event) => {
    event.preventDefault();
    updateFlashcardReviewSettings();
  });

  $("#flashcardCancelEditBtn").addEventListener("click", () => {
    resetFlashcardForm();
    saveState();
    renderFlashcards();
    showToast("Edição do flashcard cancelada.");
  });

  ["#flashcardReviewOrder", "#flashcardReviewScope", "#flashcardReviewSubject", "#flashcardReviewTopic"].forEach((selector) => {
    $(selector).addEventListener("change", () => updateFlashcardReviewSettings());
  });

  $("#categoryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const category = ensureCategory($("#categoryName").value);
    if (!category) {
      showToast("Informe o nome da categoria.");
      return;
    }
    saveState();
    event.target.reset();
    renderNotes();
    showToast("Categoria adicionada.");
  });

  $("#sourceForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const url = getSafeExternalUrl($("#sourceUrl").value.trim());
    const category = resolveCategory("#sourceCategorySelect", "#sourceCategoryNew");
    const autoSync = $("#sourceAutoSync").checked;
    if (!url) {
      showToast("Informe um link válido para a fonte.");
      return;
    }
    if (!category) {
      showToast("Escolha ou crie uma categoria para a fonte.");
      return;
    }

    const content = sanitizeNoteHTML($("#sourceContentEditor").innerHTML.trim());
    const existing = state.sources.find((source) => source.id === state.ui.activeSourceEditId);
    if (existing) {
      existing.category = category;
      existing.title = $("#sourceTitle").value.trim();
      existing.url = url;
      existing.content = content;
      existing.autoSync = autoSync;
      existing.updatedAt = new Date().toISOString();
      state.ui.activeSourceId = existing.id;
    } else {
      const source = {
        id: uid(),
        category,
        title: $("#sourceTitle").value.trim(),
        url,
        content,
        autoSync,
        createdAt: todayISO(),
        updatedAt: new Date().toISOString(),
      };
      state.sources.push(source);
      state.ui.activeSourceId = source.id;
    }
    state.ui.activeSourceEditId = "";
    saveState();
    resetSourceForm();
    renderNotes();
    showToast(existing ? "Fonte atualizada." : "Fonte salva.");
    if (autoSync && !richTextHasContent(content)) {
      syncSourceFromUrl(state.ui.activeSourceId, { silent: false });
    }
  });

  $("#importSourceUrlBtn").addEventListener("click", importCurrentSourceUrlToForm);

  $("#cancelSourceEditBtn").addEventListener("click", () => {
    state.ui.activeSourceEditId = "";
    saveState();
    resetSourceForm();
    renderNotes();
    showToast("Edição da fonte cancelada.");
  });

  $("#activeSourceSelect").addEventListener("change", (event) => {
    state.ui.activeSourceId = event.target.value;
    saveState();
    renderNotes();
  });

  $("#refreshSourceBtn").addEventListener("click", () => {
    renderSourcePreview();
    showToast("Fonte atualizada na visualização.");
  });

  $$(".highlight-toolbar [data-highlight]").forEach((button) => {
    button.addEventListener("click", () => applyHighlight(button.dataset.highlight));
  });

  $$(".highlight-toolbar [data-source-highlight]").forEach((button) => {
    button.addEventListener("click", () => applyHighlightToEditor("#sourceContentEditor", button.dataset.sourceHighlight, "#sourceHighlightColor"));
  });

  $("#noteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#noteTitle").value.trim();
    const category = resolveCategory("#noteCategorySelect", "#noteCategoryNew");
    const content = sanitizeNoteHTML($("#noteEditor").innerHTML.trim());
    if (!title || !category || !content) {
      showToast("Preencha título, categoria e anotação.");
      return;
    }

    const existing = state.notes.find((note) => note.id === state.ui.activeNoteId);
    if (existing) {
      existing.title = title;
      existing.category = category;
      existing.sourceId = $("#noteSource").value;
      existing.content = content;
      existing.updatedAt = new Date().toISOString();
    } else {
      state.notes.push({
        id: uid(),
        title,
        category,
        sourceId: $("#noteSource").value,
        content,
        createdAt: todayISO(),
        updatedAt: new Date().toISOString(),
      });
    }

    state.ui.activeNoteId = "";
    saveState();
    event.target.reset();
    $("#noteEditor").innerHTML = "";
    renderNotes();
    showToast("Anotação salva.");
  });

  $("#musicForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.media.url = $("#musicUrl").value.trim();
    saveState();
    renderPomodoro();
    showToast(state.media.url ? "Player de música salvo." : "Cole um link para salvar o player.");
  });

  $("#clearMusicBtn").addEventListener("click", () => {
    state.media.url = "";
    saveState();
    renderPomodoro();
    showToast("Player removido.");
  });

  $("#startTimerBtn").addEventListener("click", startTimer);
  $("#pauseTimerBtn").addEventListener("click", pauseTimer);
  $("#skipTimerBtn").addEventListener("click", skipTimerStep);
  $("#tickLofiToggleBtn").addEventListener("click", toggleLofiTick);
  $("#resetTimerBtn").addEventListener("click", resetTimer);
  $("#finishTimerBtn").addEventListener("click", finishTimerManually);
  [
    ["#timerSubject", "#timerTopic", renderPomodoro],
    ["#studySubject", "#studyTopic"],
    ["#flashcardSubject", "#flashcardTopic"],
    ["#caseSubject", "#caseTopic"],
    ["#legalMaterialSubject", "#legalMaterialTopic"],
  ].forEach(([subjectSelector, topicSelector, afterSync]) => {
    $(subjectSelector).addEventListener("change", () => {
      syncScopedTopicSelect(subjectSelector, topicSelector);
      if (afterSync) afterSync();
    });
  });
  $("#timerTopic").addEventListener("change", renderPomodoro);
  $("#themeToggleBtn").addEventListener("click", () => {
    state.ui.theme = state.ui.theme === "dark" ? "light" : "dark";
    saveState();
    render();
    showToast(state.ui.theme === "dark" ? "Modo escuro ativado." : "Modo claro ativado.");
  });
  $("#exportBtn").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", importData);
  $("#resetDemoBtn").addEventListener("click", () => {
    if (!window.confirm("Restaurar os dados de exemplo e substituir os dados atuais?")) return;
    state = createSeedState(state.profile);
    saveState();
    resetTimer();
    render();
    showToast("Exemplo restaurado.");
  });
}

function handleAction(action) {
  const id = action.dataset.id;
  const type = action.dataset.action;

  if (type === "quickQuestion") {
    const isCorrect = action.dataset.result === "correct";
    state.questionLogs.push({
      id: uid(),
      topicId: id,
      correct: isCorrect ? 1 : 0,
      wrong: isCorrect ? 0 : 1,
      date: todayISO(),
      notes: "Lançamento rápido",
    });
    saveState();
    render();
    showToast(isCorrect ? "Acerto registrado." : "Erro registrado.");
    return;
  }

  if (type === "quickStudy") {
    state.studyLogs.push({ id: uid(), topicId: id, minutes: 25, date: todayISO(), source: "Manual", note: "Lançamento rápido" });
    saveState();
    render();
    showToast("25 minutos registrados.");
    return;
  }

  if (type === "showFlashcardAnswer") {
    state.ui.activeFlashcardId = id;
    state.ui.flashcardAnswerOpen = true;
    saveState();
    renderFlashcards();
    return;
  }

  if (type === "reviewFlashcard") {
    reviewFlashcard(id, action.dataset.result === "correct");
    showToast(action.dataset.result === "correct" ? "Flashcard marcado como acerto." : "Flashcard marcado como erro.");
    return;
  }

  if (type === "setFlashcardDifficulty") {
    const card = state.flashcards.find((item) => item.id === id);
    if (!card) return;
    card.difficulty = action.dataset.difficulty || "medium";
    saveState();
    renderFlashcards();
    showToast(`Dificuldade alterada para ${difficultyLabel(card.difficulty)}.`);
    return;
  }

  if (type === "nextFlashcard") {
    const next = getFlashcardReviewQueue(getDueFlashcards(), state.ui.activeFlashcardId)[0];
    state.ui.activeFlashcardId = next?.id || "";
    state.ui.flashcardAnswerOpen = false;
    saveState();
    renderFlashcards();
    return;
  }

  if (type === "studyFlashcard") {
    const card = state.flashcards.find((item) => item.id === id);
    if (!card) return;
    const counter = Number(state.flashcardSettings.reviewCounter || 0);
    if (Number(card.nextDueReviewNumber || 0) > counter) {
      showToast("Este flashcard ainda não está pendente pela regra de dificuldade.");
      return;
    }
    const subjectId = getEntrySubjectId(card);
    state.ui.flashcardReviewScope = card.topicId ? "topic" : "subject";
    state.ui.flashcardReviewTopicId = card.topicId || state.ui.flashcardReviewTopicId || "";
    state.ui.flashcardReviewSubjectId = subjectId || state.ui.flashcardReviewSubjectId || "";
    state.ui.activeFlashcardId = id;
    state.ui.flashcardAnswerOpen = false;
    state.ui.view = "flashcards";
    saveState();
    render();
    return;
  }

  if (type === "editFlashcard") {
    const card = state.flashcards.find((item) => item.id === id);
    if (!card) return;
    state.ui.view = "flashcards";
    state.ui.activeFlashcardId = id;
    state.ui.activeFlashcardEditId = id;
    state.ui.flashcardAnswerOpen = false;
    saveState();
    render();
    fillFlashcardForm(card);
    saveState();
    $("#flashcardForm").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Flashcard carregado para edição.");
    return;
  }

  if (type === "deleteFlashcard") {
    state.flashcards = state.flashcards.filter((card) => card.id !== id);
    if (state.ui.activeFlashcardId === id) {
      state.ui.activeFlashcardId = "";
      state.ui.flashcardAnswerOpen = false;
    }
    if (state.ui.activeFlashcardEditId === id) {
      resetFlashcardForm();
    }
    saveState();
    render();
    showToast("Flashcard excluído.");
    return;
  }

  if (type === "deleteCategory") {
    const category = action.dataset.category;
    if (!category) return;
    if (!window.confirm("Excluir esta categoria? As fontes e anotações dela ficarão como Sem categoria.")) return;
    state.categories = (state.categories || []).filter((item) => item !== category);
    state.sources = state.sources.map((source) => (source.category === category ? { ...source, category: "Sem categoria" } : source));
    state.notes = state.notes.map((note) => (note.category === category ? { ...note, category: "Sem categoria" } : note));
    saveState();
    renderNotes();
    showToast("Categoria excluída.");
    return;
  }

  if (type === "selectSource") {
    state.ui.activeSourceId = id;
    saveState();
    renderNotes();
    showToast("Fonte selecionada.");
    return;
  }

  if (type === "editSource") {
    const source = getSource(id);
    if (!source) return;
    state.ui.activeSourceId = id;
    state.ui.activeSourceEditId = id;
    saveState();
    renderNotes();
    fillSourceForm(source);
    $("#sourceForm").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Fonte carregada para edição.");
    return;
  }

  if (type === "syncSource") {
    syncSourceFromUrl(id, { silent: false });
    return;
  }

  if (type === "applySourceSync") {
    const source = getSource(id);
    if (!source || !source.pendingContent) return;
    if (!window.confirm("Aplicar o texto atualizado? Isso substitui o texto atual do leitor e pode remover grifos existentes.")) return;
    applySyncedContent(source, source.pendingContent, source.pendingSyncHash || sourceContentHash(source.pendingContent));
    source.lastSyncStatus = "Atualização aplicada";
    source.updatedAt = new Date().toISOString();
    saveState();
    renderNotes();
    showToast("Texto atualizado aplicado à fonte.");
    return;
  }

  if (type === "saveSourceReader") {
    const source = getSource(id);
    if (!source) return;
    source.content = sanitizeNoteHTML($("#activeSourceReader")?.innerHTML.trim() || "");
    source.updatedAt = new Date().toISOString();
    saveState();
    renderNotes();
    showToast("Grifos salvos nesta fonte.");
    return;
  }

  if (type === "clearSourceContent") {
    const source = getSource(id);
    if (!source) return;
    if (!window.confirm("Limpar o texto colado, grifos e conteúdo sincronizado desta fonte? O cadastro da fonte será mantido.")) return;
    source.content = "";
    source.lastImportedContent = "";
    source.pendingContent = "";
    source.lastSyncHash = "";
    source.appliedSyncHash = "";
    source.pendingSyncHash = "";
    source.pendingSyncedAt = "";
    source.lastSyncStatus = "Texto removido";
    source.lastSyncError = "";
    source.updatedAt = new Date().toISOString();
    saveState();
    renderNotes();
    showToast("Texto da fonte removido.");
    return;
  }

  if (type === "useSourceInNote") {
    state.ui.activeSourceId = id;
    $("#noteSource").value = id;
    const source = getSource(id);
    if (source && !resolveCategory("#noteCategorySelect", "#noteCategoryNew")) setCategoryFields("note", source.category);
    saveState();
    renderSourcePreview();
    showToast("Fonte vinculada à anotação.");
    return;
  }

  if (type === "deleteSource") {
    if (!window.confirm("Excluir esta fonte/site e os grifos salvos nela? As anotações vinculadas serão mantidas sem fonte.")) return;
    state.sources = state.sources.filter((source) => source.id !== id);
    state.notes = state.notes.map((note) => (note.sourceId === id ? { ...note, sourceId: "" } : note));
    if (state.ui.activeSourceId === id) state.ui.activeSourceId = "";
    if (state.ui.activeSourceEditId === id) state.ui.activeSourceEditId = "";
    saveState();
    resetSourceForm();
    renderNotes();
    showToast("Fonte removida.");
    return;
  }

  if (type === "editNote") {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;
    state.ui.activeNoteId = id;
    $("#noteTitle").value = note.title;
    setCategoryFields("note", note.category);
    $("#noteSource").value = note.sourceId || "";
    $("#noteEditor").innerHTML = sanitizeNoteHTML(note.content || "");
    saveState();
    showToast("Anotação carregada para edição.");
    return;
  }

  if (type === "deleteNote") {
    state.notes = state.notes.filter((note) => note.id !== id);
    if (state.ui.activeNoteId === id) state.ui.activeNoteId = "";
    saveState();
    renderNotes();
    showToast("Anotação excluída.");
    return;
  }

  if (type === "deleteGoal") {
    state.goals = state.goals.filter((goal) => goal.id !== id);
    saveState();
    renderGoals();
    showToast("Objetivo excluído.");
    return;
  }

  if (type === "deleteSubject") {
    if (!window.confirm("Excluir esta matéria e seus assuntos?")) return;
    state.subjects = state.subjects.filter((subject) => subject.id !== id);
    state.topics = state.topics.filter((topic) => topic.subjectId !== id);
    state.questionLogs = state.questionLogs.filter((log) => getEntrySubjectId(log) !== id);
    state.studyLogs = state.studyLogs.filter((log) => getEntrySubjectId(log) !== id);
    state.flashcards = state.flashcards.filter((card) => getEntrySubjectId(card) !== id);
    state.legalMaterials = state.legalMaterials.map((item) => (getEntrySubjectId(item) === id ? { ...item, subjectId: "", topicId: "" } : item));
    if (state.flashcards.every((card) => card.id !== state.ui.activeFlashcardId)) state.ui.activeFlashcardId = "";
    Object.keys(state.cases).forEach((court) => {
      state.cases[court] = state.cases[court].map((item) => (getEntrySubjectId(item) === id ? { ...item, subjectId: "", topicId: "" } : item));
    });
    saveState();
    render();
    showToast("Matéria excluída.");
    return;
  }

  if (type === "deleteTopic") {
    if (!window.confirm("Excluir este assunto e seus lançamentos?")) return;
    state.topics = state.topics.filter((topic) => topic.id !== id);
    state.questionLogs = state.questionLogs.filter((log) => log.topicId !== id);
    state.studyLogs = state.studyLogs.filter((log) => log.topicId !== id);
    state.flashcards = state.flashcards.filter((card) => card.topicId !== id);
    state.legalMaterials = state.legalMaterials.map((item) => (item.topicId === id ? { ...item, topicId: "" } : item));
    if (state.flashcards.every((card) => card.id !== state.ui.activeFlashcardId)) state.ui.activeFlashcardId = "";
    Object.keys(state.cases).forEach((court) => {
      state.cases[court] = state.cases[court].map((item) => (item.topicId === id ? { ...item, topicId: "" } : item));
    });
    saveState();
    render();
    showToast("Assunto excluído.");
    return;
  }

  if (type === "deleteQuestion") {
    state.questionLogs = state.questionLogs.filter((log) => log.id !== id);
    saveState();
    render();
    showToast("Lançamento removido.");
    return;
  }

  if (type === "deleteStudy") {
    state.studyLogs = state.studyLogs.filter((log) => log.id !== id);
    saveState();
    render();
    showToast("Sessão removida.");
    return;
  }

  if (type === "editCase") {
    const court = action.dataset.court;
    const item = state.cases[court]?.find((caseItem) => caseItem.id === id);
    if (!item) return;
    state.ui.view = "jurisprudencias";
    state.ui.caseCourt = court;
    state.ui.activeCaseEditId = id;
    saveState();
    render();
    fillCaseForm(item, court);
    saveState();
    $("#caseForm").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Jurisprudência carregada para edição.");
    return;
  }

  if (type === "deleteCase") {
    const court = action.dataset.court;
    state.cases[court] = state.cases[court].filter((item) => item.id !== id);
    if (state.ui.activeCaseEditId === id) {
      resetCaseForm();
    }
    saveState();
    renderCases();
    showToast("Jurisprudência removida.");
    return;
  }

  if (type === "copyLegalMaterial") {
    copyLegalMaterial(id, "rich");
    return;
  }

  if (type === "copyLegalMaterialText") {
    copyLegalMaterial(id, "text");
    return;
  }

  if (type === "downloadLegalMaterial") {
    downloadLegalMaterial(id);
    return;
  }

  if (type === "deleteLegalMaterial") {
    if (!window.confirm("Excluir esta lei ou tabela?")) return;
    state.legalMaterials = state.legalMaterials.filter((item) => item.id !== id);
    saveState();
    renderCases();
    showToast("Material removido.");
    return;
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `estudos-track-${todayISO()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createBackupPayload() {
  return JSON.stringify(
    {
      app: "estudos-track",
      version: 2,
      exportedAt: new Date().toISOString(),
      data: state,
    },
    null,
    2
  );
}

function downloadBackupFile() {
  const payload = createBackupPayload();
  $("#backupCode").value = payload;
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `estudos-track-backup-${todayISO()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Arquivo de backup baixado.");
}

function restoreBackupFromText(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    const payload = parsed.data ? parsed.data : parsed;
    const currentProfile = makeProfile(state.profile);
    const restored = normalizeState(payload);
    restored.profile = currentProfile;
    state = restored;
    saveState();
    resetTimer();
    render();
    showToast("Backup restaurado.");
  } catch {
    showToast("Backup inválido. Cole um JSON gerado pelo app.");
  }
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const currentProfile = makeProfile(state.profile);
      const imported = normalizeState(parsed.data ? parsed.data : parsed);
      imported.profile = currentProfile;
      state = imported;
      saveState();
      resetTimer();
      render();
      showToast("Dados importados.");
    } catch {
      showToast("Arquivo inválido.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

attachEvents();
resetTimer();
render();
