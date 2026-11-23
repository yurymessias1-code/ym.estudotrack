/*
 * Relatórios de retenção e constância: mostram se o método está funcionando.
 * Constância (sequência e mapa dos últimos dias), aderência ao plano semanal, retenção das revisões,
 * carga de revisão dos próximos dias e erros por motivo. Funções puras + a renderização na aba Relatórios.
 * Carregado depois do hoje.js (usa weekStartISO e os helpers do ciclo.js).
 */

const REPORT_KEPT_RESULTS = ["ok", "easy"];

function reportMinutesByDate(logs) {
  const map = new Map();
  (logs || []).forEach((log) => {
    if (!cycleIsISO(log?.date)) return;
    const minutes = Number(log.minutes) || 0;
    if (minutes > 0) map.set(log.date, (map.get(log.date) || 0) + minutes);
  });
  return map;
}

/** Sequência de dias com estudo. Hoje ainda sem estudo não quebra a sequência: ela conta até ontem. */
function reportStreak(logs, today, minMinutes = 1) {
  const byDate = reportMinutesByDate(logs);
  const studied = (date) => (byDate.get(date) || 0) >= minMinutes;
  let cursor = studied(today) ? today : cycleAddDays(today, -1);
  let current = 0;
  while (studied(cursor) && current < 5000) {
    current += 1;
    cursor = cycleAddDays(cursor, -1);
  }
  const dates = [...byDate.keys()].filter(studied).sort();
  let best = 0;
  let run = 0;
  let previous = "";
  dates.forEach((date) => {
    run = previous && cycleAddDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  });
  const since = cycleAddDays(today, -29);
  const last30 = dates.filter((date) => date >= since && date <= today).length;
  const totalMinutes = dates.reduce((sum, date) => sum + byDate.get(date), 0);
  return {
    current,
    best: Math.max(best, current),
    studiedToday: studied(today),
    daysStudied: dates.length,
    last30,
    avgMinutes: dates.length ? Math.round(totalMinutes / dates.length) : 0,
  };
}

function reportHeatLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

/** Semanas (segunda a domingo) terminando na semana atual; cada dia com minutos e nível de 0 a 4. */
function reportHeatmap(logs, today, weeks = 12) {
  const byDate = reportMinutesByDate(logs);
  const start = cycleAddDays(weekStartISO(today), -(weeks - 1) * 7);
  const out = [];
  let activeDays = 0;
  let totalMinutes = 0;
  for (let week = 0; week < weeks; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) {
      const date = cycleAddDays(start, week * 7 + day);
      const future = date > today;
      const minutes = future ? 0 : byDate.get(date) || 0;
      if (minutes > 0) {
        activeDays += 1;
        totalMinutes += minutes;
      }
      days.push({ date, minutes, level: reportHeatLevel(minutes), future });
    }
    out.push(days);
  }
  return { weeks: out, activeDays, totalMinutes };
}

/** Estudado x meta semanal, da semana mais antiga para a atual. */
function reportAdherence(logs, weeklyMinutes, today, weeks = 8) {
  const byDate = reportMinutesByDate(logs);
  const currentStart = weekStartISO(today);
  const out = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = cycleAddDays(currentStart, -index * 7);
    let done = 0;
    for (let day = 0; day < 7; day += 1) done += byDate.get(cycleAddDays(weekStart, day)) || 0;
    out.push({ weekStart, done, target: weeklyMinutes, pct: weeklyMinutes ? (done / weeklyMinutes) * 100 : 0, current: index === 0 });
  }
  return out;
}

/** Retenção = revisões avaliadas "Bom" ou "Fácil" entre todas as avaliadas, geral, por semana e por matéria. */
function reportRetention(revisions, subjectNames, today, { days = 60, weeks = 8 } = {}) {
  const entries = [];
  (revisions || []).forEach((revision) => {
    (revision.history || []).forEach((entry) => {
      if (cycleIsISO(entry?.date)) entries.push({ date: entry.date, kept: REPORT_KEPT_RESULTS.includes(entry.result), forgot: entry.result === "forgot", subjectId: revision.subjectId || "" });
    });
  });
  const since = cycleAddDays(today, -(days - 1));
  const windowEntries = entries.filter((entry) => entry.date >= since && entry.date <= today);
  const kept = windowEntries.filter((entry) => entry.kept).length;
  const bySubject = new Map();
  windowEntries.forEach((entry) => {
    const item = bySubject.get(entry.subjectId) || { subjectId: entry.subjectId, name: subjectNames[entry.subjectId] || "Sem matéria", reviews: 0, kept: 0 };
    item.reviews += 1;
    if (entry.kept) item.kept += 1;
    bySubject.set(entry.subjectId, item);
  });
  const weekly = [];
  const currentStart = weekStartISO(today);
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = cycleAddDays(currentStart, -index * 7);
    const weekEnd = cycleAddDays(weekStart, 6);
    const inWeek = entries.filter((entry) => entry.date >= weekStart && entry.date <= weekEnd);
    const keptInWeek = inWeek.filter((entry) => entry.kept).length;
    weekly.push({ weekStart, reviews: inWeek.length, kept: keptInWeek, pct: inWeek.length ? (keptInWeek / inWeek.length) * 100 : null });
  }
  return {
    reviews: windowEntries.length,
    kept,
    forgot: windowEntries.filter((entry) => entry.forgot).length,
    pct: windowEntries.length ? (kept / windowEntries.length) * 100 : null,
    weekly,
    bySubject: [...bySubject.values()]
      .map((item) => ({ ...item, pct: (item.kept / item.reviews) * 100 }))
      .sort((a, b) => a.pct - b.pct || b.reviews - a.reviews),
  };
}

/** O que vence em cada um dos próximos dias; o que já está atrasado entra em hoje. */
function reportLoad(revisions, errors, today, days = 14) {
  const pending = (revisions || []).filter((revision) => revision.status === "pending");
  const open = (errors || []).filter((entry) => !entry.mastered && entry.dueDate);
  const out = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = cycleAddDays(today, offset);
    const match = (due) => (offset === 0 ? due <= date : due === date);
    out.push({ date, rev: pending.filter((revision) => match(revision.dueDate)).length, err: open.filter((entry) => match(entry.dueDate)).length });
  }
  return out;
}

/** Erros dos últimos `days` dias: por motivo, quantos já foram dominados e quantos por semana. */
function reportErrors(errors, today, { days = 90, weeks = 8 } = {}) {
  const since = cycleAddDays(today, -(days - 1));
  const recent = (errors || []).filter((entry) => cycleIsISO(entry?.date) && entry.date >= since && entry.date <= today);
  const counts = {};
  recent.forEach((entry) => {
    counts[entry.reason] = (counts[entry.reason] || 0) + 1;
  });
  const byReason = Object.entries(counts)
    .map(([reason, count]) => ({ reason, count, pct: (count / recent.length) * 100 }))
    .sort((a, b) => b.count - a.count);
  const weekly = [];
  const currentStart = weekStartISO(today);
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = cycleAddDays(currentStart, -index * 7);
    const weekEnd = cycleAddDays(weekStart, 6);
    weekly.push({ weekStart, count: recent.filter((entry) => entry.date >= weekStart && entry.date <= weekEnd).length });
  }
  const mastered = recent.filter((entry) => entry.mastered).length;
  return { total: recent.length, mastered, masteredPct: recent.length ? (mastered / recent.length) * 100 : null, byReason, weekly };
}

/* ------------------------------------------------------------------ */
/* Renderização                                                        */
/* ------------------------------------------------------------------ */

function reportShortDate(iso) {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function reportTone(pct) {
  return pct >= 100 ? "var(--green)" : pct >= 70 ? "var(--teal)" : "var(--amber)";
}

function renderCycleReports() {
  const container = $("#reportCycle");
  if (!container) return;
  const today = cycleToday();
  const subjectNames = Object.fromEntries(state.subjects.map((subject) => [subject.id, subject.name]));
  const streak = reportStreak(state.studyLogs, today);
  const heat = reportHeatmap(state.studyLogs, today, 12);
  const weeklyMinutes = Math.round((Number(state.edital?.weeklyHours) || 15) * 60);
  const adherence = reportAdherence(state.studyLogs, weeklyMinutes, today, 8);
  const retention = reportRetention(state.revisions, subjectNames, today);
  const load = reportLoad(state.revisions, state.errorNotebook, today, 14);
  const errors = reportErrors(state.errorNotebook, today);

  const weekdayLabels = ["Seg", "", "Qua", "", "Sex", "", "Dom"];
  const heatCells = [];
  for (let row = 0; row < 7; row += 1) {
    heatCells.push(`<span class="heat-label" aria-hidden="true">${weekdayLabels[row]}</span>`);
    heat.weeks.forEach((week) => {
      const cell = week[row];
      const text = cell.future ? `${reportShortDate(cell.date)}: ainda não chegou` : `${reportShortDate(cell.date)}: ${cell.minutes ? formatMinutes(cell.minutes) : "sem estudo"}`;
      heatCells.push(`<span class="heat heat-${cell.level} ${cell.future ? "future" : ""}" title="${text}"></span>`);
    });
  }

  const adherenceRows = adherence
    .map((week) => {
      const width = Math.min(100, week.pct);
      return `<div class="performance-row">
        <div class="performance-top"><strong>Semana de ${reportShortDate(week.weekStart)}${week.current ? " (atual)" : ""}</strong><span>${formatMinutes(week.done)} de ${formatMinutes(week.target)} · ${percent(week.pct)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="--progress:${width}%; --fill:${reportTone(week.pct)}"></div></div>
      </div>`;
    })
    .join("");
  const adherenceFull = adherence.filter((week) => !week.current);
  const adherenceAvg = adherenceFull.length ? adherenceFull.reduce((sum, week) => sum + Math.min(week.pct, 100), 0) / adherenceFull.length : null;

  const retentionWeekly = retention.weekly
    .map((week) => `<div class="mini-bar" title="Semana de ${reportShortDate(week.weekStart)}: ${week.reviews ? `${percent(week.pct)} de ${week.reviews} revisões` : "sem revisões"}">
      <span class="mini-bar-fill" style="--h:${week.pct === null ? 0 : week.pct}%"></span><small>${week.pct === null ? "–" : Math.round(week.pct)}</small></div>`)
    .join("");
  const retentionRows = retention.bySubject.length
    ? `<div class="table-wrap"><table><thead><tr><th>Matéria</th><th>Revisões</th><th>Retenção</th></tr></thead><tbody>${retention.bySubject
        .map((item) => `<tr class="${item.pct < 70 ? "weak-row" : ""}"><td>${escapeHTML(item.name)}</td><td>${item.reviews}</td><td>${percent(item.pct)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : `<div class="empty-state">As matérias aparecem aqui quando você fizer revisões.</div>`;

  const maxLoad = Math.max(1, ...load.map((day) => day.rev + day.err));
  const totalLoad = load.reduce((sum, day) => sum + day.rev + day.err, 0);
  const loadBars = load
    .map((day) => {
      const total = day.rev + day.err;
      const weekday = cycleDate(day.date).toLocaleDateString("pt-BR", { weekday: "narrow" }).toUpperCase();
      return `<div class="load-bar" title="${reportShortDate(day.date)}: ${cyclePlural(day.rev, "revisão", "revisões")} e ${cyclePlural(day.err, "erro", "erros")}${day.date === today ? " (inclui atrasadas)" : ""}">
        <span class="load-fill" style="--h:${(total / maxLoad) * 100}%"></span><b>${total || ""}</b><small>${weekday}<br />${day.date.slice(8)}</small></div>`;
    })
    .join("");

  const maxReason = Math.max(1, ...errors.byReason.map((item) => item.count));
  const reasonRows = errors.byReason.length
    ? errors.byReason
        .map((item) => `<div class="performance-row">
          <div class="performance-top"><strong>${escapeHTML(ERROR_REASONS[item.reason] || item.reason)}</strong><span>${item.count} · ${percent(item.pct)}</span></div>
          <div class="progress-track"><div class="progress-fill" style="--progress:${(item.count / maxReason) * 100}%; --fill:var(--coral)"></div></div></div>`)
        .join("")
    : `<div class="empty-state">Sem erros nos últimos 90 dias.</div>`;
  const maxWeekErr = Math.max(1, ...errors.weekly.map((week) => week.count));
  const errorWeekly = errors.weekly
    .map((week) => `<div class="mini-bar" title="Semana de ${reportShortDate(week.weekStart)}: ${cyclePlural(week.count, "erro", "erros")}"><span class="mini-bar-fill coral" style="--h:${(week.count / maxWeekErr) * 100}%"></span><small>${week.count}</small></div>`)
    .join("");

  container.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">O método está funcionando?</p>
        <h3>Constância, retenção e carga de revisão</h3>
      </div>
    </div>

    <h4 class="report-subtitle">Constância</h4>
    <div class="stat-grid">
      ${cycleStat("Sequência atual", cyclePlural(streak.current, "dia", "dias"), streak.studiedToday ? "contando com hoje" : streak.current ? "estude hoje para mantê-la" : "estude hoje para começar")}
      ${cycleStat("Melhor sequência", cyclePlural(streak.best, "dia", "dias"), `${cyclePlural(streak.daysStudied, "dia estudado", "dias estudados")} no total`)}
      ${cycleStat("Dias estudados (30 dias)", `${streak.last30} de 30`, `${percent((streak.last30 / 30) * 100)} dos dias`)}
      ${cycleStat("Média por dia estudado", streak.avgMinutes ? formatMinutes(streak.avgMinutes) : "–", "em todo o histórico")}
    </div>
    <div class="heatmap-wrap">
      <div class="heatmap" role="img" aria-label="Mapa de estudo das últimas 12 semanas: ${cyclePlural(heat.activeDays, "dia estudado", "dias estudados")}, ${formatMinutes(heat.totalMinutes)} no total">${heatCells.join("")}</div>
      <div class="heat-legend" aria-hidden="true">Menos <span class="heat heat-0"></span><span class="heat heat-1"></span><span class="heat heat-2"></span><span class="heat heat-3"></span><span class="heat heat-4"></span> Mais <small>(até 30 min, 60, 120 e mais)</small></div>
    </div>

    <h4 class="report-subtitle">Aderência ao plano semanal <small>meta atual: ${formatMinutes(weeklyMinutes)} por semana${adherenceAvg === null ? "" : ` · média das semanas fechadas: ${percent(adherenceAvg)}`}</small></h4>
    <div class="insight-list">${adherenceRows}</div>

    <h4 class="report-subtitle">Retenção das revisões <small>últimos 60 dias</small></h4>
    <div class="stat-grid">
      ${cycleStat("Retenção", retention.pct === null ? "–" : percent(retention.pct), retention.reviews ? "revisões avaliadas Bom ou Fácil" : "faça revisões para medir")}
      ${cycleStat("Revisões feitas", String(retention.reviews), `${retention.forgot} marcadas como Esqueci`)}
    </div>
    <div class="mini-bars" aria-label="Retenção por semana, em porcentagem">${retentionWeekly}</div>
    ${retentionRows}

    <h4 class="report-subtitle">Carga de revisão <small>próximos 14 dias: ${cyclePlural(totalLoad, "item", "itens")} (revisões e erros para refazer)</small></h4>
    <div class="load-chart" role="img" aria-label="Carga de revisão dos próximos 14 dias">${loadBars}</div>

    <h4 class="report-subtitle">Erros por motivo <small>últimos 90 dias · ${errors.total ? `${errors.mastered} de ${errors.total} dominados (${percent(errors.masteredPct)})` : "sem erros"}</small></h4>
    <div class="insight-list">${reasonRows}</div>
    <div class="mini-bars" aria-label="Erros registrados por semana">${errorWeekly}</div>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { reportStreak, reportHeatmap, reportHeatLevel, reportAdherence, reportRetention, reportLoad, reportErrors };
}
