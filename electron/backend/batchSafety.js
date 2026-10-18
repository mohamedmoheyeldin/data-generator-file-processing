const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash, randomUUID } = require("crypto");

function stripWindowsExtendedPathPrefix(targetPath) {
  const value = String(targetPath || "");
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`;
  if (/^\\\\\?\\/i.test(value)) return value.slice(4);
  return value;
}

function canonicalPath(targetPath) {
  const resolved = path.resolve(String(targetPath || "").trim());
  let existingAncestor = resolved;
  const missingSegments = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  let canonical = existingAncestor;
  try {
    canonical = fs.realpathSync.native(existingAncestor);
  } catch (_error) {
    canonical = existingAncestor;
  }
  canonical = path.join(canonical, ...missingSegments);
  canonical = stripWindowsExtendedPathPrefix(canonical);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeFolderRelationship(inputDir, outputDir) {
  if (!String(inputDir || "").trim()) throw new Error("Please select a source folder.");
  if (!String(outputDir || "").trim()) throw new Error("Please select an output folder.");
  const input = canonicalPath(inputDir);
  const output = canonicalPath(outputDir);
  if (input === output) {
    throw new Error("The source and output folders must be different. Choose a separate output folder to protect the source files.");
  }
  if (isPathInside(input, output) || isPathInside(output, input)) {
    throw new Error("The source and output folders cannot be nested inside each other. Choose two separate folders.");
  }
  return { input, output };
}

function createRunStagingDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-referral-run-"));
}

function cleanupStaleRunStagingDirectories(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("dgfp-referral-run-")) continue;
    const target = path.join(os.tmpdir(), entry.name);
    try {
      if (now - fs.statSync(target).mtimeMs > maxAgeMs) fs.rmSync(target, { recursive: true, force: true });
    } catch (_error) {
      // Another app instance may still own the staging folder.
    }
  }
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listFileMetadata(folder, extension = "") {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!extension || entry.name.toLowerCase().endsWith(extension)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const filePath = path.join(folder, entry.name);
      return { name: entry.name, bytes: fs.statSync(filePath).size, sha256: sha256File(filePath) };
    });
}

function assertNoOutputCollisions(stagingDir, outputDir, names) {
  const collisions = names.filter((name) => fs.existsSync(path.join(outputDir, name)));
  if (collisions.length > 0) {
    throw new Error(
      `Keep existing files is enabled, but ${collisions.length} output name${collisions.length === 1 ? "" : "s"} already exist: ` +
      `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? ", ..." : ""}. Change the names or choose Replace folder contents after success.`
    );
  }
  for (const name of names) {
    const sourcePath = path.join(stagingDir, name);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`The staged output is missing: ${name}`);
    }
  }
}

function promoteStagedFiles(stagingDir, outputDir, names) {
  fs.mkdirSync(outputDir, { recursive: true });
  const backupDir = fs.mkdtempSync(path.join(stagingDir, "previous-"));
  const promoted = [];
  const backups = [];
  const uniqueNames = [...new Set(names)];
  for (const name of uniqueNames) {
    if (path.basename(name) !== name || !fs.statSync(path.join(stagingDir, name)).isFile()) {
      throw new Error(`Invalid staged filename: ${name}`);
    }
    const destination = path.join(outputDir, name);
    if (fs.existsSync(destination) && (!fs.lstatSync(destination).isFile() || fs.lstatSync(destination).isSymbolicLink())) {
      throw new Error(`Output destination is not a regular file: ${name}`);
    }
  }
  try {
    for (const name of uniqueNames) {
      const destination = path.join(outputDir, name);
      if (fs.existsSync(destination)) {
        const backup = path.join(backupDir, name);
        fs.copyFileSync(destination, backup);
        backups.push([backup, destination]);
      }
      promoted.push(destination);
      fs.copyFileSync(path.join(stagingDir, name), destination);
    }
  } catch (error) {
    for (const destination of promoted) fs.rmSync(destination, { force: true });
    for (const [backup, destination] of backups) fs.copyFileSync(backup, destination);
    throw error;
  }
  return promoted;
}

function createRunId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

module.exports = {
  assertNoOutputCollisions,
  assertSafeFolderRelationship,
  canonicalPath,
  cleanupStaleRunStagingDirectories,
  createRunId,
  createRunStagingDirectory,
  listFileMetadata,
  promoteStagedFiles,
  sha256File,
  stripWindowsExtendedPathPrefix,
};
