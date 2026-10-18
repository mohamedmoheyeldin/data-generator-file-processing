const fs = require("node:fs");
const { bundlePath } = require("./appPaths");

// Configured reference list of synthetic Payment Authority Codes (config/payment_authority_codes.json).
const codes = Object.freeze([...new Set(JSON.parse(fs.readFileSync(
  bundlePath("config", "payment_authority_codes.json"), "utf8"
)))]);
function validatePaymentCode(value) {
  const code = String(value ?? "").trim();
  if (code && !codes.includes(code)) throw new Error("Choose a Payment Authority Code from the configured reference list.");
  return code;
}
function applyPaymentCodes(data, identityOptions = {}, override = "") {
  const selected = identityOptions.useAllPaymentCodes ? codes
    : identityOptions.selectedPaymentCodes?.length ? identityOptions.selectedPaymentCodes
    : override ? [override] : codes;
  const values = [...new Set(selected.map(validatePaymentCode))].filter(Boolean);
  if (!values.length) throw new Error("No Payment Authority Codes are available.");
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "paymentAuthorityCode") node[key] = values[Math.floor(Math.random() * values.length)];
      else visit(value);
    }
  }
  visit(data);
}
module.exports = { codes, validatePaymentCode, applyPaymentCodes };
