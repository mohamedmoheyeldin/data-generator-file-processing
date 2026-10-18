const REFERRAL_UPLOAD_TARGET_NAMES = Object.freeze(["SQA", "DEV", "PPD"]);
const LEIE_UPLOAD_TARGET_NAMES = Object.freeze(["SQA", "DEV", "PPD", "PROD"]);

function allowedUploadTargets(workflow = "referral") {
  return workflow === "leie" ? [...LEIE_UPLOAD_TARGET_NAMES] : [...REFERRAL_UPLOAD_TARGET_NAMES];
}

function assertUploadTargets(workflow, targets = []) {
  const allowed = new Set(allowedUploadTargets(workflow));
  const unsupported = (Array.isArray(targets) ? targets : [])
    .map((target) => String(target?.server_name || "").trim().toUpperCase())
    .filter((targetName) => targetName && !allowed.has(targetName));
  if (unsupported.length > 0) {
    const allowedList = [...allowed];
    const allowedLabel = allowedList.length > 2
      ? `${allowedList.slice(0, -1).join(", ")}, or ${allowedList.at(-1)}`
      : allowedList.join(" or ");
    throw new Error(
      `${workflow === "leie" ? "LEIE Data" : "Referral Files"} can be uploaded only to ${allowedLabel}. ` +
      `Remove ${[...new Set(unsupported)].join(", ")} and try again.`
    );
  }
}

module.exports = {
  LEIE_UPLOAD_TARGET_NAMES,
  REFERRAL_UPLOAD_TARGET_NAMES,
  allowedUploadTargets,
  assertUploadTargets,
};
