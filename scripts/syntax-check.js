const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const roots = [path.join(projectRoot, "electron"), path.join(projectRoot, "scripts")];

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(entryPath);
  }
  return files;
}

const files = roots.flatMap(collectJavaScriptFiles).sort();
for (const filePath of files) {
  const result = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${filePath}\n`);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
