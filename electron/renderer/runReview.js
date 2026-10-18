(function exposeRunReview(globalObject) {
  let pendingResolver = null;

  function buildItems(command, payload, sourceInspection) {
    const uploads = (payload.upload?.enabled ? payload.upload.targets : []) || [];
    const total = command === "generate"
      ? Number(payload.fileCount || 0) * Number(payload.referralsPerFile || 0)
      : Number(sourceInspection?.fileCount || 0);
    const facilities = payload.identityOptions?.randomizeFacilityId
      ? "Random from all approved facilities"
      : (payload.identityOptions?.selectedFacilityIds || []).join(", ") || "Mix approved facility values";
    const referralPrefixMode = payload.identityOptions?.referralPrefixMode || "standard";
    const referralPrefix = referralPrefixMode === "alt"
      ? "ALT for every referral"
      : referralPrefixMode === "mixed"
        ? "Combined RF and ALT"
        : referralPrefixMode === "custom"
          ? `${payload.identityOptions?.customReferralPrefix || "Custom"} for every referral`
          : "RF for every referral";
    const items = [
      ["Workflow", command === "generate" ? "Generate Referral Files" : command === "process-leie" ? "Process LEIE Data" : "Process Referral Files"],
      ["Source", payload.inputDir || (command === "generate" ? "Built-in referral template" : "Not selected")],
      ["Output", payload.outputDir || "Not selected"],
      [command === "generate" ? "Total referrals" : "Source files", total.toLocaleString()],
      ["Output behavior", "Overwrite matching filenames after validation; preserve unrelated files"],
      ["Archive", command === "process-leie" ? payload.outputFileName || "Generated workbook name" : (document.querySelector("#archive-preview")?.textContent || "Gzip and selected JSON outputs")],
      ["Referral prefix", command === "process-leie" ? "Not applicable" : referralPrefix],
      ["Facilities", command === "process-leie" ? "Not applicable" : facilities],
      ["Upload destinations", uploads.length ? uploads.map((item) => `${item.server_name}: ${item.remote_directory}`).join("; ") : "Local output only"],
    ];
    const situationalCarePackageCount = payload.identityOptions?.useAllSituationalCarePackages
      ? "All Situational values"
      : (payload.identityOptions?.selectedSituationalCarePackageKeys || []).length;
    if (situationalCarePackageCount) {
      items.push([
        "Situational Care Package caution",
        `${situationalCarePackageCount} selected. Most referrals use regular Care Package only; confirm this Situational choice is required.`,
      ]);
    }
    const networkValues = payload.identityOptions?.selectedNetworks || [];
    items.push([
      "Network plan",
      networkValues.length === 1
        ? `${networkValues[0]} will be used for every referral.`
        : networkValues.length > 1
          ? `${networkValues.join(", ")} will be mixed across referrals.`
          : "Keep each referral's source Network automatically.",
    ]);
    return items;
  }

  function confirm({ command, payload, sourceInspection, elements }) {
    elements.summary.innerHTML = "";
    for (const [label, value] of buildItems(command, payload, sourceInspection)) {
      const item = document.createElement("div");
      item.className = "pre-run-summary-item";
      const strong = document.createElement("strong");
      strong.textContent = label;
      const span = document.createElement("span");
      span.textContent = value;
      item.append(strong, span);
      elements.summary.appendChild(item);
    }
    const needsProd = Boolean(payload.upload?.enabled && payload.upload.targets?.some((target) => String(target.server_name).toUpperCase() === "PROD"));
    elements.prodWrap.classList.toggle("hidden", !needsProd);
    elements.prodInput.value = "";
    elements.confirmButton.disabled = needsProd;
    elements.overlay.classList.remove("hidden");
    document.body.classList.add("modal-open");
    return new Promise((resolve) => {
      pendingResolver = resolve;
      window.requestAnimationFrame(() => (needsProd ? elements.prodInput : elements.confirmButton).focus());
    });
  }

  function close(elements, confirmed) {
    elements.overlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
    const resolve = pendingResolver;
    pendingResolver = null;
    resolve?.(Boolean(confirmed));
  }

  globalObject.dgfpRunReview = { buildItems, close, confirm };
})(window);
