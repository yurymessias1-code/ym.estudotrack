// Abre o Chromium; capturas de tela só são salvas se SHOTS_DIR estiver definido.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function launchBrowser() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const shotsDir = process.env.SHOTS_DIR || "";
  const patch = (page) => {
    const original = page.screenshot.bind(page);
    page.screenshot = (options = {}) => {
      if (!shotsDir) return Promise.resolve();
      fs.mkdirSync(shotsDir, { recursive: true });
      return original({ ...options, path: path.join(shotsDir, path.basename(options.path || "captura.png")) });
    };
    return page;
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => patch(await newPage());
    return context;
  };
  return browser;
}

module.exports = { launchBrowser };
