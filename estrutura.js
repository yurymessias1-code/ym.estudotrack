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
  organize: { modal: "#organizeModal", focus: "#organizeSuggestBtn" },
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

function estruturaNorm(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Sugere matéria/assunto procurando o NOME de assuntos e matérias cadastrados no texto do item
 * (título, tema, hashtags, ementa). Só sugere quando o nome aparece como palavra inteira.
 * Retorna { subjectId, topicId, reason } ou null.
 */
function estruturaSuggest(text, subjects, topics, currentSubjectId = "") {
  const haystack = ` ${estruturaNorm(text)} `;
  const found = (name) => {
    const norm = estruturaNorm(name);
    return norm.length >= 4 && haystack.includes(` ${norm} `) ? norm.length : 0;
  };
  let best = null;
  (topics || []).forEach((topic) => {
    if (currentSubjectId && topic.subjectId !== currentSubjectId) return; // quem já tem matéria só recebe assunto dela
    const score = found(topic.name);
    if (!score) return;
    const total = score + (topic.subjectId === currentSubjectId ? 100 : 0);
    if (!best || total > best.score) best = { score: total, subjectId: topic.subjectId, topicId: topic.id, reason: `assunto "${topic.name}" aparece no texto` };
  });
  if (best) return { subjectId: best.subjectId, topicId: best.topicId, reason: best.reason };
  if (currentSubjectId) return null;
  (subjects || []).forEach((subject) => {
    // "Direito Constitucional" também casa com "constitucional"
    const score = Math.max(found(subject.name), found(String(subject.name || "").replace(/^direito\s+/i, "")));
    if (!score) return;
    if (!best || score > best.score) best = { score, subjectId: subject.id, topicId: "", reason: `matéria "${subject.name}" aparece no texto` };
  });
  return best ? { subjectId: best.subjectId, topicId: "", reason: best.reason } : null;
}

/** Itens que ainda precisam de vínculo: sem matéria, ou com matéria que tem assuntos mas sem assunto. Sem matéria primeiro. */
function estruturaOrganizeCandidates(items, subjects, topics) {
  const maps = erroMaps(subjects, topics);
  const rank = (item) => {
    const scope = erroEntryScope(item, maps);
    if (!scope.subjectId) return 0;
    if (!scope.topicId && (topics || []).some((topic) => topic.subjectId === scope.subjectId)) return 1;
    return -1;
  };
  return items.filter((item) => rank(item) >= 0).sort((a, b) => rank(a) - rank(b));
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

  // Contagem por tribunal e destaque do tribunal escolhido
  const scope = state.ui.caseSearchScope === "all" ? "all" : "current";
  const courtCounts = { STJ: (state.cases.STJ || []).length, STF: (state.cases.STF || []).length };
  const countLabels = { ALL: courtCounts.STJ + courtCounts.STF, STJ: courtCounts.STJ, STF: courtCounts.STF };
  $$("[data-court-count]").forEach((node) => (node.textContent = String(countLabels[node.dataset.courtCount] ?? 0)));
  $("[data-estrutura='courtAll']")?.classList.toggle("active", scope === "all");

  // Aviso de itens sem vínculo (os julgados antigos costumam ficar assim)
  const pool = section === "cases" ? [...(state.cases.STJ || []), ...(state.cases.STF || [])] : state.legalMaterials || [];
  const pending = estruturaOrganizeCandidates(pool, state.subjects, state.topics);
  const noSubject = pending.filter((item) => !erroEntryScope(item, maps).subjectId).length;
  const bar = $("#jurisOrganizeBar");
  if (bar) {
    const noun = section === "cases" ? ["julgado", "julgados"] : ["material", "materiais"];
    bar.innerHTML = pending.length
      ? `<div class="organize-bar"><span>${noSubject ? `<strong>${noSubject}</strong> ${noSubject === 1 ? noun[0] : noun[1]} sem matéria` : `<strong>${pending.length}</strong> ${pending.length === 1 ? noun[0] : noun[1]} sem assunto`}${noSubject && pending.length > noSubject ? ` e mais ${pending.length - noSubject} sem assunto` : ""}.</span><button class="button secondary" data-estrutura="organize" type="button">Organizar por matéria e assunto</button></div>`
      : "";
  }
  const active = Boolean(state.ui.caseSearch || state.ui.legalMaterialSearch || filters.subject || estruturaUI.materialType !== "all");
  $$('[data-estrutura="clearJuris"]').forEach((button) => {
    button.classList.toggle("primary", active);
    button.classList.toggle("ghost", !active);
  });

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
/* Organizar: vincular julgados/materiais antigos a matéria e assunto   */
/* ------------------------------------------------------------------ */

function estruturaItemText(item, kind) {
  if (kind === "material") {
    return [item.title, item.reference, legalMaterialTypeLabel(item.type), item.type === "image" ? "" : richTextToPlain(item.content), item.source].join(" ");
  }
  return [item.title, item.theme, normalizeHashtags(item.tags).join(" "), richTextToPlain(item.summary), item.source].join(" ");
}

function estruturaTopicOptions(subjectId, selected) {
  const list = state.topics.filter((topic) => topic.subjectId === subjectId);
  return `<option value="">— sem assunto —</option>${list.map((topic) => `<option value="${topic.id}" ${topic.id === selected ? "selected" : ""}>${escapeHTML(topic.name)}</option>`).join("")}`;
}

function estruturaOrganizeRowHTML(item, kind, court, suggestOnlyEmpty = true) {
  const scope = erroEntryScope(item, erroMaps(state.subjects, state.topics));
  const text = estruturaItemText(item, kind);
  const suggestion = estruturaSuggest(text, state.subjects, state.topics, scope.subjectId);
  const useSuggestion = suggestion && (!scope.topicId || !suggestOnlyEmpty) && (suggestion.subjectId === scope.subjectId || !scope.subjectId);
  const subjectId = useSuggestion ? suggestion.subjectId : scope.subjectId;
  const topicId = useSuggestion ? suggestion.topicId : scope.topicId;
  const excerpt = richTextToPlain(kind === "material" ? item.content || "" : item.summary || "").slice(0, 110);
  const title = item.title || "Sem título";
  return `
    <div class="organize-row ${useSuggestion ? "is-suggested" : ""}" data-id="${item.id}" data-kind="${kind}" data-orig-subject="${scope.subjectId}" data-orig-topic="${scope.topicId}">
      <div class="organize-info">
        <strong>${escapeHTML(title)}</strong>
        ${court ? `<span class="tag">${escapeHTML(court)}</span>` : kind === "material" ? `<span class="tag">${escapeHTML(legalMaterialTypeLabel(item.type))}</span>` : ""}
        ${excerpt ? `<small class="muted-note">${escapeHTML(excerpt)}</small>` : ""}
        <small class="organize-hint">${useSuggestion ? `Sugestão: ${escapeHTML(suggestion.reason)}.` : ""}</small>
      </div>
      <select class="organize-subject" aria-label="Matéria de ${escapeHTML(title)}">
        <option value="">— sem matéria —</option>
        ${state.subjects.map((subject) => `<option value="${subject.id}" ${subject.id === subjectId ? "selected" : ""}>${escapeHTML(subject.name)}</option>`).join("")}
      </select>
      <select class="organize-topic" aria-label="Assunto de ${escapeHTML(title)}">${estruturaTopicOptions(subjectId, topicId)}</select>
    </div>`;
}

function estruturaOpenOrganize(trigger) {
  const kind = estruturaUI.jurisSection === "material" ? "material" : "case";
  const pool =
    kind === "case"
      ? ["STJ", "STF"].flatMap((court) => (state.cases[court] || []).map((item) => ({ item, court })))
      : (state.legalMaterials || []).map((item) => ({ item, court: "" }));
  const courtOf = new Map(pool.map(({ item, court }) => [item, court]));
  const candidates = estruturaOrganizeCandidates(pool.map(({ item }) => item), state.subjects, state.topics);
  if (!state.subjects.length) {
    showToast("Cadastre as matérias em Matérias antes de organizar.");
    return;
  }
  if (!candidates.length) {
    showToast("Tudo já está vinculado a matéria e assunto.");
    return;
  }
  $("#organizeTitle").textContent = kind === "case" ? "Vincular julgados a matérias e assuntos" : "Vincular materiais a matérias e assuntos";
  $("#organizeHint").textContent = `${candidates.length} ${candidates.length === 1 ? "item" : "itens"} para organizar. As sugestões vêm do texto (título, tema, hashtags e ementa); confira e ajuste antes de aplicar.`;
  $("#organizeList").innerHTML = candidates.map((item) => estruturaOrganizeRowHTML(item, kind, courtOf.get(item))).join("");
  estruturaOpenModal("organize", { returnFocus: trigger });
}

function estruturaOrganizeChanged(event) {
  const row = event.target.closest(".organize-row");
  if (!row) return;
  if (event.target.classList.contains("organize-subject")) {
    row.querySelector(".organize-topic").innerHTML = estruturaTopicOptions(event.target.value, "");
  }
  row.classList.remove("is-suggested");
  const hint = row.querySelector(".organize-hint");
  if (hint) hint.textContent = "";
}

function estruturaOrganizeApply() {
  const all = { case: [...(state.cases.STJ || []), ...(state.cases.STF || [])], material: state.legalMaterials || [] };
  let changed = 0;
  $$("#organizeList .organize-row").forEach((row) => {
    const subjectId = row.querySelector(".organize-subject").value;
    const topicId = row.querySelector(".organize-topic").value;
    if (subjectId === row.dataset.origSubject && topicId === row.dataset.origTopic) return;
    const item = all[row.dataset.kind].find((entry) => entry.id === row.dataset.id);
    if (!item) return;
    item.subjectId = subjectId;
    item.topicId = topicId;
    if (row.dataset.kind === "material") item.updatedAt = new Date().toISOString();
    changed += 1;
  });
  estruturaCloseModal("organize");
  if (!changed) {
    showToast("Nenhum vínculo foi alterado.");
    return;
  }
  saveState();
  render();
  showToast(`${changed} ${changed === 1 ? "item vinculado" : "itens vinculados"} a matéria e assunto.`);
}

function estruturaOrganizeSuggestAll() {
  const rows = $$("#organizeList .organize-row");
  let filled = 0;
  rows.forEach((row) => {
    const kind = row.dataset.kind;
    const pool = kind === "case" ? [...(state.cases.STJ || []), ...(state.cases.STF || [])] : state.legalMaterials || [];
    const item = pool.find((entry) => entry.id === row.dataset.id);
    if (!item) return;
    const scope = erroEntryScope(item, erroMaps(state.subjects, state.topics));
    const suggestion = estruturaSuggest(estruturaItemText(item, kind), state.subjects, state.topics, scope.subjectId);
    if (!suggestion || (scope.subjectId && suggestion.subjectId !== scope.subjectId)) return;
    row.querySelector(".organize-subject").value = suggestion.subjectId;
    row.querySelector(".organize-topic").innerHTML = estruturaTopicOptions(suggestion.subjectId, suggestion.topicId);
    row.classList.add("is-suggested");
    row.querySelector(".organize-hint").textContent = `Sugestão: ${suggestion.reason}.`;
    filled += 1;
  });
  showToast(filled ? `${filled} sugestões preenchidas. Confira antes de aplicar.` : "Não achei matéria ou assunto citados nos textos.");
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
    if (type === "courtAll") {
      state.ui.caseSearchScope = "all";
      saveState();
      renderCases();
      return;
    }
    if (type === "organize") {
      estruturaOpenOrganize(button);
      return;
    }
    if (type === "organizeSuggest") {
      estruturaOrganizeSuggestAll();
      return;
    }
    if (type === "organizeApply") {
      estruturaOrganizeApply();
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
  document.addEventListener("change", estruturaOrganizeChanged);

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
  module.exports = { estruturaBuildNav, estruturaScopeOk, estruturaCleanFilters, estruturaSuggest, estruturaOrganizeCandidates };
}
