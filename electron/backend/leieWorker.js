const { parentPort, workerData } = require("worker_threads");
require("module").Module._initPaths();
const { inspectLeieSource } = require("./leieProcessor");

function post(payload) {
  if (parentPort) {
    parentPort.postMessage(payload);
  }
}

try {
  const task = workerData?.task || "";
  if (task !== "inspect") {
    throw new Error(`Unsupported LEIE worker task: ${task}`);
  }

  const payload = workerData?.payload || {};
  const result = inspectLeieSource(payload);
  post({ ok: true, result });
} catch (error) {
  post({
    ok: false,
    error: error?.message || "LEIE scan failed.",
  });
}
