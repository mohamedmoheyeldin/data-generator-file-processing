const fs = require("fs");
const path = require("path");

function writeFileAtomic(targetPath, content, encoding = "utf8") {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, encoding);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

module.exports = {
  writeFileAtomic,
};
