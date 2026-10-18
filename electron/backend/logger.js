const fs = require("fs");
const path = require("path");
const { dataPath } = require("./appPaths");

let logFilePath = "";
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_LOG_FILES = 3;

function rotateLogsIfNeeded() {
  if (!logFilePath || !fs.existsSync(logFilePath) || fs.statSync(logFilePath).size < MAX_LOG_BYTES) return;
  for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
    const source = `${logFilePath}.${index}`;
    const destination = `${logFilePath}.${index + 1}`;
    if (fs.existsSync(source)) fs.renameSync(source, destination);
  }
  fs.renameSync(logFilePath, `${logFilePath}.1`);
}

function redact(message) {
  return String(message || "")
    .replace(/(password|passphrase|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/([?&](?:token|key|password)=)[^&\s]+/gi, "$1[REDACTED]");
}

function setupLogger() {
  const logsDir = dataPath("logs");
  fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, "process.log");
}

function log(level, message) {
  if (!logFilePath) {
    setupLogger();
  }

  rotateLogsIfNeeded();
  const line = `${new Date().toISOString()} - ${level.toUpperCase()} - ${redact(message)}\n`;
  fs.appendFileSync(logFilePath, line, "utf8");
}

module.exports = {
  setupLogger,
  log,
};
