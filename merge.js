/*
 * Mesclagem de estados entre aparelhos (lógica pura, sem DOM).
 * Quando dois aparelhos alteram a mesma conta, em vez de "quem salva por último vence" o app une as
 * coleções por identificador: registros novos de qualquer lado se somam, o mesmo registro editado dos
 * dois lados fica com a versão mais avançada, e exclusões são lembradas (lápides) para o item apagado
 * em um aparelho não reaparecer por causa de outro. Carregado antes do app.js.
 */

const MERGE_PATHS = [
  ["subjects"],
  ["topics"],
  ["questionLogs"],
  ["studyLogs"],
  ["flashcards"],
  ["sources"],
  ["notes"],
  ["categories"],
  ["goals"],
  ["competitions"],
  ["legalMaterials"],
  ["revisions"],
  ["errorNotebook"],
  ["lawPlans"],
  ["pendingSessions"],
  ["cases", "STJ"],
  ["cases", "STF"],
  ["edital", "items"],
];
const MERGE_TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;

function mergeClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergePathKey(path) {
  return path.join(".");
}

function mergeGetList(state, path) {
  let value = state;
  for (const part of path) value = value?.[part];
  return Array.isArray(value) ? value : [];
}

function mergeSetList(state, path, list) {
  let target = state;
  for (let index = 0; index < path.length - 1; index += 1) {
    if (!target[path[index]] || typeof target[path[index]] !== "object") target[path[index]] = {};
    target = target[path[index]];
  }
  target[path[path.length - 1]] = list;
}

function mergeItemId(item) {
  return item && typeof item === "object" && typeof item.id === "string" && item.id ? item.id : "";
}

function mergeItemKey(item) {
  const id = mergeItemId(item);
  return id ? `id:${id}` : `json:${JSON.stringify(item)}`;
}

function mergeItemTime(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.updatedAt || item.createdAt || "");
}

/* ---------- lápides (exclusões lembradas) ---------- */

/** { coleção: { id: "ISO" } } sem entradas inválidas ou mais velhas que 90 dias. */
function normalizeTombstones(raw, nowMs = Date.now()) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([key, ids]) => {
    if (!ids || typeof ids !== "object") return;
    Object.entries(ids).forEach(([id, time]) => {
      const ms = Date.parse(time);
      if (!id || !Number.isFinite(ms) || nowMs - ms > MERGE_TOMBSTONE_MS) return;
      (out[key] = out[key] || {})[id] = String(time);
    });
  });
  return out;
}

function mergeUnionTimes(a, b) {
  const out = {};
  [a, b].forEach((map) => {
    Object.entries(map || {}).forEach(([key, ids]) => {
      Object.entries(ids || {}).forEach(([id, time]) => {
        const bucket = (out[key] = out[key] || {});
        if (!bucket[id] || String(time) > bucket[id]) bucket[id] = String(time);
      });
    });
  });
  return out;
}

/** Um item excluído só volta se foi recriado/editado depois da exclusão ou revivido de propósito. */
function mergeIsAlive(item, key, id, tombstones, revivals) {
  const deletedAt = tombstones[key]?.[id];
  if (!deletedAt) return true;
  const revivedAt = revivals[key]?.[id];
  if (revivedAt && revivedAt > deletedAt) return true;
  const time = mergeItemTime(item);
  return Boolean(time && time > deletedAt);
}

function mergeCollectIds(state) {
  const out = {};
  MERGE_PATHS.forEach((path) => {
    const ids = new Set();
    mergeGetList(state, path).forEach((item) => {
      const id = mergeItemId(item);
      if (id) ids.add(id);
    });
    out[mergePathKey(path)] = ids;
  });
  return out;
}

/** Guarda, sem entrar no JSON, os ids que o estado tinha ao ser criado/carregado. */
function mergeAttachIds(state) {
  Object.defineProperty(state, "__ids", { value: mergeCollectIds(state), enumerable: false, writable: true, configurable: true });
  return state;
}

/**
 * Prepara uma restauração de verdade (voltar a uma versão anterior da conta): o que existe agora e não existe
 * na versão restaurada vira exclusão lembrada, e o que a versão tem e já tinha sido excluído volta como "revivido".
 * Sem isso, a junção com os outros aparelhos traria de volta tudo o que a restauração tirou.
 * Mantém as lápides e revividos atuais e entrega os ids de antes para o próximo salvamento registrar a diferença
 * (via mergeRecordDeletions, chamado pelo saveState).
 */
function mergeCarryForwardForRestore(restored, previous) {
  const tombstones = mergeUnionTimes(normalizeTombstones(previous?.meta?.tombstones), normalizeTombstones(restored.meta?.tombstones));
  const revivals = mergeUnionTimes(normalizeTombstones(previous?.meta?.revivals), normalizeTombstones(restored.meta?.revivals));
  restored.meta = { ...(restored.meta || {}), tombstones, revivals };
  Object.defineProperty(restored, "__ids", { value: mergeCollectIds(previous || {}), enumerable: false, writable: true, configurable: true });
  return restored;
}

/**
 * Compara com os ids anteriores: o que sumiu vira lápide e o que voltou depois de excluído vira "revivido".
 * Atualiza state.meta e devolve os ids atuais (a nova referência).
 */
function mergeRecordDeletions(state, previousIds, nowIso) {
  const current = mergeCollectIds(state);
  state.meta = state.meta && typeof state.meta === "object" ? state.meta : {};
  const tombstones = normalizeTombstones(state.meta.tombstones);
  const revivals = normalizeTombstones(state.meta.revivals);
  Object.keys(current).forEach((key) => {
    const before = previousIds?.[key];
    if (before) {
      before.forEach((id) => {
        if (!current[key].has(id)) (tombstones[key] = tombstones[key] || {})[id] = nowIso;
      });
    }
    current[key].forEach((id) => {
      const deletedAt = tombstones[key]?.[id];
      if (deletedAt && !(revivals[key]?.[id] > deletedAt)) (revivals[key] = revivals[key] || {})[id] = nowIso;
    });
  });
  state.meta.tombstones = tombstones;
  state.meta.revivals = revivals;
  return current;
}

/* ---------- escolha entre duas versões do mesmo registro ---------- */

function mergeScore(path, item) {
  if (path === "revisions") return (item.history?.length || 0) * 10 + (item.status === "done" ? 5 : 0);
  if (path === "errorNotebook") return (Number(item.attempts) || 0) * 10 + (item.mastered ? 5 : 0);
  if (path === "flashcards") return Number(item.reviews) || 0;
  return 0;
}

function mergeLawPlans(local, remote) {
  const base = mergeItemTime(remote) > mergeItemTime(local) ? remote : local;
  const log = new Map();
  [...(local.readLog || []), ...(remote.readLog || [])].forEach((entry) => {
    if (entry && entry.id && !log.has(entry.id)) log.set(entry.id, entry);
  });
  return {
    ...base,
    doneWork: Math.max(Number(local.doneWork) || 0, Number(remote.doneWork) || 0),
    readLog: [...log.values()].sort((a, b) => (a.fromWork || 0) - (b.fromWork || 0)),
  };
}

/** Devolve { item, from } com a versão que deve valer. Empate: a local. */
function mergePick(path, local, remote) {
  if (path === "lawPlans") return { item: mergeLawPlans(local, remote), from: "merged" };
  const scoreLocal = mergeScore(path, local);
  const scoreRemote = mergeScore(path, remote);
  if (scoreLocal !== scoreRemote) return scoreRemote > scoreLocal ? { item: remote, from: "remote" } : { item: local, from: "local" };
  const timeLocal = mergeItemTime(local);
  const timeRemote = mergeItemTime(remote);
  if (timeRemote > timeLocal) return { item: remote, from: "remote" };
  if (path === "flashcards" && String(remote.lastReviewed || "") > String(local.lastReviewed || "")) return { item: remote, from: "remote" };
  return { item: local, from: "local" };
}

function mergeList(path, local, remote, tombstones, revivals, stats) {
  const key = mergePathKey(path);
  const remoteByKey = new Map(remote.map((item) => [mergeItemKey(item), item]));
  const seen = new Set();
  const out = [];
  local.forEach((item) => {
    const itemKey = mergeItemKey(item);
    seen.add(itemKey);
    const other = remoteByKey.get(itemKey);
    let chosen = item;
    if (other && item && typeof item === "object" && typeof other === "object") {
      const picked = mergePick(key, item, other);
      chosen = picked.item;
      if (picked.from === "remote") stats.updated += 1;
    }
    const id = mergeItemId(chosen);
    if (id && !mergeIsAlive(chosen, key, id, tombstones, revivals)) {
      stats.removed += 1;
      return;
    }
    out.push(chosen);
  });
  remote.forEach((item) => {
    if (seen.has(mergeItemKey(item))) return;
    const id = mergeItemId(item);
    if (id && !mergeIsAlive(item, key, id, tombstones, revivals)) return;
    out.push(item);
    stats.added += 1;
  });
  return out;
}

function mergeObjects(local, remote, preferRemote) {
  return preferRemote ? { ...(local || {}), ...(remote || {}) } : { ...(remote || {}), ...(local || {}) };
}

/**
 * Une o estado local e o remoto. `preferRemoteScalars`: em quem vence nos campos que não são listas
 * (configurações etc.): verdadeiro quando este aparelho só está atualizando (sem edição pendente);
 * falso quando ele está salvando e suas mudanças devem prevalecer.
 */
function mergeStatesDetailed(local, remote, { preferRemoteScalars = false } = {}) {
  const stats = { added: 0, removed: 0, updated: 0 };
  const tombstones = mergeUnionTimes(normalizeTombstones(local.meta?.tombstones), normalizeTombstones(remote.meta?.tombstones));
  const revivals = mergeUnionTimes(normalizeTombstones(local.meta?.revivals), normalizeTombstones(remote.meta?.revivals));
  const out = mergeClone(local);

  const merged = {};
  MERGE_PATHS.forEach((path) => {
    merged[mergePathKey(path)] = mergeClone(mergeList(path, mergeGetList(local, path), mergeGetList(remote, path), tombstones, revivals, stats));
  });

  out.version = Math.max(Number(local.version) || 0, Number(remote.version) || 0) || 2;
  out.settings = mergeObjects(local.settings, remote.settings, preferRemoteScalars);
  out.media = mergeObjects(local.media, remote.media, preferRemoteScalars);
  out.flashcardSettings = {
    ...mergeObjects(local.flashcardSettings, remote.flashcardSettings, preferRemoteScalars),
    reviewCounter: Math.max(Number(local.flashcardSettings?.reviewCounter) || 0, Number(remote.flashcardSettings?.reviewCounter) || 0),
  };
  out.cycleSettings = {
    ...mergeObjects(local.cycleSettings, remote.cycleSettings, preferRemoteScalars),
    weights: mergeObjects(local.cycleSettings?.weights, remote.cycleSettings?.weights, preferRemoteScalars),
  };
  const sinceLocal = local.cycleSettings?.autoSince;
  const sinceRemote = remote.cycleSettings?.autoSince;
  if (sinceLocal && sinceRemote) out.cycleSettings.autoSince = sinceLocal < sinceRemote ? sinceLocal : sinceRemote;
  out.edital = mergeObjects(local.edital, remote.edital, preferRemoteScalars);

  MERGE_PATHS.forEach((path) => mergeSetList(out, path, merged[mergePathKey(path)]));
  const savedLocal = String(local.meta?.localSavedAt || "");
  const savedRemote = String(remote.meta?.localSavedAt || "");
  out.meta = { localSavedAt: savedLocal > savedRemote ? savedLocal : savedRemote, tombstones, revivals };
  return { state: out, stats };
}

function mergeStates(local, remote, options) {
  return mergeStatesDetailed(local, remote, options).state;
}

/** JSON com as chaves em ordem alfabética, para comparar conteúdo sem depender da ordem de montagem. */
function mergeStableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(mergeStableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${mergeStableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Identidade do conteúdo: ignora o que é só deste aparelho (tela, perfil, hora de salvar) e a ordem
 * das listas e das chaves. Dois aparelhos com os mesmos dados têm a mesma impressão, então não
 * ficam reenviando um ao outro só porque montaram a lista em ordens diferentes.
 */
function stateFingerprint(state) {
  const { meta, ui, profile, account, ...rest } = state || {};
  const copy = { ...rest, cases: { ...(rest.cases || {}) }, edital: { ...(rest.edital || {}) } };
  MERGE_PATHS.forEach((path) => {
    mergeSetList(copy, path, [...mergeGetList(rest, path)].sort((x, y) => (mergeItemKey(x) < mergeItemKey(y) ? -1 : mergeItemKey(x) > mergeItemKey(y) ? 1 : 0)));
  });
  return mergeStableStringify({ ...copy, tombstones: meta?.tombstones || {}, revivals: meta?.revivals || {} });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MERGE_PATHS,
    normalizeTombstones,
    mergeUnionTimes,
    mergeCollectIds,
    mergeAttachIds,
    mergeCarryForwardForRestore,
    mergeRecordDeletions,
    mergeStatesDetailed,
    mergeStates,
    stateFingerprint,
    mergeIsAlive,
  };
}
