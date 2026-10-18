const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../electron/backend/atomicFile");

const repoRoot = path.resolve(__dirname, "..");
const appVersionPath = path.join(repoRoot, "config", "app_version.json");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const DEFAULT_UNINSTALL_DISPLAY_PREFIX = "Data Generator & File Processing";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function deriveBuildVersion(label) {
  const match = String(label || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    throw new Error(`Unable to derive a build version from app label: ${label || "<empty>"}`);
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3] || "0";
  return `${major}.${minor}.${patch}`;
}

function resolveBuildVersion(appVersion) {
  const configuredVersion = String(appVersion.version || "").trim();
  if (configuredVersion) {
    return configuredVersion;
  }

  return deriveBuildVersion(appVersion.label);
}

const appVersion = readJson(appVersionPath);
const packageJson = readJson(packageJsonPath);
const packageLock = fs.existsSync(packageLockPath) ? readJson(packageLockPath) : null;
const derivedVersion = resolveBuildVersion(appVersion);
const displayLabel = String(appVersion.label || "").trim();
const uninstallDisplayName = displayLabel
  ? `${DEFAULT_UNINSTALL_DISPLAY_PREFIX} ${displayLabel}`
  : DEFAULT_UNINSTALL_DISPLAY_PREFIX;

let changed = false;

if (packageJson.version !== derivedVersion) {
  packageJson.version = derivedVersion;
  changed = true;
}

packageJson.build = packageJson.build || {};
packageJson.build.nsis = packageJson.build.nsis || {};
if (packageJson.build.nsis.uninstallDisplayName !== uninstallDisplayName) {
  packageJson.build.nsis.uninstallDisplayName = uninstallDisplayName;
  changed = true;
}

if (packageLock && packageLock.version !== derivedVersion) {
  packageLock.version = derivedVersion;
  changed = true;
}

if (packageLock && packageLock.packages && packageLock.packages[""] && packageLock.packages[""].version !== derivedVersion) {
  packageLock.packages[""].version = derivedVersion;
  changed = true;
}

if (changed) {
  writeJson(packageJsonPath, packageJson);
  if (packageLock) {
    writeJson(packageLockPath, packageLock);
  }
  console.log(`Synced build version to ${derivedVersion} from config/app_version.json.`);
} else {
  console.log(`Build version already synced at ${derivedVersion}.`);
}

