const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  exportReleaseArtifacts,
  resolveReleasePaths,
} = require("./export-release-artifacts");

function assertSafeTemporaryWorkRoot(workRoot, repoRoot) {
  const resolvedWorkRoot = path.resolve(workRoot);
  const forbiddenRoots = new Set([
    path.parse(resolvedWorkRoot).root,
    path.resolve(repoRoot),
    path.resolve(os.homedir()),
  ]);

  if (forbiddenRoots.has(resolvedWorkRoot)) {
    throw new Error(`Refusing to use unsafe release work directory: ${resolvedWorkRoot}`);
  }

  const relativeToRepo = path.relative(path.resolve(repoRoot), resolvedWorkRoot);
  if (relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo))) {
    throw new Error(`Release work directory must be outside the project: ${resolvedWorkRoot}`);
  }
}

function assertPathInsideWorkRoot(targetPath, workRoot) {
  const relativePath = path.relative(path.resolve(workRoot), path.resolve(targetPath));
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Release output must stay inside the temporary work directory: ${targetPath}`);
  }
}

function buildRelease(options = {}) {
  const paths = resolveReleasePaths(options);
  assertSafeTemporaryWorkRoot(paths.workRoot, paths.repoRoot);
  assertPathInsideWorkRoot(paths.distRoot, paths.workRoot);
  assertPathInsideWorkRoot(paths.releaseRoot, paths.workRoot);

  fs.rmSync(paths.distRoot, { recursive: true, force: true });
  fs.rmSync(paths.releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(paths.workRoot, { recursive: true });

  const electronBuilderCli = require.resolve("electron-builder/cli.js");
  const buildResult = spawnSync(
    process.execPath,
    [
      electronBuilderCli,
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
      `--config.directories.output=${paths.distRoot}`,
    ],
    {
      cwd: paths.repoRoot,
      env: process.env,
      stdio: "inherit",
    }
  );

  if (buildResult.error) {
    throw buildResult.error;
  }

  if (buildResult.status !== 0) {
    throw new Error(`electron-builder failed with exit code ${buildResult.status}`);
  }

  return exportReleaseArtifacts(paths);
}

if (require.main === module) {
  try {
    const result = buildRelease();
    console.log(`Prepared Setup installer for publishing in ${result.releaseRoot}`);
    for (const exportedPath of result.exportedPaths) {
      console.log(` - ${exportedPath}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  assertPathInsideWorkRoot,
  assertSafeTemporaryWorkRoot,
  buildRelease,
};
