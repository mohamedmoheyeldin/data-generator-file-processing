const fs = require("node:fs");
const { codes } = require("./paymentAuthorityCatalog");
const { loadFacilityOptions } = require("./facilityCatalog");
const { getCarePackageOptions, getSituationalCarePackageOptions } = require("./referralGenerator");
const { NETWORK_VALUES } = require("./contentEditor");

function validateOutputFiles(files, options = {}, overrides = {}) {
  const facilities = new Set(options.selectedFacilityIds?.length && !options.randomizeFacilityId
    ? options.selectedFacilityIds : overrides.facilityId ? [overrides.facilityId] : loadFacilityOptions().map((item) => item.facilityKey));
  const payments = new Set(options.useAllPaymentCodes ? codes : options.selectedPaymentCodes?.length
    ? options.selectedPaymentCodes : overrides.paymentAuthorityCode ? [overrides.paymentAuthorityCode] : codes);
  const networks = new Set(options.selectedNetworks?.length ? options.selectedNetworks : NETWORK_VALUES);
  const pairKey = (key, id) => `${key}\u0000${id}`;
  const regular = new Set((options.selectedCarePackagePairs?.length ? options.selectedCarePackagePairs : getCarePackageOptions()).map((item) => pairKey(item.carePackageKey, item.carePackageId)));
  const situational = new Set((options.selectedSituationalCarePackagePairs?.length ? options.selectedSituationalCarePackagePairs : getSituationalCarePackageOptions()).map((item) => pairKey(item.carePackageKey, item.carePackageId)));
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const allowed = { facilityId: facilities, paymentAuthorityCode: payments, network: networks }[key];
      if (allowed && !allowed.has(String(value))) throw new Error(`Output validation: ${key} is outside the selected reference values.`);
      visit(value);
    }
    if (node.carePackageKey && node.carePackageId && !regular.has(pairKey(node.carePackageKey, node.carePackageId))) throw new Error("Output validation: Care Package Number and ID must match an approved pair.");
    if (node.situationalCarePackageKey && node.situationalCarePackageId && !situational.has(pairKey(node.situationalCarePackageKey, node.situationalCarePackageId))) throw new Error("Output validation: Situational Care Package Number and ID must match an approved pair.");
  }
  for (const file of files) visit(JSON.parse(fs.readFileSync(file, "utf8")));
}
module.exports = { validateOutputFiles };
