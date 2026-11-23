// Sobe um servidor estático e roda os roteiros no navegador, um por vez.
const path = require("path");
const { spawn } = require("child_process");
const { startServer } = require("./server");

const SUITES = ["ciclo.e2e.js", "lembretes.e2e.js", "hoje.e2e.js", "sessao.e2e.js", "sync.e2e.js", "mesclar.e2e.js", "relatorios.e2e.js"];

function run(file, baseUrl) {
  // spawn assíncrono: o servidor roda neste processo e precisa continuar respondendo.
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: "inherit", env: { ...process.env, BASE_URL: baseUrl } });
    child.on("exit", (code) => resolve(code === 0));
  });
}

(async () => {
  const server = await startServer();
  let failed = 0;
  for (const file of SUITES) {
    console.log(`\n=== ${file} ===`);
    if (!(await run(file, server.url))) failed += 1;
  }
  server.close();
  console.log(failed ? `\n${failed} roteiro(s) falharam.` : "\nTodos os roteiros passaram.");
  process.exit(failed ? 1 : 0);
})();
