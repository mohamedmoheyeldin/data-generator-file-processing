(function registerLeieSql(scope) {
  const LEIE_BATCH_ID_PLACEHOLDER = "LEIE0731202606153013";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildLeieValidationSql(batchIdRaw = "") {
    const normalizedBatchId = String(batchIdRaw || "").trim() || LEIE_BATCH_ID_PLACEHOLDER;
    const sqlBatchId = normalizedBatchId.replace(/'/g, "''");
    return [
      "Use referral_db;",
      "",
      "select * from etl_batch_log order by last_updated_date desc;-- First get the etl_batch_id",
      "",
      "Select File_Name, *",
      "from etl_batch_log",
      `where etl_batch_id = '${sqlBatchId}'`,
      "order by Start_date_time desc;",
      "",
      "select count(*)",
      "from dbo.provider_exclusion",
      `where etl_batch_id = '${sqlBatchId}';`,
      "",
      "Select count(*)",
      "from dbo.provider_exclusion",
      `where etl_batch_id <> '${sqlBatchId}'`,
      "  and is_current = 'Y';",
      "",
      "select * from dbo.provider_exclusion;",
    ].join("\n");
  }

  function highlightSql(sqlText) {
    const tokenPattern = /(--[^\n]*|'(?:''|[^'])*'|\b(?:USE|SELECT|FROM|WHERE|ORDER|BY|DESC|ASC|AND|OR|COUNT|AS|IS|NOT|NULL|DISTINCT|TOP)\b|\b\d+\b)/gim;
    let cursor = 0;
    let highlighted = "";

    for (const match of sqlText.matchAll(tokenPattern)) {
      highlighted += escapeHtml(sqlText.slice(cursor, match.index));
      const token = match[0];
      let tokenClass = "sql-number";
      if (token.startsWith("--")) {
        tokenClass = "sql-comment";
      } else if (token.startsWith("'")) {
        tokenClass = "sql-string";
      } else if (/^[A-Za-z]+$/.test(token)) {
        tokenClass = "sql-keyword";
      }
      highlighted += `<span class="${tokenClass}">${escapeHtml(token)}</span>`;
      cursor = match.index + token.length;
    }

    return highlighted + escapeHtml(sqlText.slice(cursor));
  }

  const api = {
    LEIE_BATCH_ID_PLACEHOLDER,
    buildLeieValidationSql,
    highlightSql,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (scope) {
    scope.dgfpLeieSql = api;
  }
})(typeof window !== "undefined" ? window : null);
