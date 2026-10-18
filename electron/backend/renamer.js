const fs = require("fs");
const path = require("path");
const { bundlePath, dataPath } = require("./appPaths");

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]+/g;

function loadRules() {
  const runtimePath = dataPath("config", "rules.json");
  if (fs.existsSync(runtimePath)) {
    return JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  }

  const bundledPath = bundlePath("config", "rules.json");
  if (fs.existsSync(bundledPath)) {
    return JSON.parse(fs.readFileSync(bundledPath, "utf8"));
  }

  return { rename: [] };
}

function sanitizeFilenameBase(value) {
  let sanitized = (value || "").trim();
  if (!sanitized) {
    return "";
  }

  sanitized = sanitized.replace(/\.json$/i, "");
  sanitized = sanitized.replace(INVALID_FILENAME_CHARS, "_");
  return sanitized.replace(/^[ .]+|[ .]+$/g, "");
}

function renameFile(filePath, replacementCode, fileIndex, totalFiles) {
  const rules = loadRules();
  let filename = path.basename(filePath);

  if (replacementCode) {
    const sanitizedBase = sanitizeFilenameBase(replacementCode);
    if (sanitizedBase) {
      if (totalFiles && totalFiles > 1 && fileIndex != null) {
        return `${sanitizedBase}_${fileIndex}.json`;
      }
      return `${sanitizedBase}.json`;
    }
  }

  for (const rule of rules.rename || []) {
    if (filename.includes(rule.match)) {
      filename = filename.replace(rule.match, rule.replace);
    }
  }

  return `${path.parse(filename).name}.json`;
}

module.exports = {
  renameFile,
  sanitizeFilenameBase,
};
