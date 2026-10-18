const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("./atomicFile");

const ENCRYPTED_FORMAT = "electron-safe-storage-v1";

function getSafeStorage() {
  try {
    const electron = require("electron");
    if (electron?.safeStorage?.isEncryptionAvailable?.()) return electron.safeStorage;
  } catch (_error) {
    // Electron APIs are intentionally unavailable in Node-only tests and workers.
  }
  return null;
}

function parseCredentialFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed?.format !== ENCRYPTED_FORMAT) {
    return { entries: Array.isArray(parsed) ? parsed : [parsed], encrypted: false };
  }

  const safeStorage = getSafeStorage();
  if (!safeStorage) {
    throw new Error("Saved upload credentials are encrypted and can only be opened by the installed application.");
  }
  const clearText = safeStorage.decryptString(Buffer.from(String(parsed.ciphertext || ""), "base64"));
  const entries = JSON.parse(clearText);
  return { entries: Array.isArray(entries) ? entries : [entries], encrypted: true };
}

function saveCredentialEntries(filePath, entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [entries];
  const safeStorage = getSafeStorage();
  const payload = safeStorage
    ? {
        format: ENCRYPTED_FORMAT,
        ciphertext: safeStorage.encryptString(JSON.stringify(normalizedEntries)).toString("base64"),
      }
    : normalizedEntries;
  writeFileAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return Boolean(safeStorage);
}

function migrateCredentialFile(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !getSafeStorage()) return false;
  const loaded = parseCredentialFile(filePath);
  if (loaded.encrypted) return false;
  saveCredentialEntries(filePath, loaded.entries);
  return true;
}

function importCredentialFile(sourcePath, destinationPath, removeSource = false) {
  const loaded = parseCredentialFile(sourcePath);
  saveCredentialEntries(destinationPath, loaded.entries);
  if (removeSource && path.resolve(sourcePath).toLowerCase() !== path.resolve(destinationPath).toLowerCase()) {
    fs.rmSync(sourcePath, { force: true });
  }
  return destinationPath;
}

module.exports = {
  ENCRYPTED_FORMAT,
  importCredentialFile,
  migrateCredentialFile,
  parseCredentialFile,
  saveCredentialEntries,
};
