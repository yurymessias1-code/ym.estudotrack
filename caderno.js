/*
 * Caderno de erros: prints (imagens) e menu por matéria/assunto.
 * Carregado ANTES do ciclo.js. As funções puras (menu, agrupamento) não tocam no DOM nem no
 * estado global, então rodam nos testes em Node. O resto só usa o DOM/`state` em tempo de execução.
 *
 * Onde ficam os prints: as imagens (já reduzidas e comprimidas) vão para o IndexedDB do navegador.
 * No `state` ficam só os metadados ({ id, w, h }). Motivo: o app grava o estado inteiro várias vezes
 * no localStorage (cópia principal, backups) e no Supabase; imagem em base64 ali estouraria a cota.
 */

const ERRO_IMG = {
  maxSide: 1600, // lado maior, em pixels, depois de reduzir
  quality: 0.85,
  maxPerSlot: 6, // prints por campo (questão / gabarito)
  maxInputBytes: 25_000_000,
  dbName: "estudosTrack.erroImagens",
  store: "imagens",
};

/* ------------------------------------------------------------------ */
/* Menu por matéria / assunto (funções puras)                          */
/* ------------------------------------------------------------------ */

function erroMaps(subjects, topics) {
  return {
    subjectById: new Map((subjects || []).map((subject) => [subject.id, subject])),
    topicById: new Map((topics || []).map((topic) => [topic.id, topic])),
  };
}

/** Matéria e assunto "reais" de um erro (ignora vínculos que foram apagados). */
function erroEntryScope(entry, maps) {
  const topic = maps.topicById.get(entry.topicId);
  const rawSubject = entry.subjectId || (topic ? topic.subjectId : "");
  const subjectId = maps.subjectById.has(rawSubject) ? rawSubject : "";
  const topicId = topic && topic.subjectId === subjectId ? topic.id : "";
  return { subjectId, topicId };
}

/** filters.subject / filters.topic: "" = todos, "none" = sem matéria / sem assunto. */
function erroScopeMatches(scope, filters) {
  const subject = (filters && filters.subject) || "";
  const topic = (filters && filters.topic) || "";
  if (subject === "none" ? scope.subjectId !== "" : subject && scope.subjectId !== subject) return false;
  if (topic === "none" ? scope.topicId !== "" : topic && scope.topicId !== topic) return false;
  return true;
}

function erroIsDue(entry, today) {
  return !entry.mastered && Boolean(entry.dueDate) && entry.dueDate <= today;
}

/**
 * Árvore Matéria > Assunto com contagens. `entries` já vem filtrado por situação/motivo/busca,
 * assim os números do menu batem com o que a lista mostra ao clicar.
 * `keep` mantém no menu o item selecionado mesmo com contagem zero.
 */
function buildErrorNav(entries, subjects, topics, today, keep = {}) {
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
    const isDue = erroIsDue(entry, today);
    bump(`s|${scope.subjectId}`, isDue);
    bump(`t|${scope.subjectId}|${scope.topicId}`, isDue);
    total += 1;
    if (isDue) due += 1;
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

/** Divide a lista em blocos: por matéria (sem filtro) ou por assunto (matéria escolhida). */
function groupErrorsByScope(entries, subjects, topics, filters) {
  const maps = erroMaps(subjects, topics);
  const scoped = entries.map((entry) => ({ entry, scope: erroEntryScope(entry, maps) }));
  const subject = (filters && filters.subject) || "";
  const topic = (filters && filters.topic) || "";
  if (topic) return [{ key: "all", title: "", color: "", items: entries }];

  const make = (key, title, color, predicate) => ({
    key,
    title,
    color,
    items: scoped.filter(predicate).map((item) => item.entry),
  });
  let groups;
  if (!subject) {
    groups = (subjects || []).map((item) => make(`s:${item.id}`, item.name, item.color || "", (row) => row.scope.subjectId === item.id));
    groups.push(make("s:none", "Sem matéria", "", (row) => row.scope.subjectId === ""));
  } else {
    const subjectId = subject === "none" ? "" : subject;
    const subjectTopics = (topics || []).filter((item) => item.subjectId === subjectId);
    groups = subjectTopics.map((item) => make(`t:${item.id}`, item.name, "", (row) => row.scope.topicId === item.id));
    groups.push(make("t:none", "Sem assunto específico", "", (row) => row.scope.topicId === ""));
  }
  return groups.filter((group) => group.items.length);
}

/* ------------------------------------------------------------------ */
/* Armazenamento dos prints (IndexedDB, com reserva em memória)        */
/* ------------------------------------------------------------------ */

const erroImgMemory = new Map(); // só para o que não coube no IndexedDB
const erroImgUrls = new Map(); // id -> object URL
let erroImgDbPromise = null;

function erroImgNewId() {
  return `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function erroSafeId(value) {
  return String(value || "").replace(/[^\w-]/g, "");
}

function erroImgOpenDB() {
  if (erroImgDbPromise) return erroImgDbPromise;
  erroImgDbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(ERRO_IMG.dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(ERRO_IMG.store, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (error) {
      resolve(null);
    }
  });
  return erroImgDbPromise;
}

function erroImgRequest(db, mode, run) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ERRO_IMG.store, mode);
      let result = null;
      const request = run(tx.objectStore(ERRO_IMG.store));
      if (request) request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve({ ok: true, result });
      tx.onerror = () => resolve({ ok: false, result: null });
      tx.onabort = () => resolve({ ok: false, result: null });
    } catch (error) {
      resolve({ ok: false, result: null });
    }
  });
}

async function erroImgPut(id, blob, { synced = false } = {}) {
  const db = await erroImgOpenDB();
  if (db) {
    const { ok } = await erroImgRequest(db, "readwrite", (store) => store.put({ id, blob, savedAt: Date.now(), synced }));
    if (ok) {
      erroImgMemory.delete(id);
      return true;
    }
  }
  erroImgMemory.set(id, blob); // vale só nesta sessão
  return false;
}

async function erroImgGet(id) {
  if (erroImgMemory.has(id)) return erroImgMemory.get(id);
  const db = await erroImgOpenDB();
  if (db) {
    const { result } = await erroImgRequest(db, "readonly", (store) => store.get(id));
    if (result && result.blob) return result.blob;
  }
  return erroCloudPull(id); // não está neste aparelho: busca na conta online
}

async function erroImgDelete(id) {
  erroImgMemory.delete(id);
  const url = erroImgUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    erroImgUrls.delete(id);
  }
  const db = await erroImgOpenDB();
  if (db) await erroImgRequest(db, "readwrite", (store) => store.delete(id));
  erroCloudQueueDelete(id);
}

async function erroImgUrl(id) {
  if (erroImgUrls.has(id)) return erroImgUrls.get(id);
  const blob = await erroImgGet(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  erroImgUrls.set(id, url);
  return url;
}

function erroEntryImagesDelete(entry) {
  const ids = [...(entry.images || []), ...(entry.answerImages || [])].map((image) => image.id).concat(erroNotesImageIds(entry.notes));
  return Promise.all(ids.map((id) => erroImgDelete(id)));
}

/* ------------------------------------------------------------------ */
/* Prints na conta online (Supabase Storage)                           */
/* ------------------------------------------------------------------ */
/*
 * Bucket privado `erro-prints`, uma pasta por usuário: <user_id>/<id do print>.
 * O IndexedDB continua sendo o cache rápido; a nuvem é a cópia que sobrevive a limpar o navegador
 * e aparece em outro aparelho. Sem conta online, nada muda (tudo fica só neste aparelho).
 * Envios e exclusões que falham (sem internet) ficam numa fila e são repetidos depois.
 */
const ERRO_CLOUD = { bucket: "erro-prints", deleteQueueKey: "estudosTrack.erroImgDeleteQueue", intervalMs: 45000 };
const erroCloudMiss = new Set(); // prints que a conta confirmou não ter (evita repetir a busca)
const erroCloudPulling = new Map();
const erroCloud = { busy: false, again: false, timer: null, lastError: "", bound: false };

/** Todos os ids de print referenciados pelos erros do estado. */
function erroAllPrintIds(source) {
  const ids = new Set();
  ((source && source.errorNotebook) || []).forEach((entry) => {
    [...(entry.images || []), ...(entry.answerImages || [])].forEach((image) => image && image.id && ids.add(image.id));
    erroNotesImageIds(entry.notes).forEach((id) => ids.add(id));
  });
  docImgCollectIds(source, ids); // imagens de jurisprudências, leis/tabelas, anotações, fontes e flashcards
  return [...ids];
}

async function erroCloudAuth() {
  try {
    if (typeof getSupabaseSettings !== "function" || typeof getSupabaseClient !== "function") return null;
    const settings = getSupabaseSettings();
    if (!settings || !settings.configured) return null;
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    const session = data && data.session;
    if (!session || !session.access_token || !session.user || !session.user.id) return null;
    return { url: String(settings.url).replace(/\/+$/, ""), anonKey: settings.anonKey, token: session.access_token, uid: session.user.id };
  } catch (error) {
    return null;
  }
}

function erroCloudHeaders(auth, extra = {}) {
  return { Authorization: `Bearer ${auth.token}`, apikey: auth.anonKey, ...extra };
}

function erroCloudPath(auth, id) {
  return `${auth.url}/storage/v1/object/${ERRO_CLOUD.bucket}/${auth.uid}/${erroSafeId(id)}`;
}

async function erroCloudUpload(auth, id, blob) {
  try {
    const response = await fetch(erroCloudPath(auth, id), {
      method: "POST",
      headers: erroCloudHeaders(auth, { "Content-Type": blob.type || "image/webp", "x-upsert": "true" }),
      body: blob,
    });
    if (response.ok) {
      erroCloud.lastError = "";
      return true;
    }
    const text = await response.text().catch(() => "");
    erroCloud.lastError = /bucket not found/i.test(text) ? "bucket" : `código ${response.status}`;
    return false;
  } catch (error) {
    return false; // sem internet: tenta de novo depois
  }
}

async function erroCloudRemove(auth, id) {
  try {
    const response = await fetch(erroCloudPath(auth, id), { method: "DELETE", headers: erroCloudHeaders(auth) });
    if (response.ok || response.status === 404) return true;
    return /not.?found/i.test(await response.text().catch(() => ""));
  } catch (error) {
    return false;
  }
}

async function erroCloudPull(id) {
  const safe = erroSafeId(id);
  if (!safe || erroCloudMiss.has(safe)) return null;
  if (erroCloudPulling.has(safe)) return erroCloudPulling.get(safe);
  const job = (async () => {
    const auth = await erroCloudAuth();
    if (!auth) return null;
    try {
      const response = await fetch(`${auth.url}/storage/v1/object/authenticated/${ERRO_CLOUD.bucket}/${auth.uid}/${safe}`, { headers: erroCloudHeaders(auth) });
      if (response.status === 404 || response.status === 400) {
        erroCloudMiss.add(safe);
        return null;
      }
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob || !blob.size) return null;
      await erroImgPut(safe, blob, { synced: true }); // guarda no aparelho para as próximas vezes
      return blob;
    } catch (error) {
      return null;
    }
  })();
  erroCloudPulling.set(safe, job);
  try {
    return await job;
  } finally {
    erroCloudPulling.delete(safe);
  }
}

function erroCloudQueueRead() {
  try {
    const list = JSON.parse(localStorage.getItem(ERRO_CLOUD.deleteQueueKey) || "[]");
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch (error) {
    return [];
  }
}

function erroCloudQueueWrite(list) {
  try {
    if (list.length) localStorage.setItem(ERRO_CLOUD.deleteQueueKey, JSON.stringify(list.slice(-500)));
    else localStorage.removeItem(ERRO_CLOUD.deleteQueueKey);
  } catch (error) {
    // sem localStorage: a exclusão na nuvem fica só como tentativa imediata
  }
}

function erroCloudQueueDelete(id) {
  if (typeof isSupabaseConfigured !== "function" || !isSupabaseConfigured()) return;
  const safe = erroSafeId(id);
  if (!safe) return;
  const queue = erroCloudQueueRead();
  if (!queue.includes(safe)) erroCloudQueueWrite([...queue, safe]);
  erroCloudKick();
}

function erroCloudMarkSynced(db, id) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ERRO_IMG.store, "readwrite");
      const store = tx.objectStore(ERRO_IMG.store);
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) store.put({ ...request.result, synced: true }); // só se ainda existir (não ressuscita apagado)
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch (error) {
      resolve(false);
    }
  });
}

/** Lista os prints locais ainda não enviados que pertencem ao estado atual. */
async function erroCloudPending(db) {
  const wanted = new Set(typeof state !== "undefined" ? erroAllPrintIds(state) : []);
  if (!db || !wanted.size) return [];
  const { result } = await erroImgRequest(db, "readonly", (store) => store.getAll());
  return (result || []).filter((record) => record && record.blob && !record.synced && wanted.has(record.id));
}

async function erroCloudSync() {
  if (erroCloud.busy) {
    erroCloud.again = true;
    return;
  }
  erroCloud.busy = true;
  try {
    const auth = await erroCloudAuth();
    if (!auth) return;
    await docImgMigrateState(auth); // imagens antigas em base64 dentro do estado passam para o Storage
    const left = [];
    for (const id of erroCloudQueueRead()) if (!(await erroCloudRemove(auth, id))) left.push(id);
    erroCloudQueueWrite(left);
    const db = await erroImgOpenDB();
    for (const record of await erroCloudPending(db)) {
      if (left.includes(record.id)) continue;
      if (await erroCloudUpload(auth, record.id, record.blob)) await erroCloudMarkSynced(db, record.id);
      else if (erroCloud.lastError) break; // erro do servidor (ex.: bucket inexistente): não insiste em cada print
    }
  } catch (error) {
    // best-effort: a próxima rodada tenta de novo
  } finally {
    erroCloud.busy = false;
    erroCloudStatusRefresh();
    if (erroCloud.again) {
      erroCloud.again = false;
      erroCloudKick();
    }
  }
}

/** Agenda uma rodada de envio (junta várias chamadas seguidas numa só). */
function erroCloudKick(delay = 400) {
  if (typeof window === "undefined") return;
  clearTimeout(erroCloud.timer);
  erroCloud.timer = window.setTimeout(erroCloudSync, delay);
}

async function erroCloudStatusRefresh() {
  if (typeof document === "undefined") return;
  const box = document.getElementById("errorCloudStatus");
  if (!box) return;
  const hasShots = typeof state !== "undefined" && erroAllPrintIds(state).length > 0;
  const auth = await erroCloudAuth();
  let text = "";
  if (!auth) text = hasShots ? "Prints guardados só neste aparelho. Entre numa conta online para guardá-los na nuvem." : "";
  else {
    const pending = (await erroCloudPending(await erroImgOpenDB())).length;
    if (erroCloud.lastError === "bucket") text = "Os prints não estão indo para a nuvem: falta criar o bucket “erro-prints” (rode supabase-storage.sql no Supabase).";
    else if (erroCloud.lastError) text = `Falha ao enviar prints para a nuvem (${erroCloud.lastError}). Vou tentar de novo.`;
    else if (pending) text = `Enviando prints para a sua conta… ${pending} pendente${pending === 1 ? "" : "s"}.`;
    else if (hasShots) text = "Prints guardados na sua conta online.";
  }
  box.textContent = text;
  box.classList.toggle("hidden", !text);
}

function erroCloudBind() {
  if (erroCloud.bound || typeof window === "undefined") return;
  erroCloud.bound = true;
  window.addEventListener("online", () => erroCloudKick(1000));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") erroCloudKick(1000);
  });
  window.setInterval(erroCloudSync, ERRO_CLOUD.intervalMs);
  erroCloudKick(2500);
}

/** Apaga os prints do estado (aparelho e nuvem), mais qualquer sobra da pasta do usuário na conta. */
async function erroPrintsPurge(source) {
  await Promise.all(erroAllPrintIds(source).map((id) => erroImgDelete(id)));
  const auth = await erroCloudAuth();
  if (!auth) return;
  try {
    const listed = await fetch(`${auth.url}/storage/v1/object/list/${ERRO_CLOUD.bucket}`, {
      method: "POST",
      headers: erroCloudHeaders(auth, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: auth.uid, limit: 1000 }),
    });
    if (!listed.ok) return;
    const names = (await listed.json()).map((item) => item && item.name).filter(Boolean);
    if (!names.length) return;
    await fetch(`${auth.url}/storage/v1/object/${ERRO_CLOUD.bucket}`, {
      method: "DELETE",
      headers: erroCloudHeaders(auth, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: names.map((name) => `${auth.uid}/${name}`) }),
    });
  } catch (error) {
    // exclusão manual no painel do Supabase continua possível
  }
}

/* ---------- backup em arquivo: leva os prints junto ---------- */

function erroBlobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

function erroDataURLToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!match) return null;
  const type = match[1] || "image/webp";
  const bytes = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new Blob([array], { type });
}

/** { id: "data:image/webp;base64,..." } de todos os prints do estado que dá para obter (aparelho ou nuvem). */
async function erroPrintsExport(source) {
  const out = {};
  for (const id of erroAllPrintIds(source)) {
    const blob = await erroImgGet(id);
    if (!blob) continue;
    const dataUrl = await erroBlobToDataURL(blob);
    if (dataUrl) out[id] = dataUrl;
  }
  return out;
}

/** Devolve ao aparelho (e, com conta online, à nuvem) os prints de um backup em arquivo. Retorna quantos entraram. */
async function erroPrintsRestore(prints) {
  let count = 0;
  for (const [rawId, dataUrl] of Object.entries(prints || {})) {
    const id = erroSafeId(rawId);
    const blob = id ? erroDataURLToBlob(dataUrl) : null;
    if (!blob || !blob.size) continue;
    erroImgUrls.delete(id);
    erroCloudMiss.delete(id);
    if (await erroImgPut(id, blob)) count += 1;
  }
  if (count) erroCloudKick(600);
  return count;
}

/* ------------------------------------------------------------------ */
/* Imagens dos documentos (jurisprudências, leis/tabelas, anotações…)   */
/* ------------------------------------------------------------------ */
/*
 * Mesma infraestrutura dos prints: o arquivo da imagem vai para o IndexedDB e para o bucket `erro-prints`
 * (uma pasta por usuário) e o estado guarda só a referência. Assim o estado, que é gravado inteiro no
 * localStorage e no Supabase a cada mudança, não carrega imagens em base64.
 *   - texto rico (jurisprudência, anotação, fonte, flashcard...): <img data-img-id="ID"> (sem src)
 *   - material de lei/tabela do tipo imagem: content = "ymimg:ID"
 * Imagens antigas, que ainda estão em base64 no estado, são movidas sozinhas para a nuvem
 * (docImgMigrateState), e só depois de o envio ser confirmado.
 */
const DOC_IMG_STATE_SKIP = new Set(["meta", "ui", "profile", "account"]);
const DOC_IMG_MAX_UPLOAD_BYTES = 5_000_000; // limite do bucket
const DOC_IMG_INLINE_SRC = /\ssrc=(["'])(data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+)\1/gi;
const DOC_IMG_DATA_URL_EXACT = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i;

/** Ids de imagens referenciadas dentro de um texto: <img data-img-id="ID"> ou "ymimg:ID". */
function docImgIdsInText(text) {
  const value = String(text || "");
  const out = [];
  if (value.includes("data-img-id")) for (const match of value.matchAll(/data-img-id="([\w-]+)"/g)) out.push(match[1]);
  const reference = /^ymimg:([\w-]+)$/.exec(value.trim());
  if (reference) out.push(reference[1]);
  return out;
}

/** Junta em `ids` todas as imagens referenciadas em qualquer texto do estado (menos meta, ui, perfil e conta). */
function docImgCollectIds(source, ids) {
  if (!source || typeof source !== "object") return ids;
  const stack = [[source, true]];
  while (stack.length) {
    const [node, top] = stack.pop();
    if (typeof node === "string") {
      docImgIdsInText(node).forEach((id) => ids.add(id));
      continue;
    }
    if (!node || typeof node !== "object") continue;
    Object.keys(node).forEach((key) => {
      if (top && DOC_IMG_STATE_SKIP.has(key)) return;
      stack.push([node[key], false]);
    });
  }
  return ids;
}

/** Imagens referenciadas por um item só (para soltá-las quando ele é excluído). */
function docImgIdsOf(item) {
  return [...docImgCollectIds({ item }, new Set())];
}

/** Guarda um arquivo de imagem (reduzido) no IndexedDB. { id, stored: false } se o navegador não guardou em disco. */
async function docImgStoreFile(file) {
  const { blob } = await erroImgCompress(file);
  const id = erroImgNewId();
  const stored = await erroImgPut(id, blob);
  if (stored) erroCloudKick(1500);
  return { id, stored, blob };
}

/** Apaga (aparelho e nuvem) as imagens que nenhum item do estado usa mais. */
async function docImgRelease(ids) {
  if (typeof state === "undefined") return;
  const stillUsed = new Set(erroAllPrintIds(state));
  for (const id of new Set(ids || [])) if (id && !stillUsed.has(id)) await erroImgDelete(id);
}

async function docImgHashId(dataUrl) {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
      return `img_d${[...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
  } catch (error) {
    // sem WebCrypto: id aleatório
  }
  return erroImgNewId();
}

/** Lugares do estado onde há imagem em base64: { parent, key, owner } (owner: item com id que a contém). */
function docImgFindInline(root) {
  const found = [];
  const walk = (node, owner, top) => {
    if (!node || typeof node !== "object") return;
    const nextOwner = !Array.isArray(node) && node.id !== undefined ? node : owner;
    Object.keys(node).forEach((key) => {
      if (top && DOC_IMG_STATE_SKIP.has(key)) return;
      const value = node[key];
      if (typeof value === "string") {
        if (value.includes("data:image/")) found.push({ parent: node, key, owner: nextOwner });
      } else if (value && typeof value === "object") walk(value, nextOwner, false);
    });
  };
  walk(root, null, true);
  return found;
}

let docImgMigrating = false;

/**
 * Move para o Storage as imagens que ainda estão em base64 no estado. Só roda com conta online e troca a
 * imagem pela referência depois de o envio ser confirmado: se algo falhar, a imagem continua onde estava.
 */
async function docImgMigrateState(auth) {
  if (docImgMigrating || typeof state === "undefined" || !state || !auth) return 0;
  docImgMigrating = true;
  let moved = 0;
  try {
    const db = await erroImgOpenDB();
    if (!db) return 0;
    const places = docImgFindInline(state);
    if (!places.length) return 0;
    const done = new Map(); // dataUrl -> id (ou "" se não deu)
    const resolve = async (dataUrl) => {
      if (done.has(dataUrl)) return done.get(dataUrl);
      done.set(dataUrl, "");
      const blob = erroDataURLToBlob(dataUrl);
      if (!blob || !blob.size || blob.size > DOC_IMG_MAX_UPLOAD_BYTES) return "";
      const id = await docImgHashId(dataUrl);
      if (!(await erroImgPut(id, blob))) return ""; // sem IndexedDB: deixa como está
      if (!(await erroCloudUpload(auth, id, blob))) return "";
      await erroCloudMarkSynced(db, id);
      done.set(dataUrl, id);
      return id;
    };
    for (const place of places) {
      const original = place.parent[place.key];
      if (typeof original !== "string") continue;
      let next = original;
      if (DOC_IMG_DATA_URL_EXACT.test(original.trim()) && place.parent.type === "image" && place.key === "content") {
        const id = await resolve(original.trim());
        if (id) next = `ymimg:${id}`;
      } else {
        const urls = [...new Set([...original.matchAll(DOC_IMG_INLINE_SRC)].map((match) => match[2]))];
        const ids = new Map();
        for (const url of urls) {
          const id = await resolve(url);
          if (id) ids.set(url, id);
        }
        if (ids.size) next = original.replace(DOC_IMG_INLINE_SRC, (whole, quote, url) => (ids.has(url) ? ` data-img-id="${ids.get(url)}"` : whole));
      }
      if (next === original || place.parent[place.key] !== original) continue; // mudou durante o envio: tenta na próxima rodada
      place.parent[place.key] = next;
      if (place.owner && typeof place.owner === "object") place.owner.updatedAt = new Date().toISOString(); // ganha das cópias antigas em outros aparelhos
      moved += 1;
    }
    if (moved) {
      if (typeof saveState === "function") saveState();
      if (typeof render === "function") render();
      if (typeof showToast === "function") showToast(`${moved} ${moved === 1 ? "imagem foi movida" : "imagens foram movidas"} para a nuvem, deixando o app mais leve.`);
    }
  } catch (error) {
    // best-effort: a próxima rodada tenta de novo
  } finally {
    docImgMigrating = false;
  }
  return moved;
}

/** Carrega sozinha as imagens (<img data-img-id>) que aparecem em qualquer parte da tela. */
let docImgObserver = null;
function docImgObserve() {
  if (docImgObserver || typeof MutationObserver === "undefined" || typeof document === "undefined" || !document.body) return;
  let scheduled = false;
  docImgObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      erroImgHydrate(document);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 50);
  });
  docImgObserver.observe(document.body, { childList: true, subtree: true });
  erroImgHydrate(document);
}

/* ------------------------------------------------------------------ */
/* Compressão                                                          */
/* ------------------------------------------------------------------ */

function erroImgFit(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function erroImgLoadViaElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Arquivo de imagem inválido."));
    };
    img.src = url;
  });
}

async function erroImgLoad(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      // cai para o <img>
    }
  }
  return erroImgLoadViaElement(file);
}

function erroImgToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Reduz para no máx. 1600 px no lado maior e grava como WebP (ou JPEG, se o navegador não gerar WebP). */
async function erroImgCompress(file) {
  const source = await erroImgLoad(file);
  const { width, height } = erroImgFit(source.width, source.height, ERRO_IMG.maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // PNG com transparência não vira fundo preto
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === "function") source.close();
  let blob = await erroImgToBlob(canvas, "image/webp", ERRO_IMG.quality);
  if (!blob || blob.type !== "image/webp") blob = await erroImgToBlob(canvas, "image/jpeg", ERRO_IMG.quality);
  if (!blob) throw new Error("Não foi possível processar a imagem.");
  return { blob, w: width, h: height };
}

/* ------------------------------------------------------------------ */
/* Rascunho de prints do formulário                                    */
/* ------------------------------------------------------------------ */

const erroDraft = { question: [], answer: [], removed: [] };
const ERRO_SLOTS = {
  question: { box: "#errorShotsQuestion", label: "Print da questão" },
  answer: { box: "#errorShotsAnswer", label: "Print do gabarito ou comentário" },
};

/** Começa o rascunho vazio (erro novo) ou com os prints já salvos do erro (edição). */
function erroDraftReset(entry) {
  const meta = (list) => (list || []).map((image) => ({ id: image.id, w: image.w, h: image.h, blob: null }));
  erroDraft.question = entry ? meta(entry.images) : [];
  erroDraft.answer = entry ? meta(entry.answerImages) : [];
  erroDraft.removed = [];
  erroDraftRender();
}

function erroDraftCount() {
  return erroDraft.question.length + erroDraft.answer.length;
}

async function erroDraftAdd(slot, files) {
  const list = erroDraft[slot];
  if (!list) return;
  const images = [...files].filter((file) => file && String(file.type).startsWith("image/"));
  if (!images.length) {
    if (typeof showToast === "function") showToast("Só imagens podem ser anexadas.");
    return;
  }
  let skipped = 0;
  let failed = 0;
  for (const file of images) {
    if (list.length >= ERRO_IMG.maxPerSlot || file.size > ERRO_IMG.maxInputBytes) {
      skipped += 1;
      continue;
    }
    try {
      const { blob, w, h } = await erroImgCompress(file);
      const id = erroImgNewId();
      erroImgUrls.set(id, URL.createObjectURL(blob));
      list.push({ id, w, h, blob });
      erroDraftRender();
    } catch (error) {
      failed += 1;
    }
  }
  if (typeof showToast === "function") {
    if (skipped) showToast(`Limite de ${ERRO_IMG.maxPerSlot} prints por campo (ou arquivo grande demais).`);
    else if (failed) showToast("Não consegui ler essa imagem. Tente outro formato (PNG ou JPG).");
  }
}

function erroDraftRemove(slot, id) {
  const list = erroDraft[slot];
  if (!list) return;
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [item] = list.splice(index, 1);
  if (item.blob) {
    const url = erroImgUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    erroImgUrls.delete(id);
  } else {
    erroDraft.removed.push(id); // já estava salvo: só apaga de verdade ao salvar o erro
  }
  erroDraftRender();
}

/** Grava no IndexedDB o que é novo e apaga o que foi removido. Devolve os metadados para o estado. */
async function erroDraftCommit() {
  let failed = 0;
  for (const slot of ["question", "answer"]) {
    for (const item of erroDraft[slot]) {
      if (item.blob && !(await erroImgPut(item.id, item.blob))) failed += 1;
    }
  }
  for (const id of erroDraft.removed) await erroImgDelete(id);
  const meta = (list) => list.map(({ id, w, h }) => ({ id, w, h }));
  return { images: meta(erroDraft.question), answerImages: meta(erroDraft.answer), failed };
}

function erroShotHTML(image, { slot, label, index, total, removable, gallery }) {
  const id = erroSafeId(image.id);
  const ratio = image.w && image.h ? ` style="aspect-ratio:${image.w}/${image.h}"` : "";
  return `
    <figure class="shot is-loading" role="listitem">
      <button type="button" class="shot-open" data-shot-open data-gallery="${gallery}" data-index="${index}" aria-label="Ampliar: ${label} ${index + 1} de ${total}"${ratio}>
        <img data-img-id="${id}" alt="${label} ${index + 1}" decoding="async" />
      </button>
      ${removable ? `<button type="button" class="shot-remove" data-shot-remove data-slot="${slot}" data-id="${id}" aria-label="Remover ${label} ${index + 1}">&times;</button>` : ""}
      <figcaption class="shot-missing">Print indisponível (precisa de internet e de login)</figcaption>
    </figure>`;
}

function erroShotsHTML(images, label) {
  if (!images || !images.length) return "";
  const gallery = images.map((image) => erroSafeId(image.id)).join(",");
  const items = images.map((image, index) => erroShotHTML(image, { label, index, total: images.length, removable: false, gallery }));
  return `<div class="shot-grid" role="list">${items.join("")}</div>`;
}

function erroDraftRender() {
  if (typeof document === "undefined") return;
  Object.entries(ERRO_SLOTS).forEach(([slot, config]) => {
    const box = document.querySelector(config.box);
    if (!box) return;
    const list = erroDraft[slot];
    const gallery = list.map((image) => erroSafeId(image.id)).join(",");
    box.innerHTML = list.map((image, index) => erroShotHTML(image, { slot, label: config.label, index, total: list.length, removable: true, gallery })).join("");
    const pick = box.closest("[data-shot-slot]")?.querySelector("[data-shot-pick]");
    if (pick) pick.disabled = list.length >= ERRO_IMG.maxPerSlot;
    erroImgHydrate(box);
  });
}

/* ------------------------------------------------------------------ */
/* Carregamento preguiçoso das imagens                                 */
/* ------------------------------------------------------------------ */

async function erroImgLoadInto(img) {
  const url = await erroImgUrl(img.dataset.imgId);
  if (!img.isConnected) return;
  const figure = img.closest(".shot");
  if (url) {
    img.src = url;
    figure?.classList.remove("is-loading", "is-missing");
  } else {
    figure?.classList.remove("is-loading");
    figure?.classList.add("is-missing");
    if (!figure) {
      img.classList.add("is-missing");
      img.alt = "Print indisponível (precisa de internet e de login)";
    }
  }
}

let erroImgObserver = null;

function erroImgHydrate(root = document) {
  if (typeof document === "undefined" || !root) return;
  const images = [...root.querySelectorAll("img[data-img-id]")].filter((img) => !img.getAttribute("src"));
  if (!images.length) return;
  if (typeof IntersectionObserver === "undefined") {
    images.forEach(erroImgLoadInto);
    return;
  }
  if (!erroImgObserver) {
    erroImgObserver = new IntersectionObserver(
      (items) =>
        items.forEach((item) => {
          if (!item.isIntersecting) return;
          erroImgObserver.unobserve(item.target);
          erroImgLoadInto(item.target);
        }),
      { rootMargin: "400px" }
    );
  }
  images.forEach((img) => erroImgObserver.observe(img));
}

/* ------------------------------------------------------------------ */
/* Visualizador (ampliar print)                                        */
/* ------------------------------------------------------------------ */

const erroViewer = { ids: [], index: 0, zoom: false };

function erroViewerElement() {
  let element = document.getElementById("shotViewer");
  if (element) return element;
  element = document.createElement("div");
  element.id = "shotViewer";
  element.className = "shot-viewer hidden";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", "Print do caderno de erros");
  element.tabIndex = -1;
  element.innerHTML = `
    <div class="shot-viewer-bar">
      <span id="shotViewerCount" aria-live="polite"></span>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-shot-viewer="prev">Anterior</button>
        <button class="mini-button" type="button" data-shot-viewer="next">Próximo</button>
        <button class="mini-button" type="button" data-shot-viewer="zoom" aria-pressed="false">Tamanho real</button>
        <button class="mini-button" type="button" data-shot-viewer="close">Fechar</button>
      </div>
    </div>
    <div class="shot-viewer-stage" data-shot-viewer="stage"><img id="shotViewerImg" alt="Print ampliado" /></div>`;
  document.body.appendChild(element);
  return element;
}

async function erroViewerShow() {
  const element = erroViewerElement();
  const id = erroViewer.ids[erroViewer.index];
  const img = element.querySelector("#shotViewerImg");
  const url = id ? await erroImgUrl(id) : null;
  img.removeAttribute("src");
  if (url) img.src = url;
  else img.alt = "Esse print não está disponível agora (precisa de internet e de login).";
  element.classList.toggle("is-zoomed", erroViewer.zoom);
  element.querySelector("#shotViewerCount").textContent = `Print ${erroViewer.index + 1} de ${erroViewer.ids.length}`;
  element.querySelectorAll('[data-shot-viewer="prev"], [data-shot-viewer="next"]').forEach((button) => button.classList.toggle("hidden", erroViewer.ids.length < 2));
  const zoomButton = element.querySelector('[data-shot-viewer="zoom"]');
  zoomButton.setAttribute("aria-pressed", String(erroViewer.zoom));
  zoomButton.textContent = erroViewer.zoom ? "Ajustar à tela" : "Tamanho real";
}

function erroViewerOpen(ids, index) {
  if (!ids.length) return;
  erroViewer.ids = ids;
  erroViewer.index = Math.min(Math.max(index, 0), ids.length - 1);
  erroViewer.zoom = false;
  const element = erroViewerElement();
  element.classList.remove("hidden");
  if (typeof modalOpen === "function") modalOpen(element);
  erroViewerShow();
}

function erroViewerClose() {
  const element = document.getElementById("shotViewer");
  if (!element || element.classList.contains("hidden")) return;
  element.classList.add("hidden");
  if (typeof modalClose === "function") modalClose(element);
}

function erroViewerStep(delta) {
  const total = erroViewer.ids.length;
  if (total < 2) return;
  erroViewer.index = (erroViewer.index + delta + total) % total;
  erroViewer.zoom = false;
  erroViewerShow();
}

/* ------------------------------------------------------------------ */
/* Anotações livres (editor do caderno)                                */
/* ------------------------------------------------------------------ */

const ERRO_NOTES_KEEP = new Set(["B", "STRONG", "I", "EM", "U", "S", "MARK", "P", "BR", "HR", "DIV", "UL", "OL", "LI", "H3", "H4", "BLOCKQUOTE", "CODE", "PRE", "IMG"]);
const ERRO_NOTES_MAX = 200000;

function erroEscape(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Deixa só formatação simples (negrito, listas, marca-texto, títulos) e prints do caderno. Sem atributos, scripts ou links. */
function erroNotesSanitize(html) {
  const raw = String(html || "").slice(0, ERRO_NOTES_MAX);
  if (!raw.trim()) return "";
  if (typeof DOMParser === "undefined") {
    return erroEscape(raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, "")).replace(/\n/g, "<br>").trim();
  }
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, "text/html");
  const walk = (node) => {
    if (node.nodeType === 3) return erroEscape(node.nodeValue);
    if (node.nodeType !== 1) return "";
    const tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return "";
    if (tag === "IMG") {
      const id = erroSafeId(node.getAttribute("data-img-id"));
      return id ? `<img data-img-id="${id}" alt="Print">` : "";
    }
    if (tag === "BR" || tag === "HR") return `<${tag.toLowerCase()}>`;
    const inner = [...node.childNodes].map(walk).join("");
    if (!ERRO_NOTES_KEEP.has(tag)) return inner;
    const name = tag.toLowerCase();
    return `<${name}>${inner}</${name}>`;
  };
  const clean = [...doc.body.childNodes].map(walk).join("");
  return erroNotesText(clean) || erroNotesImageIds(clean).length ? clean : "";
}

function erroNotesImageIds(html) {
  return [...String(html || "").matchAll(/data-img-id="([\w-]+)"/g)].map((match) => match[1]);
}

/** Texto puro das anotações (busca, validação, resumo). */
function erroNotesText(html) {
  return String(html || "")
    .replace(/<(br|\/p|\/div|\/li|\/h3|\/h4|\/blockquote)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function erroNotesEditor() {
  return typeof document === "undefined" ? null : document.getElementById("errorNotes");
}

function erroNotesSet(html) {
  const editor = erroNotesEditor();
  if (!editor) return;
  editor.innerHTML = erroNotesSanitize(html);
  erroImgHydrate(editor);
}

/** HTML do editor pronto para salvar (imagens guardam só o id; o arquivo fica no IndexedDB). */
function erroNotesGet() {
  const editor = erroNotesEditor();
  return editor ? erroNotesSanitize(editor.innerHTML) : "";
}

function erroNotesPlaceCaret(editor) {
  editor.focus();
  const selection = window.getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode)) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function erroNotesInsertImages(files) {
  const editor = erroNotesEditor();
  if (!editor) return;
  const images = [...files].filter((file) => file && String(file.type).startsWith("image/"));
  if (!images.length) {
    if (typeof showToast === "function") showToast("Só imagens podem ser anexadas.");
    return;
  }
  let failed = 0;
  for (const file of images) {
    if (file.size > ERRO_IMG.maxInputBytes) {
      failed += 1;
      continue;
    }
    try {
      const { blob } = await erroImgCompress(file);
      const id = erroImgNewId();
      await erroImgPut(id, blob);
      erroImgUrls.set(id, URL.createObjectURL(blob));
      erroNotesPlaceCaret(editor);
      document.execCommand("insertHTML", false, `<img data-img-id="${id}" src="${erroImgUrls.get(id)}" alt="Print"><br>`);
    } catch (error) {
      failed += 1;
    }
  }
  if (failed && typeof showToast === "function") showToast("Alguma imagem não pôde ser anexada (arquivo grande ou formato não suportado).");
}

function erroNotesOnPaste(event) {
  const files = erroClipboardImages(event);
  if (files.length) {
    event.preventDefault();
    erroNotesInsertImages(files);
    return;
  }
  const html = event.clipboardData && event.clipboardData.getData("text/html");
  if (!html) return; // texto simples: o navegador cola normalmente
  event.preventDefault();
  const clean = erroNotesSanitize(html);
  if (clean) document.execCommand("insertHTML", false, clean);
  else document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
}

function erroNotesCommand(cmd) {
  const editor = erroNotesEditor();
  if (!editor) return;
  erroNotesPlaceCaret(editor);
  if (cmd === "mark") {
    const text = window.getSelection().toString();
    if (text) document.execCommand("insertHTML", false, `<mark>${erroEscape(text)}</mark>`);
  } else if (cmd === "h3") document.execCommand("formatBlock", false, "h3");
  else if (cmd === "p") document.execCommand("formatBlock", false, "p");
  else document.execCommand(cmd, false, null);
}

/* ------------------------------------------------------------------ */
/* Eventos: colar, arrastar, escolher arquivo, ampliar                 */
/* ------------------------------------------------------------------ */

function erroClipboardImages(event) {
  const data = event.clipboardData;
  if (!data) return [];
  const fromItems = [...(data.items || [])].filter((item) => item.kind === "file" && String(item.type).startsWith("image/")).map((item) => item.getAsFile());
  const files = fromItems.filter(Boolean);
  return files.length ? files : [...(data.files || [])].filter((file) => String(file.type).startsWith("image/"));
}

function erroDroppedImages(event) {
  return [...(event.dataTransfer?.files || [])].filter((file) => String(file.type).startsWith("image/"));
}

function erroViewIsVisible() {
  const view = document.getElementById("erros");
  return Boolean(view && view.getClientRects().length > 0);
}

function cadernoOnPaste(event) {
  if (!erroViewIsVisible()) return;
  if (event.target.closest?.("#errorNotes")) {
    erroNotesOnPaste(event);
    return;
  }
  const files = erroClipboardImages(event);
  if (!files.length) return; // texto: deixa o navegador colar normalmente
  const target = event.target;
  const form = document.getElementById("errorForm");
  const formOpen = Boolean(form && !form.classList.contains("hidden"));
  const inForm = formOpen && form.contains(target);
  const editableOutside = !inForm && target.closest?.("input, textarea, select, [contenteditable='true']");
  if (editableOutside) return; // não rouba o Ctrl+V de outros campos (ex.: busca)
  event.preventDefault();
  const slot = (inForm && target.closest("[data-shot-slot]")?.dataset.shotSlot) || "question";
  if (!formOpen && typeof errorFormOpen === "function") errorFormOpen();
  erroDraftAdd(slot, files);
}

let cadernoBound = false;

function bindCadernoEvents() {
  if (cadernoBound || typeof document === "undefined") return;
  cadernoBound = true;
  erroCloudBind();
  docImgObserve();

  document.addEventListener("paste", cadernoOnPaste);

  const zoneOf = (event) => event.target.closest?.("[data-shot-slot]");
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragover", (event) => {
    if (event.target.closest?.("#errorNotes") && hasFiles(event)) {
      event.preventDefault();
      return;
    }
    const zone = zoneOf(event);
    if (!zone || !hasFiles(event)) return;
    event.preventDefault();
    zone.classList.add("is-over");
  });
  document.addEventListener("dragleave", (event) => {
    const zone = zoneOf(event);
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
  });
  document.addEventListener("drop", (event) => {
    if (event.target.closest?.("#errorNotes")) {
      const dropped = erroDroppedImages(event);
      if (!dropped.length) return;
      event.preventDefault();
      erroNotesInsertImages(dropped);
      return;
    }
    const zone = zoneOf(event);
    if (!zone) return;
    zone.classList.remove("is-over");
    const files = erroDroppedImages(event);
    if (!files.length) return;
    event.preventDefault();
    erroDraftAdd(zone.dataset.shotSlot, files);
  });

  document.addEventListener("mousedown", (event) => {
    if (event.target.closest?.("[data-notes-cmd], [data-notes-pick]")) event.preventDefault(); // não perde a seleção do editor
  });

  document.addEventListener("change", (event) => {
    const notesInput = event.target.closest?.("input[data-notes-input]");
    if (notesInput) {
      erroNotesInsertImages(notesInput.files);
      notesInput.value = "";
      return;
    }
    const input = event.target.closest?.("input[data-shot-input]");
    if (!input) return;
    erroDraftAdd(input.dataset.shotInput, input.files);
    input.value = "";
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const command = target.closest?.("[data-notes-cmd]");
    if (command) {
      erroNotesCommand(command.dataset.notesCmd);
      return;
    }
    if (target.closest?.("[data-notes-pick]")) {
      document.querySelector("input[data-notes-input]")?.click();
      return;
    }
    const inlineShot = target.closest?.(".error-notes img[data-img-id]");
    if (inlineShot && inlineShot.getAttribute("src")) {
      erroViewerOpen([erroSafeId(inlineShot.dataset.imgId)], 0);
      return;
    }
    const pick = target.closest?.("[data-shot-pick]");
    if (pick) {
      document.querySelector(`input[data-shot-input="${pick.dataset.shotPick}"]`)?.click();
      return;
    }
    const remove = target.closest?.("[data-shot-remove]");
    if (remove) {
      erroDraftRemove(remove.dataset.slot, remove.dataset.id);
      return;
    }
    const open = target.closest?.("[data-shot-open]");
    if (open) {
      erroViewerOpen(String(open.dataset.gallery || "").split(",").filter(Boolean), Number(open.dataset.index) || 0);
      return;
    }
    const control = target.closest?.("[data-shot-viewer]");
    if (!control) return;
    if (control.dataset.shotViewer === "stage" && target !== control) return; // clicar na imagem não fecha
    const action = control.dataset.shotViewer;
    if (action === "close" || action === "stage") erroViewerClose();
    else if (action === "prev") erroViewerStep(-1);
    else if (action === "next") erroViewerStep(1);
    else if (action === "zoom") {
      erroViewer.zoom = !erroViewer.zoom;
      erroViewerShow();
    }
  });

  document.addEventListener("keydown", (event) => {
    const element = document.getElementById("shotViewer");
    if (!element || element.classList.contains("hidden")) return;
    if (event.key === "Escape") erroViewerClose();
    else if (event.key === "ArrowLeft") erroViewerStep(-1);
    else if (event.key === "ArrowRight") erroViewerStep(1);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildErrorNav, groupErrorsByScope, erroEntryScope, erroScopeMatches, erroMaps, erroImgFit, erroNotesSanitize, erroNotesText, erroNotesImageIds, erroAllPrintIds, erroDataURLToBlob, docImgIdsInText, docImgCollectIds, docImgIdsOf, docImgFindInline };
}
