/*
 * Menu "Matérias e assuntos" (Jurisprudências e Flashcards) e janelas de cadastro.
 *
 * Reaproveita as funções puras do caderno.js (erroMaps, erroEntryScope, erroScopeMatches,
 * groupErrorsByScope), então a lista de julgados, leis/tabelas e flashcards se organiza
 * do mesmo jeito do Caderno de erros: menu em árvore à esquerda, trilha (Todas › Matéria › Assunto)
 * e blocos por matéria/assunto na lista.
 *
 * Carregado DEPOIS do caderno.js e ANTES do app.js. As funções puras não tocam no DOM
 * nem no estado global, então rodam nos testes em Node. O resto só usa o DOM/`state` em tempo de execução.
 *
 * Seleção do menu:
 *  - Jurisprudências: usa os filtros que já existiam no estado (caseSubjectFilter/caseTopicFilter e
 *    legalMaterialSubjectFilter/legalMaterialTopicFilter), então continuam salvos e a mesclagem de assuntos
 *    continua acertando os ids. "none" = sem matéria / sem assunto.
 *  - Flashcards: fica só na tela (estruturaUI.flash), sem mexer no formato dos dados salvos.
 */

// Nos testes em Node as funções do caderno.js não são globais: traz as que este módulo usa.
if (typeof erroMaps === "undefined" && typeof require === "function") Object.assign(globalThis, require("./caderno.js"));

const estruturaUI = {
  navOpen: { juris: {}, flash: {} },
  jurisSection: "cases", // "cases" (julgados STJ/STF) | "material" (leis, tabelas, anotações e imagens)
  materialType: "all", // all | law | table | note | image
  casesSearched: [], // julgados que passaram na busca (alimenta as contagens do menu)
  materialsSearched: [], // idem para leis/tabelas
  flash: { subject: "", topic: "", search: "", status: "all" },
};

const ESTRUTURA_MODAIS = {
  case: { modal: "#caseModal", focus: "#caseTitle" },
  material: { modal: "#legalMaterialModal", focus: "#legalMaterialTitle" },
  flash: { modal: "#flashcardModal", focus: "#flashcardSubject" },
};

/* ------------------------------------------------------------------ */
/* Funções puras                                                       */
/* ------------------------------------------------------------------ */

/**
 * Árvore Matéria > Assunto com contagens, para qualquer lista de itens com subjectId/topicId.
 * `isDue(item)` é opcional (flashcards pendentes). `keep` mantém o item selecionado no menu mesmo com zero.
 */
function estruturaBuildNav(entries, subjects, topics, { isDue = null, keep = {} } = {}) {
  const maps = erroMaps(subjects, topics);
  const counts = new Map();
  const bump = (key, due) => {
    const item = counts.get(key) || { total: 0, due: 0 };
    item.total += 1;
    if (due) item.due += 1;
    counts.set(key, item);
  };
  let total = 0;
  let due = 0;
  entries.forEach((entry) => {
    const scope = erroEntryScope(entry, maps);
    const isItemDue = Boolean(isDue && isDue(entry));
    bump(`s|${scope.subjectId}`, isItemDue);
    bump(`t|${scope.subjectId}|${scope.topicId}`, isItemDue);
    total += 1;
    if (isItemDue) due += 1;
  });
  const zero = { total: 0, due: 0 };
  const get = (key) => counts.get(key) || zero;
  const navSubjects = (subjects || [])
    .filter((subject) => counts.has(`s|${subject.id}`) || subject.id === keep.subject)
    .map((subject) => ({
      id: subject.id,
      name: subject.name,
      color: subject.color || "",
      ...get(`s|${subject.id}`),
      topics: (topics || [])
        .filter((topic) => topic.subjectId === subject.id && (counts.has(`t|${subject.id}|${topic.id}`) || topic.id === keep.topic))
        .map((topic) => ({ id: topic.id, name: topic.name, ...get(`t|${subject.id}|${topic.id}`) })),
      noTopic: get(`t|${subject.id}|`),
    }));
  const orphan = counts.has("s|") ? get("s|") : null;
  return { total, due, subjects: navSubjects, orphan };
}

/** O item cabe no filtro de matéria/assunto do menu? ("" = todos, "none" = sem vínculo) */
function estruturaScopeOk(item, subjectFilter, topicFilter, subjects, topics) {
  return erroScopeMatches(erroEntryScope(item, erroMaps(subjects, topics)), { subject: subjectFilter || "", topic: topicFilter || "" });
}

/** Descarta filtros que apontam para matéria/assunto que não existe mais. */
function estruturaCleanFilters(filters, subjects, topics) {
  const maps = erroMaps(subjects, topics);
  let subject = filters.subject || "";
  let topic = filters.topic || "";
  if (subject && subject !== "none" && !maps.subjectById.has(subject)) subject = "";
  if (!subject || subject === "none") topic = "";
  if (topic && topic !== "none" && maps.topicById.get(topic)?.subjectId !== subject) topic = "";
  return { subject, topic };
}

function estruturaTypeLabel(type) {
  return { law: "Leis", table: "Tabelas", note: "Anotações", image: "Imagens" }[type] || "Todos";
}

/* ------------------------------------------------------------------ */
/* Menu e trilha (HTML)                                                 */
/* ------------------------------------------------------------------ */

function estruturaNavHTML(area, nav, filters, { emptyText = "O menu aparece quando houver itens." } = {}) {
  const open = estruturaUI.navOpen[area];
  const badges = (item) => `${item.due ? `<span class="nav-due" title="pendentes">${item.due}</span>` : ""}<span class="nav-num">${item.total}</span>`;
  const item = (cls, active, subject, topic, label, counts, color) =>
    `<button type="button" class="error-nav-item ${cls} ${active ? "is-active" : ""}" data-estrutura="nav" data-area="${area}" data-subject="${subject}" data-topic="${topic}" ${active ? 'aria-current="true"' : ""}${color ? ` style="--dot:${escapeHTML(color)}"` : ""}>${color !== undefined ? '<i class="nav-dot" aria-hidden="true"></i>' : ""}<span class="nav-name">${escapeHTML(label)}</span>${badges(counts)}</button>`;

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
          <button type="button" class="error-nav-toggle" data-estrutura="toggle" data-area="${area}" data-subject="${subject.id}" aria-expanded="${isOpen && hasTopics}" aria-label="${isOpen ? "Recolher" : "Expandir"} assuntos de ${escapeHTML(subject.name)}" ${hasTopics ? "" : "disabled"}><span aria-hidden="true">›</span></button>
          ${item("is-subject", filters.subject === subject.id && !filters.topic, subject.id, "", subject.name, subject, subject.color || "#0f766e")}
        </div>
        ${isOpen && hasTopics ? `<div class="error-nav-topics">${topics}</div>` : ""}
      </div>`;
  });
  const orphan = nav.orphan ? `<div class="error-nav-row">${item("is-subject is-muted", filters.subject === "none", "none", "", "Sem matéria", nav.orphan, "#94a3b8")}</div>` : "";
  const all = item("is-all", !filters.subject, "", "", "Todas as matérias", nav);
  return nav.total || filters.subject ? `${all}${groups.join("")}${orphan}` : `<div class="empty-state">${escapeHTML(emptyText)}</div>`;
}

function estruturaCrumbHTML(area, filters, maps, rootLabel = "Todas") {
  if (!filters.subject) return "";
  const subject = filters.subject === "none" ? "Sem matéria" : maps.subjectById.get(filters.subject)?.name || "";
  const topic = filters.topic ? (filters.topic === "none" ? "Sem assunto específico" : maps.topicById.get(filters.topic)?.name || "") : "";
  const link = (subjectId, label) => `<button class="crumb-link" type="button" data-estrutura="nav" data-area="${area}" data-subject="${subjectId}" data-topic="">${escapeHTML(label)}</button>`;
  return `<nav class="error-crumb" aria-label="Local atual">${link("", rootLabel)}<span aria-hidden="true">›</span>${topic ? `${link(filters.subject, subject)}<span aria-hidden="true">›</span><strong>${escapeHTML(topic)}</strong>` : `<strong>${escapeHTML(subject)}</strong>`}</nav>`;
}

/** Blocos "Matéria" / "Assunto" com o cabeçalho de contagem, igual ao Caderno de erros. */
function estruturaGroupsHTML(items, filters, subjects, topics, renderItem, nounOne, nounMany) {
  const plural = (n) => `${n} ${n === 1 ? nounOne : nounMany}`;
  return groupErrorsByScope(items, subjects, topics, filters)
    .map(
      (group) => `
        <section class="error-group">
          ${group.title ? `<h4 class="error-group-title">${group.color ? `<i class="nav-dot" style="--dot:${escapeHTML(group.color)}" aria-hidden="true"></i>` : ""}${escapeHTML(group.title)}<small>${plural(group.items.length)}</small></h4>` : ""}
          ${group.items.map(renderItem).join("")}
        </section>`
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* Jurisprudências (julgados + leis e tabelas)                          */
/* ------------------------------------------------------------------ */

function estruturaJurisFilters() {
  return estruturaCleanFilters({ subject: state.ui.caseSubjectFilter, topic: state.ui.caseTopicFilter }, state.subjects, state.topics);
}

/** Chamado no começo do renderCases: corrige filtros apontando para o que foi apagado. */
function estruturaSanitizeJuris() {
  const clean = estruturaJurisFilters();
  state.ui.caseSubjectFilter = clean.subject;
  state.ui.caseTopicFilter = clean.topic;
  const cleanMaterial = estruturaCleanFilters({ subject: state.ui.legalMaterialSubjectFilter, topic: state.ui.legalMaterialTopicFilter }, state.subjects, state.topics);
  state.ui.legalMaterialSubjectFilter = cleanMaterial.subject;
  state.ui.legalMaterialTopicFilter = cleanMaterial.topic;
}

function estruturaMaterialTypeOk(item) {
  return estruturaUI.materialType === "all" || item.type === estruturaUI.materialType;
}

function estruturaCaseListHTML(items, totalCount) {
  if (!items.length) {
    return `<div class="empty-state">${
      totalCount
        ? "Nenhuma jurisprudência encontrada com esses filtros."
        : `<p>Nenhuma jurisprudência cadastrada${state.ui.caseSearchScope === "all" ? " em STJ ou STF" : " nesta aba"}.</p><button class="button primary" data-estrutura="add" data-kind="case" type="button">Adicionar a primeira jurisprudência</button>`
    }</div>`;
  }
  const courtOf = new Map(items.map(({ item, court }) => [item, court]));
  return estruturaGroupsHTML(items.map(({ item }) => item), estruturaJurisFilters(), state.subjects, state.topics, (item) => renderCaseCard(item, courtOf.get(item)), "julgado", "julgados");
}

function estruturaMaterialListHTML(items, totalCount) {
  if (!items.length) {
    return `<div class="empty-state">${
      totalCount
        ? "Nenhum material encontrado com esses filtros."
        : `<p>Nenhuma lei, tabela, anotação ou imagem cadastrada.</p><button class="button primary" data-estrutura="add" data-kind="material" type="button">Adicionar o primeiro material</button>`
    }</div>`;
  }
  const order = { law: 0, table: 1, note: 2, image: 3 };
  const sorted = [...items].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  return estruturaGroupsHTML(sorted, estruturaJurisFilters(), state.subjects, state.topics, renderLegalMaterialCard, "material", "materiais");
}

/** Menu, trilha, abas internas e botão de adicionar. Chamado ao final do renderLegalMaterials. */
function estruturaRenderJuris() {
  const nav = $("#jurisNav");
  if (!nav) return;
  const section = estruturaUI.jurisSection === "material" ? "material" : "cases";
  const filters = estruturaJurisFilters();
  const maps = erroMaps(state.subjects, state.topics);

  $$("[data-juris-section]").forEach((button) => {
    const active = button.dataset.jurisSection === section;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#jurisCasesPane")?.classList.toggle("hidden", section !== "cases");
  $("#jurisMaterialPane")?.classList.toggle("hidden", section !== "material");
  $("#jurisCourtTabs")?.classList.toggle("hidden", section !== "cases");

  const add = $("#jurisAddBtn");
  if (add) {
    add.dataset.kind = section === "cases" ? "case" : "material";
    add.textContent = section === "cases" ? "Adicionar jurisprudência" : "Adicionar material";
  }

  const entries = section === "cases" ? estruturaUI.casesSearched : estruturaUI.materialsSearched.filter(estruturaMaterialTypeOk);
  nav.innerHTML = estruturaNavHTML("juris", estruturaBuildNav(entries, state.subjects, state.topics, { keep: filters }), filters, {
    emptyText: section === "cases" ? "O menu aparece quando houver jurisprudências." : "O menu aparece quando houver leis, tabelas ou imagens.",
  });
  $("#jurisCrumb").innerHTML = estruturaCrumbHTML("juris", filters, maps);

  // Filtro por tipo (só em Leis e tabelas), com contagem
  const types = $("#jurisMaterialTypes");
  if (types) {
    const base = estruturaUI.materialsSearched.filter((item) => estruturaScopeOk(item, filters.subject, filters.topic, state.subjects, state.topics));
    types.innerHTML = ["all", "law", "table", "note", "image"]
      .map((type) => {
        const count = type === "all" ? base.length : base.filter((item) => item.type === type).length;
        const active = estruturaUI.materialType === type;
        return `<button class="segment ${active ? "active" : ""}" data-estrutura="materialType" data-type="${type}" role="tab" aria-selected="${active}" type="button">${estruturaTypeLabel(type)} <small>${count}</small></button>`;
      })
      .join("");
  }
}

function estruturaSetJurisSelection(subject, topic) {
  state.ui.caseSubjectFilter = subject;
  state.ui.caseTopicFilter = subject ? topic : "";
  state.ui.legalMaterialSubjectFilter = subject;
  state.ui.legalMaterialTopicFilter = subject ? topic : "";
}

/* ------------------------------------------------------------------ */
/* Flashcards                                                           */
/* ------------------------------------------------------------------ */

function estruturaFlashSearchText(card) {
  const subject = getSubject(getEntrySubjectId(card));
  return normalizeSearchText([richTextToPlain(card.front), richTextToPlain(card.back), getEntryScopeLabel(card), subject?.name, card.priority, difficultyLabel(card.difficulty)].join(" "));
}

function estruturaFlashMatchesBase(card, counter) {
  const filters = estruturaUI.flash;
  const search = normalizeSearchText(filters.search);
  if (search && !estruturaFlashSearchText(card).includes(search)) return false;
  const due = Number(card.nextDueReviewNumber || 0) <= counter;
  if (filters.status === "due") return due;
  if (filters.status === "waiting") return !due;
  if (filters.status === "hard") return card.difficulty === "hard";
  return true;
}

function estruturaRenderFlashLibrary() {
  const library = $("#flashcardLibrary");
  const nav = $("#flashNav");
  if (!library || !nav) return;
  const counter = Number(state.flashcardSettings.reviewCounter || 0);
  const clean = estruturaCleanFilters(estruturaUI.flash, state.subjects, state.topics);
  estruturaUI.flash.subject = clean.subject;
  estruturaUI.flash.topic = clean.topic;
  const filters = estruturaUI.flash;
  const maps = erroMaps(state.subjects, state.topics);

  cycleSetValueIfIdleSafe("#flashcardSearch", filters.search);
  if ($("#flashcardLibStatus")) $("#flashcardLibStatus").value = filters.status;

  const all = state.flashcards;
  const base = all.filter((card) => estruturaFlashMatchesBase(card, counter));
  nav.innerHTML = estruturaNavHTML("flash", estruturaBuildNav(base, state.subjects, state.topics, { isDue: (card) => Number(card.nextDueReviewNumber || 0) <= counter, keep: filters }), filters, {
    emptyText: "O menu aparece quando houver flashcards.",
  });
  $("#flashCrumb").innerHTML = estruturaCrumbHTML("flash", filters, maps);

  const matches = base.filter((card) => estruturaScopeOk(card, filters.subject, filters.topic, state.subjects, state.topics)).sort(flashcardRuleSort);
  $("#flashLibSummary").textContent = all.length ? `${matches.length} de ${all.length} ${all.length === 1 ? "flashcard" : "flashcards"} no filtro atual.` : "Sua biblioteca está vazia.";

  // Botão "Revisar só este grupo": leva a seleção do menu para a sessão de revisão.
  const review = $("#flashReviewScopeBtn");
  if (review) {
    review.classList.toggle("hidden", !filters.subject || filters.subject === "none");
    review.textContent = filters.topic && filters.topic !== "none" ? "Revisar só este assunto" : "Revisar só esta matéria";
  }

  if (!matches.length) {
    library.innerHTML = all.length
      ? `<div class="empty-state">Nenhum flashcard com esses filtros.</div>`
      : `<div class="empty-state"><p>Sua biblioteca de flashcards aparecerá aqui.</p><button class="button primary" data-estrutura="add" data-kind="flash" type="button">Cadastrar o primeiro flashcard</button></div>`;
    return;
  }
  library.innerHTML = estruturaGroupsHTML(matches, filters, state.subjects, state.topics, (card) => renderFlashcardCard(card, counter), "cartão", "cartões");
}

function cycleSetValueIfIdleSafe(selector, value) {
  const input = $(selector);
  if (input && document.activeElement !== input) input.value = value || "";
}

/* ------------------------------------------------------------------ */
/* Janelas de cadastro                                                  */
/* ------------------------------------------------------------------ */

function estruturaModal(kind) {
  return $(ESTRUTURA_MODAIS[kind].modal);
}

function estruturaOpenModal(kind, { returnFocus = document.activeElement } = {}) {
  const config = ESTRUTURA_MODAIS[kind];
  const modal = estruturaModal(kind);
  if (!config || !modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  modalOpen(modal, { returnFocus, initialFocus: $(config.focus) });
}

function estruturaCloseModal(kind) {
  const modal = estruturaModal(kind);
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  modalClose(modal);
  if (!Object.values(ESTRUTURA_MODAIS).some((config) => !$(config.modal)?.classList.contains("hidden"))) document.body.classList.remove("modal-open");
}

function estruturaOpenModalKinds() {
  return Object.keys(ESTRUTURA_MODAIS).filter((kind) => !estruturaModal(kind)?.classList.contains("hidden"));
}

/** Pré-seleciona matéria/assunto com o que está escolhido no menu. */
function estruturaPrefill(subjectSelector, topicSelector, filters) {
  if (!filters.subject || filters.subject === "none") return;
  const subjectSelect = $(subjectSelector);
  if (!subjectSelect || ![...subjectSelect.options].some((option) => option.value === filters.subject)) return;
  subjectSelect.value = filters.subject;
  syncScopedTopicSelect(subjectSelector, topicSelector);
  if (filters.topic && filters.topic !== "none") {
    const topicSelect = $(topicSelector);
    if (topicSelect && [...topicSelect.options].some((option) => option.value === filters.topic)) topicSelect.value = filters.topic;
  }
}

function estruturaAdd(kind, trigger) {
  if (kind === "case") {
    const wasEditing = Boolean(state.ui.activeCaseEditId);
    if (wasEditing) resetCaseForm();
    if (!getDraftInputValue("#caseTitle")) estruturaPrefill("#caseSubject", "#caseTopic", estruturaJurisFilters());
    state.ui.caseFormCourt = normalizeCaseCourtValue(state.ui.caseCourt);
    if (!state.ui.activeCaseEditId) $("#caseCourtSelect").value = state.ui.caseFormCourt;
    updateCaseCourtFormLabel();
    updateCaseFormMode();
  } else if (kind === "material") {
    const wasEditing = Boolean(state.ui.activeLegalMaterialEditId);
    if (wasEditing) resetLegalMaterialForm();
    if (!getDraftInputValue("#legalMaterialTitle")) estruturaPrefill("#legalMaterialSubject", "#legalMaterialTopic", estruturaJurisFilters());
  } else if (kind === "flash") {
    const wasEditing = Boolean(state.ui.activeFlashcardEditId);
    if (wasEditing) resetFlashcardForm();
    const hasDraft = Boolean($("#flashcardFrontEditor")?.textContent.trim() || $("#flashcardBackEditor")?.textContent.trim());
    if (!hasDraft) estruturaPrefill("#flashcardSubject", "#flashcardTopic", estruturaUI.flash);
  }
  estruturaOpenModal(kind, { returnFocus: trigger || document.activeElement });
}

/* ------------------------------------------------------------------ */
/* Eventos                                                              */
/* ------------------------------------------------------------------ */

function estruturaHandleClick(event) {
  const button = event.target.closest("[data-estrutura]");
  if (button) {
    const type = button.dataset.estrutura;
    const area = button.dataset.area;
    if (type === "nav") {
      const subject = button.dataset.subject || "";
      const topic = subject ? button.dataset.topic || "" : "";
      if (subject) estruturaUI.navOpen[area][subject] = true;
      if (area === "juris") {
        estruturaSetJurisSelection(subject, topic);
        saveState();
        renderCases();
      } else {
        estruturaUI.flash.subject = subject;
        estruturaUI.flash.topic = topic;
        estruturaRenderFlashLibrary();
      }
      return;
    }
    if (type === "toggle") {
      const subjectId = button.dataset.subject;
      const filters = area === "juris" ? estruturaJurisFilters() : estruturaUI.flash;
      const wasOpen = estruturaUI.navOpen[area][subjectId] ?? filters.subject === subjectId;
      estruturaUI.navOpen[area][subjectId] = !wasOpen;
      if (area === "juris") renderCases();
      else estruturaRenderFlashLibrary();
      return;
    }
    if (type === "add") {
      estruturaAdd(button.dataset.kind, button);
      return;
    }
    if (type === "close") {
      estruturaCloseModal(button.dataset.kind);
      return;
    }
    if (type === "materialType") {
      estruturaUI.materialType = button.dataset.type || "all";
      renderLegalMaterials();
      return;
    }
    if (type === "clearJuris") {
      state.ui.caseSearch = "";
      state.ui.legalMaterialSearch = "";
      estruturaSetJurisSelection("", "");
      estruturaUI.materialType = "all";
      saveState();
      renderCases();
      return;
    }
    if (type === "clearFlash") {
      estruturaUI.flash = { subject: "", topic: "", search: "", status: "all" };
      estruturaRenderFlashLibrary();
      return;
    }
    if (type === "flashReviewScope") {
      const { subject, topic } = estruturaUI.flash;
      if (!subject || subject === "none") return;
      const byTopic = topic && topic !== "none";
      state.ui.flashcardReviewScope = byTopic ? "topic" : "subject";
      state.ui.flashcardReviewSubjectId = subject;
      state.ui.flashcardReviewTopicId = byTopic ? topic : "";
      state.ui.activeFlashcardId = "";
      state.ui.flashcardAnswerOpen = false;
      saveState();
      renderFlashcards();
      showToast(byTopic ? "Revisão limitada a este assunto." : "Revisão limitada a esta matéria.");
      $("#flashcardReview")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    return;
  }

  const section = event.target.closest("[data-juris-section]");
  if (section) {
    estruturaUI.jurisSection = section.dataset.jurisSection === "material" ? "material" : "cases";
    renderCases();
    return;
  }

  // Clicar no fundo escuro fecha a janela (o que foi digitado fica como rascunho).
  const backdrop = event.target.closest(".estrutura-backdrop");
  if (backdrop && event.target === backdrop) {
    const kind = Object.keys(ESTRUTURA_MODAIS).find((key) => estruturaModal(key) === backdrop);
    if (kind) estruturaCloseModal(kind);
  }
}

function bindEstruturaEvents() {
  document.addEventListener("click", estruturaHandleClick);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = estruturaOpenModalKinds();
    if (!open.length) return;
    // fecha só a janela que está por cima (a última aberta)
    estruturaCloseModal(open[open.length - 1]);
  });

  const flashSearch = $("#flashcardSearch");
  if (flashSearch) {
    flashSearch.addEventListener("input", (event) => {
      estruturaUI.flash.search = event.target.value;
      estruturaRenderFlashLibrary();
    });
  }
  const flashStatus = $("#flashcardLibStatus");
  if (flashStatus) {
    flashStatus.addEventListener("change", (event) => {
      estruturaUI.flash.status = event.target.value;
      estruturaRenderFlashLibrary();
    });
  }
}

if (typeof module !== "undefined") {
  module.exports = { estruturaBuildNav, estruturaScopeOk, estruturaCleanFilters };
}
