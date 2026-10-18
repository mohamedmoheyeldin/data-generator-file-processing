const fs = require("fs");
const os = require("os");
const path = require("path");
const { log } = require("./logger");

const STARTUP_STALE_AGE_MS = 5 * 60 * 1000;
const trackedPaths = new Set();
const tempArtifactMatchers = [
  { prefix: "dgfp_referral_generator_", allowDirectory: true },
  { prefix: "winscp_upload_", suffix: ".txt" },
  { prefix: "winscp_test_", suffix: ".txt" },
];

function normalizePath(targetPath) {
  if (!targetPath) {
    return "";
  }
  return path.resolve(targetPath);
}

function registerTemporaryPath(targetPath) {
  const normalizedPath = normalizePath(targetPath);
  if (normalizedPath) {
    trackedPaths.add(normalizedPath);
  }
  return normalizedPath;
}

function unregisterTemporaryPath(targetPath) {
  const normalizedPath = normalizePath(targetPath);
  if (normalizedPath) {
    trackedPaths.delete(normalizedPath);
  }
  return normalizedPath;
}

function removePath(targetPath) {
  const normalizedPath = normalizePath(targetPath);
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    unregisterTemporaryPath(normalizedPath);
    return false;
  }

  try {
    fs.rmSync(normalizedPath, { recursive: true, force: true });
    trackedPaths.delete(normalizedPath);
    log("info", `Cleaned temporary runtime artifact: ${normalizedPath}`);
    return true;
  } catch (error) {
    log("warning", `Unable to clean temporary runtime artifact ${normalizedPath}: ${error.message}`);
    return false;
  }
}

function cleanupTrackedTemporaryPaths() {
  let removedCount = 0;
  for (const targetPath of [...trackedPaths]) {
    if (removePath(targetPath)) {
      removedCount += 1;
    }
  }
  return removedCount;
}

function matchesKnownArtifact(entry) {
  return tempArtifactMatchers.some((matcher) => {
    if (!entry.name.startsWith(matcher.prefix)) {
      return false;
    }
    if (matcher.suffix && !entry.name.endsWith(matcher.suffix)) {
      return false;
    }
    if (matcher.allowDirectory) {
      return true;
    }
    return entry.isFile();
  });
}

function cleanupKnownTemporaryArtifacts(options = {}) {
  const tempRoot = os.tmpdir();
  if (!fs.existsSync(tempRoot)) {
    return 0;
  }

  const minimumAgeMs = Number.isFinite(options.minimumAgeMs) ? Math.max(0, options.minimumAgeMs) : 0;
  const now = Date.now();
  let removedCount = 0;

  for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
    if (!matchesKnownArtifact(entry)) {
      continue;
    }

    const targetPath = path.join(tempRoot, entry.name);
    try {
      const stats = fs.statSync(targetPath);
      if (minimumAgeMs > 0 && now - stats.mtimeMs < minimumAgeMs) {
        continue;
      }
    } catch (_error) {
      continue;
    }

    if (removePath(targetPath)) {
      removedCount += 1;
    }
  }

  return removedCount;
}

function cleanupRuntimeArtifacts() {
  return cleanupTrackedTemporaryPaths() + cleanupKnownTemporaryArtifacts();
}

function cleanupStaleRuntimeArtifacts() {
  return cleanupKnownTemporaryArtifacts({ minimumAgeMs: STARTUP_STALE_AGE_MS });
}

module.exports = {
  cleanupRuntimeArtifacts,
  cleanupStaleRuntimeArtifacts,
  cleanupTrackedTemporaryPaths,
  cleanupKnownTemporaryArtifacts,
  registerTemporaryPath,
  removePath,
  unregisterTemporaryPath,
};
