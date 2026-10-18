const { parentPort, workerData } = require("worker_threads");
require("module").Module._initPaths();
const backend = require("./index");

function post(message) {
  parentPort?.postMessage(message);
}

async function run() {
  try {
    const result = await backend.handleCommand(
      workerData.command,
      workerData.payload || {},
      (current, total, filename, state, uploadTarget, detail) => {
        if (current && typeof current === "object") {
          post({ type: "progress", ...current });
          return;
        }
        post({ type: "progress", current, total, filename, state, uploadTarget, detail });
      }
    );
    post({ type: "result", result });
  } catch (error) {
    post({ type: "error", error: error?.message || "Background job failed." });
  }
}

run();
