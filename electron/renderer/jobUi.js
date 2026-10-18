(function exposeJobUi(globalObject) {
  function syncWorkflowProgress(statusLabel = "Idle", phase = "") {
    const normalized = String(statusLabel).toLowerCase();
    const normalizedPhase = String(phase || "").toLowerCase();
    let activeStep = normalizedPhase === "upload" ? 4
      : normalizedPhase === "packaging" || normalizedPhase === "processing" ? 3
        : normalizedPhase === "preflight" || normalizedPhase === "validation" ? 2
          : normalizedPhase === "configuration" ? 1
            : normalized.includes("upload") || normalized.includes("uploaded") || normalized.includes("testing connection") ? 4
      : normalized.includes("process") || normalized.includes("generat") || normalized.includes("working") || normalized.includes("packag") || normalized.includes("archive") ? 3
        : normalized.includes("valid") || normalized.includes("duplicate") || normalized.includes("scanning") ? 2
          : normalized.includes("config") || normalized.includes("import") ? 1
            : 0;
    if (normalized.includes("complete") || normalized.includes("ready to save")) activeStep = 4;
    const steps = [...document.querySelectorAll("[data-workflow-step]")];
    steps.forEach((step, index) => {
      step.classList.toggle("is-complete", index < activeStep || normalized.includes("complete"));
      step.classList.toggle("is-active", index === activeStep && !normalized.includes("complete"));
    });
  }

  function updateProgress({ progressElement, progressWrap, progressLabel, progressValue, active, current = 0, total = 0 }) {
    if (!progressElement) return;
    const hasProgress = Number(total) > 0;
    const safeTotal = Math.max(Number(total) || 0, 0);
    const safeCurrent = Math.min(Math.max(Number(current) || 0, 0), safeTotal || Number.MAX_SAFE_INTEGER);
    progressWrap?.classList.toggle("hidden", !active);

    if (!active) {
      progressElement.removeAttribute("value");
      if (progressLabel) progressLabel.textContent = "";
      if (progressValue) progressValue.textContent = "";
      return;
    }

    if (hasProgress) {
      const percent = Math.min(100, Math.round((safeCurrent / safeTotal) * 100));
      progressElement.max = safeTotal;
      progressElement.value = safeCurrent;
      progressElement.setAttribute("aria-valuetext", `${safeCurrent} of ${safeTotal}, ${percent}% complete`);
      if (progressLabel) progressLabel.textContent = `${safeCurrent.toLocaleString()} of ${safeTotal.toLocaleString()} finished`;
      if (progressValue) progressValue.textContent = `${percent}%`;
      return;
    }

    progressElement.removeAttribute("value");
    progressElement.setAttribute("aria-valuetext", "Work is in progress");
    if (progressLabel) progressLabel.textContent = "Working — keep the app open...";
    if (progressValue) progressValue.textContent = "In progress";
  }

  function updateBusyControls({ busy, cancellable, cancelRequested, cancelButton }) {
    for (const element of document.querySelectorAll("button, input, select")) {
      if (element.dataset.allowWhileBusy === "true") continue;
      element.disabled = busy;
    }
    cancelButton?.classList.toggle("hidden", !cancellable);
    if (cancelButton) cancelButton.disabled = !cancellable || cancelRequested;
  }

  globalObject.dgfpJobUi = { syncWorkflowProgress, updateBusyControls, updateProgress };
})(window);
