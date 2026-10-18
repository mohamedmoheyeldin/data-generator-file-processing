(function registerUploadDefaults(scope) {
  const REFERRAL_DEFAULT_UPLOAD_DIRECTORY = "/referral_uploads";
  const LEIE_DEFAULT_UPLOAD_DIRECTORY = "/in/manual_process/";

  function resolveUploadDirectoryForWorkflow(value, mainTab, referralDefaultDirectory = "") {
    const referralDefault = String(referralDefaultDirectory || REFERRAL_DEFAULT_UPLOAD_DIRECTORY).trim();
    const currentValue = String(value || "").trim();

    if (mainTab === "leie") {
      if (!currentValue || currentValue === referralDefault || currentValue === REFERRAL_DEFAULT_UPLOAD_DIRECTORY) {
        return LEIE_DEFAULT_UPLOAD_DIRECTORY;
      }
      return currentValue;
    }

    if (!currentValue || currentValue === LEIE_DEFAULT_UPLOAD_DIRECTORY) {
      return referralDefault;
    }
    return currentValue;
  }

  const api = {
    LEIE_DEFAULT_UPLOAD_DIRECTORY,
    REFERRAL_DEFAULT_UPLOAD_DIRECTORY,
    resolveUploadDirectoryForWorkflow,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (scope) {
    scope.dgfpUploadDefaults = api;
  }
})(typeof window !== "undefined" ? window : null);
