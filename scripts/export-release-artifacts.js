const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MIN_WINDOWS_EXE_BYTES = 1024 * 1024;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sanitizeWindowsFileNameSegment(value, fallbackValue) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || fallbackValue;
}

function getDisplayVersion(appVersionConfig, packageJson) {
  return sanitizeWindowsFileNameSegment(appVersionConfig.label, packageJson.version);
}

function isLikelyGitLfsPointer(filePath) {
  const sample = fs.readFileSync(filePath, "utf8").slice(0, 200);
  return sample.includes("https://git-lfs.github.com/spec/v1");
}

function isRealWindowsExecutable(filePath, minimumBytes = MIN_WINDOWS_EXE_BYTES) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const stats = fs.statSync(filePath);
  if (stats.size < minimumBytes) {
    return false;
  }

  const header = fs.readFileSync(filePath);
  if (header.length < 2) {
    return false;
  }

  return header[0] === 0x4d && header[1] === 0x5a;
}

function ensureVerifiedExecutable(filePath, displayName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${displayName}: ${filePath}`);
  }

  if (isLikelyGitLfsPointer(filePath)) {
    throw new Error(`Refusing to export ${displayName} because it is a Git LFS pointer: ${filePath}`);
  }

  if (!isRealWindowsExecutable(filePath)) {
    throw new Error(
      `Refusing to export ${displayName} because it is not a verified Windows executable larger than ${MIN_WINDOWS_EXE_BYTES} bytes: ${filePath}`
    );
  }
}

function resolveReleasePaths(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const workRoot = path.resolve(
    options.workRoot ||
      process.env.DGFP_RELEASE_WORK_DIR ||
      path.join(os.tmpdir(), "data-generator-file-processing-release")
  );

  return {
    repoRoot,
    workRoot,
    distRoot: path.resolve(options.distRoot || path.join(workRoot, "dist")),
    releaseRoot: path.resolve(options.releaseRoot || path.join(workRoot, "publish")),
  };
}

function buildArtifactList(repoRoot, distRoot, releaseRoot) {
  const packageJson = readJson(path.join(repoRoot, "package.json"));
  const appVersionConfig = readJson(path.join(repoRoot, "config", "app_version.json"));
  const appVersion = String(packageJson.version || "").trim();
  const displayVersion = getDisplayVersion(appVersionConfig, packageJson);

  return {
    artifacts: [
      {
        sourcePath: path.join(distRoot, `Data Generator & File Processing Setup ${appVersion}.exe`),
        destinationPath: path.join(releaseRoot, `Data Generator & File Processing Setup ${displayVersion}.exe`),
        displayName: "setup release executable",
      },
    ],
    appVersion,
    displayVersion,
    releaseRoot,
  };
}

function exportReleaseArtifacts(options = {}) {
  const { repoRoot, distRoot, releaseRoot } = resolveReleasePaths(options);
  const { artifacts, displayVersion } = buildArtifactList(repoRoot, distRoot, releaseRoot);

  for (const artifact of artifacts) {
    ensureVerifiedExecutable(artifact.sourcePath, artifact.displayName);
  }

  fs.rmSync(releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(releaseRoot, { recursive: true });

  for (const artifact of artifacts) {
    fs.copyFileSync(artifact.sourcePath, artifact.destinationPath);
  }

  return {
    displayVersion,
    releaseRoot,
    exportedPaths: artifacts.map((artifact) => artifact.destinationPath),
  };
}

if (require.main === module) {
  try {
    const result = exportReleaseArtifacts();

    console.log(`Exported setup release artifact to ${result.releaseRoot}`);
    for (const exportedPath of result.exportedPaths) {
      console.log(` - ${path.relative(process.cwd(), exportedPath)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  exportReleaseArtifacts,
  getDisplayVersion,
  isRealWindowsExecutable,
  resolveReleasePaths,
  sanitizeWindowsFileNameSegment,
};
