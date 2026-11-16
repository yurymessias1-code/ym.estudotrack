const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "app.js");
const htmlPath = path.join(root, "index.html");
const cssPath = path.join(root, "styles.css");
const sqlPath = path.join(root, "supabase-schema.sql");
const aprovadoBookmarkletPath = path.join(root, "bookmarklet-aprovado.txt");

const app = fs.readFileSync(appPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const sql = fs.readFileSync(sqlPath, "utf8");
const aprovadoBookmarklet = fs.readFileSync(aprovadoBookmarkletPath, "utf8");

execFileSync(process.execPath, ["--check", appPath], { stdio: "inherit" });

assert(html.includes("dailyReviewList"), "Painel diario nao encontrado no HTML.");
assert(html.includes("editalManualForm"), "Formulario manual do edital nao encontrado.");
assert(html.includes("accountStatusList"), "Status da conta nao encontrado.");
assert(html.includes("20261116-sessao"), "Cache do HTML nao foi atualizado para o ciclo de revisao.");
assert(html.includes("supabase-config.js?v=20261116-sessao"), "Cache-buster do supabase-config.js ausente.");
assert(html.includes('id="studyCanvas" width="620" height="330"'), "Canvas do painel deve ter altura suficiente para nao cortar o resumo visual.");
assert(html.includes('id="questionCancelEditBtn"'), "Cancelamento de edicao de questoes ausente.");
assert(html.includes('id="questionSubject"'), "Seletor de materia em questoes ausente.");
assert(html.includes('<option value="note">'), "Tipo Anotacao nos materiais de apoio ausente.");
assert(html.includes('id="legalMaterialCancelEditBtn"'), "Cancelamento de edicao de leis/tabelas/anotacoes ausente.");
assert(html.includes('id="noteCancelEditBtn"'), "Cancelamento de edicao de anotacoes ausente.");
assert(html.includes("unpkg.com/@supabase/supabase-js@2"), "CDN alternativo do SDK Supabase ausente.");
assert(html.includes("cancelSubjectEditBtn"), "Cancelamento de edicao de materia ausente.");
assert(html.includes("cancelTopicEditBtn"), "Cancelamento de edicao de assunto ausente.");
assert(html.includes("externalStudyImportInput"), "Importador externo de estudos ausente.");
assert(html.includes("bookmarklet-aprovado.txt"), "Link do coletor do Aprovado ausente.");
assert(html.includes("data-view=\"concursos\""), "Aba Concursos ausente.");
assert(html.includes("competitionForm"), "Formulario de concursos ausente.");
assert(html.includes("timerCompetition"), "Seletor de concurso no Pomodoro ausente.");
assert(html.includes("pomodoroCheckpointStatus"), "Status de pre-salvamento do Pomodoro ausente.");
assert(html.includes("studyCompetition"), "Seletor de concurso no registro manual ausente.");
assert(html.includes("data-subject-color"), "Cores rapidas de materia ausentes.");
assert(html.includes("reportTimelineChart"), "Grafico de linha do tempo dos relatorios ausente.");
assert(html.includes("reportTimelineLegend"), "Legenda de cores dos relatorios ausente.");
assert(html.includes("reportCustomForm"), "Periodo customizado dos relatorios ausente.");
assert(html.includes("data-question-precision-range=\"day\""), "Filtro diario de precisao ausente.");
assert(html.includes("questionPrecisionSummary"), "Resumo de precisao por periodo ausente.");
assert(html.includes("questionReviewReminders"), "Lembretes de revisao por pior desempenho ausentes.");
assert(html.includes("caseCourtSelect"), "Seletor de tribunal no cadastro de jurisprudencia ausente.");
assert(html.includes("data-case-search-scope=\"all\""), "Busca geral STJ + STF ausente.");
assert(html.includes("backupShortcutPanel"), "Atalho visivel de backup no painel ausente.");
assert(html.includes("data-action=\"downloadBackup\""), "Acao direta de download de backup ausente.");
assert(html.includes("reportCompetitionFilter"), "Filtro de relatorios por concurso ausente.");
assert(html.includes("reportCompetitionHint"), "Resumo do filtro de concurso ausente.");
assert(html.includes("localRecoveryList"), "Lista de recuperacao local ausente.");
assert(html.includes("data-action=\"scanLocalRecovery\""), "Botao de busca de backups locais ausente.");
assert(html.includes("data-action=\"createAuxiliaryBackup\""), "Botao manual de backup auxiliar ausente.");

assert(app.includes("function renderDailyReview"), "renderDailyReview ausente.");

// Ciclo de estudos: revisao, caderno de erros e lei seca
const ciclo = fs.readFileSync(path.join(root, "ciclo.js"), "utf8");
execFileSync(process.execPath, ["--check", path.join(root, "ciclo.js")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "ciclo-tests.js")], { stdio: "inherit" });
assert(html.includes('src="ciclo.js?v='), "ciclo.js nao foi carregado no HTML.");
assert(html.indexOf('src="ciclo.js') < html.indexOf('src="app.js'), "ciclo.js deve carregar antes do app.js.");
["erros", "revisao", "leiseca"].forEach((view) => {
  assert(html.includes(`data-view="${view}"`), `Botao de navegacao ${view} ausente.`);
  assert(html.includes(`id="${view}"`), `Aba ${view} ausente.`);
  assert(app.includes(`${view}: "`), `Titulo da aba ${view} ausente no app.js.`);
});
["errorForm", "errorList", "errorReasonChart", "revisionQueue", "revisionSession", "revisionForm", "cycleSettingsForm", "lawForm", "lawPlans", "cycleStripDashboard"].forEach((id) => {
  assert(html.includes(`id="${id}"`), `Elemento #${id} ausente.`);
});
["revisions", "errorNotebook", "lawPlans", "cycleSettings"].forEach((key) => {
  assert(app.includes(`${key}: Array.isArray(candidate.${key})`) || app.includes(`${key}: normalizeCycleSettings(candidate.${key})`), `normalizeState nao preserva ${key}.`);
});
assert(app.includes("renderCycle();"), "render() nao chama renderCycle.");
assert(app.includes("bindCycleEvents();"), "bindCycleEvents nao e chamado.");
assert(app.includes("getCycleDailyCards"), "Cartoes do ciclo no painel diario ausentes.");
assert(!/normalize(Revision|ErrorEntry|LawPlan|CycleSettings)[\s\S]{0,1500}?\bstate\b\??\./.test(ciclo.split("function ensureCycleState")[0].replace(/\/\/.*$/gm, "")), "Normalizadores do ciclo nao podem ler `state` (zona morta durante loadState).");
assert(css.includes(".cycle-strip") && css.includes(".law-plan-card") && css.includes(".error-card"), "Estilos do ciclo ausentes.");
// Lembretes automaticos, PWA e agenda
const swPath = path.join(root, "sw.js");
const manifestPath = path.join(root, "manifest.json");
execFileSync(process.execPath, ["--check", swPath], { stdio: "inherit" });
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert(manifest.name && manifest.start_url && manifest.display === "standalone", "manifest.json incompleto.");
assert(manifest.icons.some((icon) => fs.existsSync(path.join(root, icon.src))), "Icone do manifest nao existe.");
assert(html.includes('rel="manifest" href="manifest.json"'), "Link do manifest ausente no HTML.");
["reviewBanner", "reminderForm", "revisionTrail", "notifyToggleBtn", "installAppBtn"].forEach((id) => {
  assert(html.includes(`id="${id}"`), `Elemento #${id} ausente.`);
});
["exportIcs", "notifyToggle", "notifyTest", "redistributeOverdue", "reviewNow"].forEach((action) => {
  assert(ciclo.includes(`type === "${action}"`), `Acao ${action} ausente no ciclo.js.`);
});
assert(fs.readFileSync(swPath, "utf8").includes("notificationclick"), "sw.js sem tratamento de clique na notificacao.");
assert(app.includes("cycleBaseTitle"), "Titulo do Pomodoro nao respeita o selo de pendencias.");
assert(ciclo.includes("cycleReminderTick") && ciclo.includes("navigator.serviceWorker.register"), "Motor de lembretes ou registro do service worker ausente.");

assert(!app.includes("searchable-select"), "Seletores customizados nao devem existir no JS.");
assert(app.includes("function deleteCurrentProfileData"), "Exclusao de dados da conta ausente.");
assert(app.includes("deleteEditalItem"), "Remocao individual de item do edital ausente.");
assert(app.includes("email: user.email"), "Sincronizacao do e-mail no Supabase ausente.");
assert(app.includes("editSubject"), "Edicao de materias ausente.");
assert(app.includes("editTopic"), "Edicao de assuntos ausente.");
assert(app.includes("isStrongOnlinePassword"), "Validacao de senha forte online ausente.");
assert(app.includes("Brevo bloqueou"), "Mensagem amigavel de SMTP/Brevo ausente.");
assert(app.includes("supabase-config.js foi publicado atualizado"), "Mensagem de conexao Supabase nao orienta cache/publicacao.");
assert(app.includes("createSupabaseFallbackClient"), "Cliente fallback do Supabase ausente.");
assert(app.includes("SUPABASE_FALLBACK_SESSION_KEY"), "Sessao fallback do Supabase ausente.");
assert(app.includes("importExternalStudyFile"), "Importador de estudos externos ausente.");
assert(app.includes("parseExternalStudyImport"), "Parser de estudos externos ausente.");
assert(app.includes("function normalizeCompetition"), "Normalizacao de concursos ausente.");
assert(app.includes("function renderCompetitions"), "Renderizacao de concursos ausente.");
assert(app.includes("competitionId"), "Vinculo de estudo com concurso ausente.");
assert(app.includes("updateSubjectColorPresetState"), "Controle das cores rapidas de materia ausente.");
assert(app.includes("function renderReportTimeline"), "Renderizacao do grafico empilhado dos relatorios ausente.");
assert(app.includes("function getReportPeriodMeta"), "Calculo de periodo dos relatorios ausente.");
assert(app.includes("reportGroup"), "Agrupamento por materias/conteudos nos relatorios ausente.");
assert(app.includes("activeQuestionEditId"), "Edicao de questoes ausente no estado.");
assert(app.includes("editLegalMaterial"), "Edicao de materiais de apoio ausente.");
assert(app.includes("renderLegalMaterialGroups"), "Separacao de leis, tabelas, anotacoes e imagens ausente.");
assert(app.includes("questionPrecisionRange"), "Estado do periodo de precisao ausente.");
assert(app.includes("renderQuestionReviewReminders"), "Renderizacao dos lembretes de revisao ausente.");
assert(app.includes("syncScopedTopicSelect(\"#questionSubject\", \"#questionTopic\""), "Assuntos de questoes nao estao vinculados a materia.");
assert(app.includes("[\"#questionSubject\", \"#questionTopic\", null, { includeEmpty: false }]"), "Evento de materia em questoes ausente.");
assert(app.includes("state.studyLogs = state.studyLogs.map((log) => (log.topicId === id"), "Estudos devem ser preservados na materia ao excluir assunto.");
assert(!app.includes("state.studyLogs = state.studyLogs.filter((log) => log.topicId !== id)"), "Excluir assunto nao pode apagar estudos registrados.");
assert(app.includes("function looksLikeLegalArticleText"), "Deteccao de texto juridico para evitar tabela automatica ausente.");
assert(app.includes("function parsePlainTextTableRows"), "Deteccao criteriosa de tabela em texto ausente.");
assert(app.includes("bindRichPasteGuards"), "Protecao de colagem em todos os editores ricos ausente.");
assert(app.includes("FORM_DRAFT_KEY_PREFIX"), "Rascunho local dos formularios ausente.");
assert(app.includes("STATE_BACKUP_KEY_PREFIX"), "Backup local defensivo do estado ausente.");
assert(app.includes("bindUnsavedDraftTracking"), "Monitoramento de rascunhos nao foi instalado.");
assert(app.includes("caseFormCourt"), "Tribunal do formulario de jurisprudencia nao foi separado da aba ativa.");
assert(app.includes("caseSearchScope"), "Escopo da busca de jurisprudencias ausente.");
assert(app.includes("activeCaseEditCourt"), "Edicao de jurisprudencia deve preservar o tribunal original.");
assert(app.includes("reportCompetitionId"), "Estado do filtro de relatorio por concurso ausente.");
assert(app.includes("function reportStudyLogMatchesCompetition"), "Filtro de estudos por concurso ausente.");
assert(app.includes("function reportQuestionLogMatchesCompetition"), "Filtro de questoes por concurso ausente.");
assert(app.includes("competitionFocusSubject"), "Revisao diaria nao sugere foco por concurso.");
assert(app.includes("staleSubject"), "Revisao diaria nao identifica materia sem estudo recente.");
assert(app.includes("downloadBackupFile();"), "Botao rapido de backup nao dispara download.");
assert(app.includes("function shouldPreferLocalSnapshot"), "Protecao contra sobrescrita por estado remoto antigo ausente.");
assert(app.includes("function getLocalProfileSnapshot"), "Leitura de copia local do perfil ausente.");
assert(app.includes("function scheduleRemoteSaveRetry"), "Retentativa automatica de salvamento remoto ausente.");
assert(app.includes("function persistBeforePageExit"), "Salvamento defensivo ao sair da pagina ausente.");
assert(app.includes("function syncTimerWithClock"), "Pomodoro nao sincroniza pelo relogio real.");
assert(app.includes("function applyTimerElapsed"), "Pomodoro nao aplica tempo real acumulado.");
assert(app.includes("lastTickAt"), "Checkpoint do Pomodoro nao guarda o ultimo instante contado.");
assert(app.includes('document.visibilityState === "hidden"'), "Pomodoro nao trata ocultacao/retorno da pagina.");
assert(app.includes("LOCAL_NEWER_GRACE_MS"), "Margem de comparacao local/remoto ausente.");
assert(app.includes("REMOTE_SAVE_MAX_RETRIES"), "Limite de retentativas remotas ausente.");
assert(app.includes("localSavedAt"), "Carimbo interno de salvamento local ausente.");
assert(app.includes("MEANINGFUL_STATE_BACKUP_KEY_PREFIX"), "Backup local util contra estado vazio ausente.");
assert(app.includes("function stateHasMeaningfulData"), "Deteccao de estado com dados reais ausente.");
assert(app.includes("stateHasMeaningfulData(localSnapshot.state) && !stateHasMeaningfulData(remoteState)"), "Estado remoto vazio nao prioriza copia local com dados.");
assert(app.includes("Protecao ativada: o app bloqueou um envio vazio"), "Bloqueio de envio remoto vazio ausente.");
assert(app.includes("function getLocalRecoveryCandidates"), "Busca de backups locais no navegador ausente.");
assert(app.includes("function restoreLocalRecoveryCandidate"), "Restauracao de backup local ausente.");
assert(app.includes("data-action=\"restoreLocalRecovery\""), "Acao de restauracao local nao e renderizada.");
assert(app.includes("AUXILIARY_BACKUP_KEY_PREFIX"), "Chave do backup auxiliar local ausente.");
assert(app.includes("AUXILIARY_BACKUP_DB_NAME"), "Banco IndexedDB de backup auxiliar ausente.");
assert(app.includes("function writeAuxiliaryBackupSnapshot"), "Gravacao automatica do backup auxiliar ausente.");
assert(app.includes("writeAuxiliaryBackupSnapshot(serializedState, savedAt);"), "saveState nao dispara backup auxiliar automatico.");
assert(app.includes("function createAuxiliaryBackupNow"), "Criacao manual do backup auxiliar ausente.");
assert(app.includes("function getIndexedRecoveryCandidates"), "Leitura de backups auxiliares no IndexedDB ausente.");
assert(app.includes("POMODORO_CHECKPOINT_KEY_PREFIX"), "Chave de checkpoint do Pomodoro ausente.");
assert(app.includes("function writePomodoroCheckpoint"), "Pre-salvamento do Pomodoro ausente.");
assert(app.includes("function restorePomodoroCheckpoint"), "Recuperacao do Pomodoro interrompido ausente.");
assert(app.includes("restorePomodoroCheckpointOnce();"), "Recuperacao do Pomodoro nao esta ligada ao render.");
assert(app.includes("writePomodoroCheckpoint();\n  saveState({ syncRemote: false });"), "Fechamento da pagina nao grava checkpoint do Pomodoro antes do estado.");

assert(css.includes(".daily-review-grid"), "CSS do painel diario ausente.");
assert(css.includes(".account-status-row"), "CSS do status da conta ausente.");
assert(!css.includes(".searchable-select"), "CSS antigo do seletor customizado ainda existe.");
assert(css.includes(".topic-item-top"), "Layout novo dos assuntos nao foi aplicado.");
assert(css.includes(".subject-card-actions"), "Layout das acoes de materia nao foi aplicado.");
assert(css.includes("#logoutProfileBtn"), "Layout do painel de login nao foi ajustado.");
assert(css.includes(".external-import-preview"), "CSS do importador externo ausente.");
assert(css.includes(".competition-board"), "CSS da aba concursos ausente.");
assert(css.includes(".subject-color-palette"), "CSS da paleta de cores de materia ausente.");
assert(css.includes(".report-stacked-bar"), "CSS das barras empilhadas dos relatorios ausente.");
assert(css.includes(".report-legend-item"), "CSS da legenda de materias dos relatorios ausente.");
assert(css.includes("overflow: hidden"), "Grafico dos relatorios nao deve criar rolagem interna.");
assert(css.includes(".legal-material-group-title"), "CSS da separacao por tipo de material ausente.");
assert(css.includes(".review-reminder-card"), "CSS dos lembretes de revisao ausente.");
assert(css.includes(".backup-shortcut-panel"), "CSS do atalho de backup ausente.");
assert(css.includes(".report-filter-row"), "CSS do filtro de concurso em relatorios ausente.");
assert(css.includes(".pomodoro-save-status"), "CSS do status de pre-salvamento do Pomodoro ausente.");
assert(css.includes(".local-recovery-card"), "CSS dos cards de recuperacao local ausente.");

assert(aprovadoBookmarklet.startsWith("javascript:"), "Bookmarklet do Aprovado deve comecar com javascript:.");
assert(aprovadoBookmarklet.includes("estudos-track-external-study-v1"), "Bookmarklet do Aprovado nao gera schema esperado.");

assert(/enable row level security/i.test(sql), "RLS nao esta habilitado no SQL.");
assert(sql.includes("auth.uid() = user_id"), "Politicas por usuario ausentes no SQL.");
assert(/create trigger set_study_profiles_updated_at/i.test(sql), "Trigger de updated_at ausente.");

// Hoje, plano semanal, menu movel, reforco por desempenho e backup
const hoje = fs.readFileSync(path.join(root, "hoje.js"), "utf8");
execFileSync(process.execPath, ["--check", path.join(root, "hoje.js")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "hoje-tests.js")], { stdio: "inherit" });
assert(html.indexOf('src="ciclo.js') < html.indexOf('src="hoje.js') && html.indexOf('src="hoje.js') < html.indexOf('src="app.js'), "Ordem de carga deve ser ciclo.js, hoje.js, app.js.");
["hoje", "semana"].forEach((view) => {
  assert(html.includes(`id="${view}"`), `Aba ${view} ausente.`);
  assert(app.includes(`${view}: "`), `Titulo da aba ${view} ausente no app.js.`);
});
["todayTasks", "todayInsights", "todayBackup", "startDayBtn", "weekForm", "weekTable", "bottom-nav", "sidebarSheet", "menuToggleBtn", "backupDays", "cycleAutoWeak", "cycleWeakAccuracy"].forEach((id) => {
  assert(html.includes(`id="${id}"`) || html.includes(`class="${id}"`), `Elemento ${id} ausente.`);
});
assert(/<section class="view active" id="hoje"/.test(html), "Hoje deve ser a aba inicial.");
assert(!/<section class="view active" id="dashboard"/.test(html), "Apenas uma aba pode comecar ativa.");
assert((html.match(/<section class="view active"/g) || []).length === 1, "Mais de uma aba marcada como ativa.");
// toda aba precisa de um botao de navegacao no menu agrupado
const viewIds = [...html.matchAll(/<section class="view(?: active)?" id="([a-z]+)"/g)].map((match) => match[1]);
viewIds.forEach((id) => assert(html.includes(`class="nav-button${id === "hoje" ? " active" : ""}" data-view="${id}"`), `Aba ${id} sem botao no menu.`));
assert(html.includes("nav-group-title"), "Menu agrupado ausente.");
assert((app.match(/view: "hoje"/g) || []).length === 2, "Estado novo deve abrir em Hoje.");
assert((app.match(/cycleMarkBackup/g) || []).length >= 2, "Backup e exportacao devem registrar a data do backup.");
assert(ciclo.includes("handleTodayAction") && ciclo.includes("todayAfterAction") && ciclo.includes("syncWeakRevisions"), "Ganchos do hoje.js ausentes no ciclo.js.");
assert(css.includes(".bottom-nav") && css.includes(".today-card") && css.includes(".week-table") && css.includes("body.profile-locked .bottom-nav"), "Estilos do menu movel/Hoje ausentes.");
assert(!hoje.split("\n").some((line) => /^\s*(const|let)\s+state\b/.test(line)), "hoje.js nao deve redeclarar state.");

// Push real, registro rapido, flashcards no Hoje, agenda com etapas futuras e CI
const pushJs = fs.readFileSync(path.join(root, "push.js"), "utf8");
execFileSync(process.execPath, ["--check", path.join(root, "push.js")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "push-tests.js")], { stdio: "inherit" });
assert(html.indexOf('src="hoje.js') < html.indexOf('src="push.js') && html.indexOf('src="push.js') < html.indexOf('src="app.js'), "Ordem de carga deve ser ciclo.js, hoje.js, push.js, app.js.");
["pushStatus", "pushToggleBtn", "pushTestBtn", "quickStudyForm", "quickStudyBtn", "qsSubject", "qsMinutes"].forEach((id) => assert(html.includes(`id="${id}"`), `Elemento #${id} ausente.`));
assert(html.includes('data-nav-count="flashcards"'), "Contador de flashcards ausente no menu.");
assert(fs.readFileSync(path.join(root, "sw.js"), "utf8").includes('addEventListener("push"'), "sw.js sem tratamento do evento push.");
assert(/vapidPublicKey\s*:/.test(fs.readFileSync(path.join(root, "supabase-config.js"), "utf8")), "supabase-config.js sem o campo vapidPublicKey.");
const pushSql = fs.readFileSync(path.join(root, "supabase-push.sql"), "utf8");
["push_subscriptions", "reminder_digests"].forEach((table) => {
  assert(new RegExp(`alter table public\\.${table} enable row level security`, "i").test(pushSql), `RLS nao habilitado em ${table}.`);
  assert(pushSql.includes(`${table}_select_own`) && pushSql.includes(`${table}_delete_own`), `Politicas por usuario ausentes em ${table}.`);
});
assert(pushSql.includes("unique (user_id, endpoint)"), "Inscricao deve ser unica por usuario e endpoint.");
const fnSource = fs.readFileSync(path.join(root, "supabase", "functions", "send-reminders", "index.ts"), "utf8");
assert(fnSource.includes("x-cron-secret") && fnSource.includes("auth.getUser"), "Funcao deve validar o segredo do agendador ou o token do usuario.");
assert(!/service[_-]?role[^\n]*["'][A-Za-z0-9_-]{30,}["']/i.test(fnSource) && !/SERVICE_ROLE/.test(css + html + app + ciclo + hoje + pushJs), "A chave de servico nunca pode aparecer no navegador.");
assert(!/VAPID_PRIVATE|BEGIN PRIVATE KEY/.test(css + html + app + ciclo + hoje + pushJs + fs.readFileSync(path.join(root, "supabase-config.js"), "utf8")), "Chave privada VAPID no codigo do navegador.");
assert(ciclo.includes("cycleProjectStages") && ciclo.includes("cycleCalendarGroups"), "Agenda com etapas futuras ausente.");
assert(hoje.includes("quickStudyForm") && hoje.includes("getFlashDueCount") && hoje.includes('"flash"'), "Registro rapido ou flashcards no Hoje ausentes.");
assert(app.includes('todayAfterAction("flash")'), "Fluxo guiado nao e acionado pelos flashcards.");
assert(fs.existsSync(path.join(root, "PUSH-SETUP.md")), "PUSH-SETUP.md ausente.");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert(pkg.scripts.test && pkg.scripts["test:e2e"], "Scripts de teste ausentes no package.json.");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "tests.yml"), "utf8");
assert(workflow.includes("npm test") && workflow.includes("npm run test:e2e") && workflow.includes("playwright install"), "Workflow de testes incompleto.");
["server.js", "helpers.js", "run-all.js", "ciclo.e2e.js", "lembretes.e2e.js", "hoje.e2e.js"].forEach((file) => assert(fs.existsSync(path.join(__dirname, "e2e", file)), `tests/e2e/${file} ausente.`));

// Salvar o que foi estudado ao terminar o foco (matéria e assunto criados na hora)
const sessao = fs.readFileSync(path.join(root, "sessao.js"), "utf8");
execFileSync(process.execPath, ["--check", path.join(root, "sessao.js")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "sessao-tests.js")], { stdio: "inherit" });
assert(html.indexOf('src="push.js') < html.indexOf('src="sessao.js') && html.indexOf('src="sessao.js') < html.indexOf('src="app.js'), "Ordem de carga deve terminar em push.js, sessao.js, app.js.");
["sessionModal", "sessionForm", "ssSubject", "ssTopic", "ssNewSubject", "ssNewTopic", "ssMinutes", "sessionBar", "askAtSave", "studyNewTopic", "qsNewTopic"].forEach((id) => assert(html.includes(`id="${id}"`), `Elemento #${id} ausente.`));
assert(app.includes("sessionAskBeforeSave") && app.includes("sessionApplyTypedTopic"), "app.js nao pergunta o que foi estudado ao terminar o foco.");
assert(!app.includes("Cadastre e selecione uma matéria para usar o Pomodoro."), "O Pomodoro nao pode mais exigir a materia antes de iniciar.");
assert(ciclo.includes("handleSessionAction") && ciclo.includes("bindSessionEvents") && ciclo.includes("renderSessionUI"), "Ganchos do sessao.js ausentes no ciclo.js.");
assert(css.includes(".modal-backdrop") && css.includes("body.modal-open"), "Estilos da janela de sessao ausentes.");
assert(/\.toast\s*\{\s*z-index:\s*100/.test(css), "O aviso (toast) precisa ficar acima da janela.");
assert(fs.existsSync(path.join(__dirname, "e2e", "sessao.e2e.js")), "tests/e2e/sessao.e2e.js ausente.");
assert(fs.readFileSync(path.join(__dirname, "e2e", "run-all.js"), "utf8").includes("sessao.e2e.js"), "run-all.js nao inclui o roteiro da sessao.");

console.log("Smoke tests OK: estrutura principal validada.");
