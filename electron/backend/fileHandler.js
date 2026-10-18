const fs = require("fs");
const path = require("path");

function getFiles(directory) {
  if (!directory || !fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }))
    .map((entry) => path.join(directory, entry.name));
}

function saveFile(outputDir, filename, content) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, filename), content, "utf8");
}

function directoryHasContents(directory) {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length > 0;
}

function clearDirectory(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    fs.rmSync(path.join(directory, entry.name), { recursive: true, force: true });
  }
}

function removeJsonFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      fs.rmSync(path.join(directory, entry.name), { force: true });
    }
  }
}

module.exports = {
  clearDirectory,
  directoryHasContents,
  getFiles,
  removeJsonFiles,
  saveFile,
};
