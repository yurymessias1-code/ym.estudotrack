const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "app.js");
const htmlPath = path.join(root, "index.html");
const cssPath = path.join(root, "styles.css");
const sqlPath = path.join(root, "supabase-schema.sql");

const app = fs.readFileSync(appPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const sql = fs.readFileSync(sqlPath, "utf8");

execFileSync(process.execPath, ["--check", appPath], { stdio: "inherit" });

assert(html.includes("dailyReviewList"), "Painel diario nao encontrado no HTML.");
assert(html.includes("editalManualForm"), "Formulario manual do edital nao encontrado.");
assert(html.includes("accountStatusList"), "Status da conta nao encontrado.");
assert(html.includes("20260708-auth-polish"), "Cache do HTML nao foi atualizado para polimento de autenticacao.");
assert(html.includes("cancelSubjectEditBtn"), "Cancelamento de edicao de materia ausente.");
assert(html.includes("cancelTopicEditBtn"), "Cancelamento de edicao de assunto ausente.");

assert(app.includes("function renderDailyReview"), "renderDailyReview ausente.");
assert(!app.includes("searchable-select"), "Seletores customizados nao devem existir no JS.");
assert(app.includes("function deleteCurrentProfileData"), "Exclusao de dados da conta ausente.");
assert(app.includes("deleteEditalItem"), "Remocao individual de item do edital ausente.");
assert(app.includes("email: user.email"), "Sincronizacao do e-mail no Supabase ausente.");
assert(app.includes("editSubject"), "Edicao de materias ausente.");
assert(app.includes("editTopic"), "Edicao de assuntos ausente.");
assert(app.includes("isStrongOnlinePassword"), "Validacao de senha forte online ausente.");
assert(app.includes("Brevo bloqueou"), "Mensagem amigavel de SMTP/Brevo ausente.");

assert(css.includes(".daily-review-grid"), "CSS do painel diario ausente.");
assert(css.includes(".account-status-row"), "CSS do status da conta ausente.");
assert(!css.includes(".searchable-select"), "CSS antigo do seletor customizado ainda existe.");
assert(css.includes(".topic-item-top"), "Layout novo dos assuntos nao foi aplicado.");
assert(css.includes(".subject-card-actions"), "Layout das acoes de materia nao foi aplicado.");
assert(css.includes("#logoutProfileBtn"), "Layout do painel de login nao foi ajustado.");

assert(/enable row level security/i.test(sql), "RLS nao esta habilitado no SQL.");
assert(sql.includes("auth.uid() = user_id"), "Politicas por usuario ausentes no SQL.");
assert(/create trigger set_study_profiles_updated_at/i.test(sql), "Trigger de updated_at ausente.");

console.log("Smoke tests OK: estrutura principal validada.");
