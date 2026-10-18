const fs = require("fs");
const { userDataPath } = require("./appPaths");
const { writeFileAtomic } = require("./atomicFile");

const MAX_RUNS = 20;

function getRunHistoryPath() {
  return userDataPath("config", "run_history.json");
}

function sanitizeRun(run = {}) {
  return {
    runId: String(run.runId || "").trim(),
    createdAt: String(run.createdAt || new Date().toISOString()),
    status: String(run.status || "unknown"),
    workflow: String(run.workflow || "referral"),
    outputDir: String(run.outputDir || ""),
    archivePath: String(run.archivePath || ""),
    manifestPath: String(run.manifestPath || ""),
    manifestData: run.manifestData && typeof run.manifestData === "object" ? run.manifestData : null,
    processedCount: Math.max(Number(run.processedCount) || 0, 0),
    referralCount: Math.max(Number(run.referralCount) || 0, 0),
    uploadResults: (Array.isArray(run.uploadResults) ? run.uploadResults : []).map((item) => ({
      serverName: String(item.serverName || item.server_name || ""),
      userName: String(item.userName || item.user_name || ""),
      remoteDirectory: String(item.remoteDirectory || item.remote_directory || ""),
      remotePath: String(item.remotePath || item.remote_path || ""),
      status: String(item.status || "unknown"),
      message: String(item.message || ""),
    })),
  };
}

function loadRunHistory() {
  try {
    const filePath = getRunHistoryPath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return (Array.isArray(parsed) ? parsed : []).map(sanitizeRun).filter((run) => run.runId).slice(0, MAX_RUNS);
  } catch (_error) {
    return [];
  }
}

function saveRun(run) {
  const normalized = sanitizeRun(run);
  const history = [normalized, ...loadRunHistory().filter((item) => item.runId !== normalized.runId)].slice(0, MAX_RUNS);
  writeFileAtomic(getRunHistoryPath(), `${JSON.stringify(history, null, 2)}\n`, "utf8");
  return normalized;
}

function getRun(runId) {
  return loadRunHistory().find((run) => run.runId === String(runId || "")) || null;
}

module.exports = { getRun, getRunHistoryPath, loadRunHistory, saveRun };
