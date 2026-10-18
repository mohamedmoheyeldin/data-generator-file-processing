const fs = require("fs");
const os = require("os");
const { randomUUID } = require("crypto");
const { Worker } = require("worker_threads");
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const path = require("path");
const backend = require("./backend");

let mainWindow;
const activeJobs = new Map();
const APP_USER_MODEL_ID = "com.example.datageneratorfileprocessing";
const BACKGROUND_COMMANDS = new Set(["inspect-source", "inspect-leie-source", "process", "process-leie", "generate", "generate-manifest", "retry-upload", "test-upload-target"]);
const CANCELLABLE_COMMANDS = new Set(["process", "process-leie", "generate", "generate-manifest", "retry-upload", "test-upload-target"]);

process.env.DGFP_IS_PACKAGED = app.isPackaged ? "1" : "0";
process.env.DGFP_BUNDLE_ROOT = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
process.env.DGFP_RUNTIME_ROOT = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, "..");

function assertTrustedSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("Request rejected because it did not come from the application window.");
  }
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function getWindowsIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icons", "app_icon.ico")
    : path.join(__dirname, "..", "assets", "icons", "app_icon.ico");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 640,
    backgroundColor: "#ececec",
    icon: getWindowsIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.argv.includes("--smoke-test")) {
    mainWindow.webContents.once("did-finish-load", runPackagedSmokeTest);
  }
}

async function runPackagedSmokeTest() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-installed-smoke-"));
  const resultPath = String(process.env.DGFP_SMOKE_RESULT_PATH || "").trim();
  let exitCode = 0;
  let resultPayload = { ok: true };
  try {
    const result = await runBackgroundCommand(mainWindow.webContents, "generate", {
      outputDir,
      replacementCode: "installed_smoke",
      archiveBasename: "installed_smoke_archive",
      clearOutput: true,
      keepProcessedJson: false,
      fileCount: 1,
      referralsPerFile: 1,
      patientIdSettings: { mode: "test-dynamic" },
      identityOptions: { randomizeSsn: true, randomizeDob: true, matchSuffixLength: 5 },
      optionalOverrides: {},
      upload: { enabled: false, targets: [] },
    });
    if (!result?.archivePath || result?.manifestPath) throw new Error("Background generation must return an archive without an automatic manifest.");
    if (!fs.existsSync(result.archivePath) || !fs.readdirSync(outputDir).some((name) => /^installed_smoke_archive_\d{8}_\d{6}\.gz$/.test(name))) {
      throw new Error("Smoke archive was not created.");
    }
    const exported = await backend.handleCommand("generate-manifest", { runId: result.run.runId });
    if (!fs.existsSync(exported.manifestPath)) throw new Error("Requested manifest was not created.");
  } catch (error) {
    console.error("Installed application smoke test failed.", error);
    exitCode = 1;
    resultPayload = { ok: false, error: error?.stack || error?.message || String(error) };
  } finally {
    if (resultPath) {
      fs.writeFileSync(resultPath, `${JSON.stringify(resultPayload, null, 2)}\n`, "utf8");
    }
    fs.rmSync(outputDir, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

function runBackendCommand(webContents, command, payload = {}) {
  return backend.handleCommand(command, payload, (current, total, filename, state, uploadTarget, detail) => {
    if (current && typeof current === "object") {
      webContents.send("backend:event", { type: "progress", ...current });
      return;
    }
    webContents.send("backend:event", {
      type: "progress",
      current,
      total,
      filename,
      state,
      uploadTarget: uploadTarget || null,
      detail: detail || null,
    });
  });
}

function runBackgroundCommand(webContents, command, payload = {}) {
  const jobId = randomUUID();
  const preparedPayload = backend.prepareBackgroundPayload(command, payload);
  const workerPath = path.join(
    app.isPackaged ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`) : __dirname,
    "backend",
    "jobWorker.js"
  );
  const worker = new Worker(workerPath, {
    workerData: { command, payload: preparedPayload },
    env: {
      ...process.env,
      NODE_PATH: [
        app.isPackaged ? path.join(process.resourcesPath, "app.asar", "node_modules") : "",
        process.env.NODE_PATH || "",
      ].filter(Boolean).join(path.delimiter),
    },
  });

  return new Promise((resolve, reject) => {
    const job = { jobId, command, worker, webContentsId: webContents.id, cancelled: false, settled: false };
    activeJobs.set(jobId, job);

    const finish = (callback, value) => {
      if (job.settled) return;
      job.settled = true;
      activeJobs.delete(jobId);
      callback(value);
    };

    worker.on("message", (message) => {
      if (message?.type === "progress" && !webContents.isDestroyed()) {
        webContents.send("backend:event", { ...message, jobId });
      } else if (message?.type === "result") {
        finish(resolve, message.result);
      } else if (message?.type === "error") {
        finish(reject, new Error(message.error || "Background job failed."));
      }
    });
    worker.on("error", (error) => finish(reject, error));
    worker.on("exit", (code) => {
      if (job.cancelled) finish(reject, new Error("Operation cancelled safely. Completed output from earlier runs was not changed."));
      else if (code !== 0) finish(reject, new Error(`Background job exited with code ${code}.`));
      else if (!job.settled) finish(reject, new Error("Background job exited before returning a result."));
    });
  });
}

function cancelLatestJob(webContentsId) {
  const candidates = [...activeJobs.values()].filter(
    (job) => job.webContentsId === webContentsId && CANCELLABLE_COMMANDS.has(job.command)
  );
  const job = candidates.at(-1);
  if (!job) return false;
  job.cancelled = true;
  void job.worker.terminate();
  return true;
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return callback(event, ...args);
  });
}

handle("dialog:pick-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? "" : result.filePaths[0];
});

handle("dialog:pick-file", async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters,
  });
  return result.canceled ? "" : result.filePaths[0];
});

handle("shell:open-path", async (_event, targetPath) => {
  if (!targetPath) {
    return "";
  }
  const normalizedPath = path.resolve(String(targetPath));
  if (!fs.existsSync(normalizedPath)) throw new Error("The requested path does not exist.");
  return shell.openPath(normalizedPath);
});

handle("shell:open-external", async (_event, targetUrl) => {
  const normalizedUrl = String(targetUrl || "").trim();
  if (!isAllowedExternalUrl(normalizedUrl)) throw new Error("Only trusted HTTPS links can be opened.");
  await shell.openExternal(normalizedUrl);
  return true;
});

handle("backend:info", async (event) => runBackendCommand(event.sender, "info"));
handle("backend:inspect-source", async (event, payload) =>
  runBackgroundCommand(event.sender, "inspect-source", payload)
);
handle("backend:inspect-leie-source", async (event, payload) =>
  runBackgroundCommand(event.sender, "inspect-leie-source", payload)
);
handle("backend:preview", async (event, payload) => runBackendCommand(event.sender, "preview", payload));
handle("backend:save-ui-settings", async (event, payload) =>
  runBackendCommand(event.sender, "save-ui-settings", payload)
);
handle("backend:acknowledge-release-announcement", async (event, payload) =>
  runBackendCommand(event.sender, "acknowledge-release-announcement", payload)
);
handle("backend:import-upload-source", async (event, payload) =>
  runBackendCommand(event.sender, "import-upload-source", payload)
);
handle("backend:export-diagnostics", async (event, payload) =>
  runBackendCommand(event.sender, "export-diagnostics", payload)
);
handle("backend:test-upload-target", async (event, payload) =>
  runBackgroundCommand(event.sender, "test-upload-target", payload)
);
handle("backend:run", async (event, payload) => {
  if (!BACKGROUND_COMMANDS.has(payload.command)) throw new Error(`Unsupported background command: ${payload.command}`);
  return runBackgroundCommand(event.sender, payload.command, payload.data);
});
handle("backend:cancel", async (event) => ({ cancelled: cancelLatestJob(event.sender.id) }));

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  try {
    backend.cleanupStaleRuntimeArtifacts();
  } catch (error) {
    console.error("Unable to clean stale runtime artifacts.", error);
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
}).then(() => {
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  for (const job of activeJobs.values()) void job.worker.terminate();
  try {
    backend.cleanupRuntimeArtifacts();
  } catch (error) {
    console.error("Unable to clean runtime artifacts before quit.", error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
