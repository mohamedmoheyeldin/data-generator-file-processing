const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const SftpClient = require("ssh2-sftp-client");
const { userDataPath } = require("./appPaths");
const { writeFileAtomic } = require("./atomicFile");
const {
  importCredentialFile,
  migrateCredentialFile,
  parseCredentialFile,
  saveCredentialEntries,
} = require("./secureCredentials");

const WINSCP_INI_PATH = userDataPath("upload_import", "WinSCP.ini");
const CREDENTIALS_JSON_PATH = userDataPath("config", "upload_credentials.json");
const WINSCP_GENERATED_CREDENTIALS_PATH = userDataPath("upload_import", "winscp_credentials.json");
const UPLOAD_PROFILES_PATH = userDataPath("config", "upload_profiles.json");
const UPLOAD_SOURCE_MARKER_PATH = userDataPath("config", "upload_source_marker.json");
const SFTP_CONNECT_TIMEOUT_MS = 30_000;
const SFTP_OPERATION_TIMEOUT_MS = 10 * 60_000;
const SFTP_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_UPLOAD_ATTEMPTS = 1;

function summarizeUploadProfiles(profiles) {
  return {
    serverCount: (profiles?.servers || []).length,
    userCount: (profiles?.users || []).length,
    targetNames: (profiles?.servers || []).map((server) => server.name).filter(Boolean),
  };
}

function normalizeUploadTargetName(value) {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized.includes("PROD")) {
    return "PROD";
  }
  if (normalized.includes("SQA")) {
    return "SQA";
  }
  if (normalized.includes("DEV")) {
    return "DEV";
  }
  if (normalized.includes("PPD")) {
    return "PPD";
  }
  return normalized;
}

function inferUploadTargetName(...values) {
  const normalized = values
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase())
    .join(" ");

  if (!normalized) {
    return "";
  }

  const aliasGroups = {
    DEV: ["DEV", "DEVELOPMENT", "NONPROD", "NON-PROD", "SANDBOX"],
    PPD: ["PPD", "PREPROD", "PRE-PROD", "PRE PROD", "STAGE", "STAGING"],
    SQA: ["SQA", "QA", "TEST", "UAT"],
    PROD: ["PROD", "PRODUCTION", "LIVE"],
  };

  for (const [targetName, aliases] of Object.entries(aliasGroups)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return targetName;
    }
  }

  return normalizeUploadTargetName(normalized);
}

function inferServerName(sessionName, host) {
  const lastSegment = (sessionName || "").split("\\").slice(-1)[0];
  if (lastSegment.includes("@")) {
    return lastSegment.split("@", 2)[1].trim() || host;
  }
  if ((sessionName || "").includes("\\")) {
    return sessionName.split("\\", 1)[0].trim() || host;
  }
  const hostPrefix = (host || "").split(".", 1)[0].trim();
  return hostPrefix ? hostPrefix.toUpperCase() : host;
}

function getDefaultUploadTargets() {
  return ["SQA", "DEV", "PPD", "PROD"];
}

function getUploadTargetNames(profiles = {}) {
  const defaults = getDefaultUploadTargets();
  const discovered = new Set(defaults);

  for (const server of profiles.servers || []) {
    const normalized = normalizeUploadTargetName(server?.name || server?.target_name || "");
    if (normalized) {
      discovered.add(normalized);
    }
  }

  for (const user of profiles.users || []) {
    const normalized = normalizeUploadTargetName(user?.server || user?.target_name || "");
    if (normalized) {
      discovered.add(normalized);
    }
  }

  return [...discovered]
    .filter((name) => name)
    .sort((left, right) => {
      const leftIndex = defaults.indexOf(left);
      const rightIndex = defaults.indexOf(right);
      if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex;
      }
      if (leftIndex >= 0) {
        return -1;
      }
      if (rightIndex >= 0) {
        return 1;
      }
      return left.localeCompare(right);
    });
}

function getCandidateWinscpIniPaths() {
  return [...new Set([
    WINSCP_INI_PATH,
    userDataPath("upload_import", "winscp.ini"),
  ])];
}

function getCandidateCredentialsJsonPaths() {
  return [...new Set([
    CREDENTIALS_JSON_PATH,
    userDataPath("config", "winscp_credentials.json"),
  ])];
}

function getCandidateUploadProfilesPaths() {
  return [...new Set([
    UPLOAD_PROFILES_PATH,
  ])];
}

function loadUploadImportMarker() {
  try {
    if (!fs.existsSync(UPLOAD_SOURCE_MARKER_PATH)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(UPLOAD_SOURCE_MARKER_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      sourceKind: String(parsed.source_kind || parsed.sourceKind || "").trim(),
      sourcePath: String(parsed.source_path || parsed.sourcePath || "").trim(),
      importedAt: String(parsed.imported_at || parsed.importedAt || "").trim(),
    };
  } catch (_error) {
    return null;
  }
}

function saveUploadImportMarker(payload = {}) {
  const marker = {
    source_kind: String(payload.sourceKind || payload.source_kind || "").trim(),
    source_path: String(payload.sourcePath || payload.source_path || "").trim(),
    imported_at: new Date().toISOString(),
  };

  writeFileAtomic(UPLOAD_SOURCE_MARKER_PATH, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

function getExistingWinscpIniPath() {
  return getCandidateWinscpIniPaths().find((candidate) => fs.existsSync(candidate)) || "";
}

function getExistingCredentialsJsonPath() {
  return getCandidateCredentialsJsonPaths().find((candidate) => fs.existsSync(candidate)) || "";
}

function getExistingUploadProfilesPath() {
  return getCandidateUploadProfilesPaths().find((candidate) => fs.existsSync(candidate)) || "";
}

function getUploadProfileSourcePath() {
  const marker = loadUploadImportMarker();
  if (!marker) {
    return ["", ""];
  }

  const credentialsJsonPath = getExistingCredentialsJsonPath();
  if (credentialsJsonPath) {
    return [credentialsJsonPath, "credentials_json"];
  }

  const winscpIniPath = getExistingWinscpIniPath();
  if (winscpIniPath) {
    return [winscpIniPath, "winscp_ini"];
  }

  return ["", ""];
}

function parseCredentialsProfiles(jsonPath = CREDENTIALS_JSON_PATH) {
  const resolvedPath = jsonPath === CREDENTIALS_JSON_PATH ? getExistingCredentialsJsonPath() : jsonPath;
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { servers: [], users: [] };
  }

  const loaded = parseCredentialFile(resolvedPath);
  const entries = loaded.entries;
  if (!loaded.encrypted) migrateCredentialFile(resolvedPath);

  const servers = new Map();
  const users = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const environment = (entry.Environment || entry.environment || "").trim();
    const sessionName = (entry.Session || entry.session || "").trim();
    const host = (entry.Host || entry.host || "").trim();
    const username = (entry.UserName || entry.username || "").trim();
    const password = (entry.Password || entry.password || "").trim();
    const port = Number(entry.Port || entry.port || 22);
    if (!host || !username) {
      continue;
    }

    const targetName = inferUploadTargetName(environment, sessionName, host, username);
    const serverKey = targetName || inferServerName(sessionName || username, host);
    const displayName = `${username}@${serverKey}`;

    if (!servers.has(serverKey)) {
      servers.set(serverKey, {
        name: serverKey,
        host,
        port,
        target_name: targetName || "",
        session_name: sessionName,
        actual_server_name: environment || serverKey,
        source: "credentials_json",
      });
    }

    users.set(displayName, {
      name: displayName,
      server: serverKey,
      username,
      password,
      encrypted_password: "",
      password_plain: password,
      session_name: sessionName,
      target_name: targetName || "",
      source: "credentials_json",
    });
  }

  return {
    servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    users: [...users.values()].sort((a, b) => `${a.server}:${a.name}`.localeCompare(`${b.server}:${b.name}`)),
  };
}

function sanitizeWinscpIniContent(content) {
  const lines = content.split(/\r?\n/);
  const sanitized = [];
  let inIniBody = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("[") && stripped.endsWith("]")) {
      inIniBody = true;
      sanitized.push(stripped);
      continue;
    }
    if (!inIniBody) {
      continue;
    }
    if (!stripped) {
      sanitized.push("");
      continue;
    }
    if (stripped.startsWith(";") || stripped.startsWith("#")) {
      sanitized.push(line);
      continue;
    }
    if (line.includes("=")) {
      sanitized.push(line);
    }
  }

  return sanitized.join("\n");
}

function parseIniSections(content) {
  const sections = {};
  let currentSection = "";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1);
      sections[currentSection] = sections[currentSection] || {};
      continue;
    }
    if (!currentSection) {
      continue;
    }
    const separatorIndex = rawLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim();
    sections[currentSection][key] = value;
  }

  return sections;
}

function decodeWinscpSessionName(sessionName) {
  try {
    return decodeURIComponent(sessionName).replace(/\//g, "\\").trim();
  } catch (_error) {
    return sessionName.replace(/\//g, "\\").trim();
  }
}

function extractSessionName(sectionName) {
  return decodeWinscpSessionName(sectionName.replace(/\//g, "\\").split("\\", 2)[1] || "");
}

function isSessionSection(sectionName) {
  return sectionName.replace(/\//g, "\\").startsWith("Sessions\\");
}

function parseUserHostKey(value) {
  const match = /^\s*([^@\s]+)@([^\s=]+)\s*$/.exec(value || "");
  if (!match) {
    return ["", ""];
  }
  return [match[1].trim(), match[2].trim()];
}

function buildUserDisplayName(sessionName, username, serverName) {
  const lastSegment = (sessionName || "").split("\\").slice(-1)[0];
  if (lastSegment.includes("@")) {
    return lastSegment;
  }
  return `${username}@${serverName}`;
}

function loadWinscpProfiles(iniPath = WINSCP_INI_PATH) {
  const resolvedPath = iniPath === WINSCP_INI_PATH ? getExistingWinscpIniPath() : iniPath;
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { servers: [], users: [] };
  }

  const sections = parseIniSections(sanitizeWinscpIniContent(fs.readFileSync(resolvedPath, "utf8")));
  const servers = new Map();
  const users = new Map();

  for (const [sectionName, sessionData] of Object.entries(sections)) {
    if (!isSessionSection(sectionName)) {
      continue;
    }

    const host = (sessionData.HostName || "").trim();
    const username = (sessionData.UserName || "").trim();
    if (!host || !username) {
      continue;
    }

    const sessionName = extractSessionName(sectionName);
    const serverName = inferServerName(sessionName, host);
    const targetName = inferUploadTargetName(sessionName, host, serverName);
    const port = Number(sessionData.PortNumber || 22);
    const serverKey = targetName || serverName;

    if (!servers.has(serverKey)) {
      servers.set(serverKey, {
        name: serverKey,
        host,
        port,
        target_name: targetName || "",
        session_name: sessionName,
        actual_server_name: serverName,
        source: "winscp_ini",
      });
    }

    const displayName = buildUserDisplayName(sessionName, username, serverKey);
    users.set(displayName, {
      name: displayName,
      server: serverKey,
      username,
      password: "",
      encrypted_password: (sessionData.Password || "").trim(),
      password_plain: (sessionData.PasswordPlain || "").trim(),
      session_name: sessionName,
      target_name: targetName || "",
      source: "winscp_ini",
    });
  }

  if (servers.size === 0 && users.size === 0) {
    for (const [sectionName, section] of Object.entries(sections)) {
      for (const key of Object.keys(section)) {
        const [username, host] = parseUserHostKey(key);
        if (!username || !host) {
          continue;
        }
        const targetName = inferUploadTargetName(sectionName, key, host);
        if (!getDefaultUploadTargets().includes(targetName)) {
          continue;
        }

        if (!servers.has(targetName)) {
          servers.set(targetName, {
            name: targetName,
            host,
            port: 22,
            target_name: targetName,
            session_name: "",
            actual_server_name: host,
            source: "winscp_cache",
          });
        }

        const displayName = `${username}@${targetName}`;
        users.set(displayName, {
          name: displayName,
          server: targetName,
          username,
          password: "",
          encrypted_password: "",
          password_plain: "",
          session_name: "",
          target_name: targetName,
          source: "winscp_cache",
        });
      }
    }
  }

  return {
    servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    users: [...users.values()].sort((a, b) => `${a.server}:${a.name}`.localeCompare(`${b.server}:${b.name}`)),
  };
}

function decryptNextCharacterWinscp(remainingPassword, magic = 163) {
  if (!remainingPassword || remainingPassword.length < 2) {
    return [0, ""];
  }

  const added = Number.parseInt(remainingPassword.slice(0, 2), 16);
  const decryptedResult = ((~(added ^ magic)) % 256 + 256) % 256;
  return [decryptedResult, remainingPassword.slice(2)];
}

function decryptWinscpPassword(sessionHostname, sessionUsername, encryptedPassword) {
  const checkFlag = 255;
  const key = `${sessionHostname}${sessionUsername}`;
  if (!encryptedPassword) {
    return "";
  }

  let [storedFlag, remainingPassword] = decryptNextCharacterWinscp(encryptedPassword);
  let passwordLength = 0;

  if (storedFlag === checkFlag) {
    remainingPassword = remainingPassword.slice(2);
    [passwordLength, remainingPassword] = decryptNextCharacterWinscp(remainingPassword);
  } else {
    [passwordLength, remainingPassword] = decryptNextCharacterWinscp(remainingPassword);
  }

  let skipLength = 0;
  [skipLength, remainingPassword] = decryptNextCharacterWinscp(remainingPassword);
  remainingPassword = remainingPassword.slice(skipLength * 2);

  const chars = [];
  for (let index = 0; index < passwordLength; index += 1) {
    let decryptedChar = 0;
    [decryptedChar, remainingPassword] = decryptNextCharacterWinscp(remainingPassword);
    chars.push(String.fromCharCode(decryptedChar));
  }

  const finalPassword = chars.join("");
  return storedFlag === checkFlag ? finalPassword.slice(key.length) : finalPassword;
}

function persistCredentialsJson(sourceJsonPath, destinationPath = CREDENTIALS_JSON_PATH, removeSource = false) {
  return importCredentialFile(sourceJsonPath, destinationPath, removeSource);
}

function generateCredentialsJsonFromWinscpIni(iniPath, outputPath = WINSCP_GENERATED_CREDENTIALS_PATH) {
  const profiles = loadWinscpProfiles(iniPath);
  const credentials = [];

  for (const user of profiles.users || []) {
    const encryptedPassword = (user.encrypted_password || "").trim();
    if (!encryptedPassword) {
      continue;
    }

    const server = findServerForTarget(profiles, user.server);
    const host = server ? server.host : "";
    const password = decryptWinscpPassword(host, user.username || "", encryptedPassword);
    if (!password) {
      continue;
    }

    credentials.push({
      environment: user.server || "",
      target_name: user.server || "",
      server_name: server ? server.name || "" : "",
      session: (user.session_name || "").replace(/\\/g, "/"),
      session_name: user.session_name || "",
      username: user.username || "",
      host,
      port: Number(server?.port || 22),
      password,
      source: "winscp_ini",
      Environment: user.server || "",
      Session: (user.session_name || "").replace(/\\/g, "/"),
      UserName: user.username || "",
      Host: host,
      Port: Number(server?.port || 22),
      Password: password,
    });
  }

  if (credentials.length === 0) {
    throw new Error("WinSCP.ini did not contain saved session passwords that could be converted to upload credentials.");
  }

  saveCredentialEntries(outputPath, credentials);

  return outputPath;
}

function loadUploadProfiles() {
  const marker = loadUploadImportMarker();
  if (!marker) {
    return { servers: [], users: [] };
  }

  const jsonProfiles = parseCredentialsProfiles();
  if (jsonProfiles.servers.length || jsonProfiles.users.length) {
    return jsonProfiles;
  }

  const winscpProfiles = loadWinscpProfiles();
  if (winscpProfiles.servers.length || winscpProfiles.users.length) {
    return winscpProfiles;
  }

  const uploadProfilesPath = getExistingUploadProfilesPath();
  if (uploadProfilesPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(uploadProfilesPath, "utf8"));
      const servers = Array.isArray(parsed?.servers)
        ? parsed.servers
            .map((server) => ({
              name: String(server?.name || "").trim(),
              host: String(server?.host || "").trim(),
              port: Number(server?.port || 22),
              target_name: String(server?.target_name || server?.name || "").trim(),
              actual_server_name: String(server?.actual_server_name || server?.host || server?.name || "").trim(),
              source: "upload_profiles_json",
            }))
            .filter((server) => Boolean(server.name))
        : [];
      const users = Array.isArray(parsed?.users)
        ? parsed.users
            .map((user) => ({
              name: String(user?.name || "").trim(),
              server: String(user?.server || "").trim(),
              username: String(user?.username || "").trim(),
              password: String(user?.password || "").trim(),
              encrypted_password: String(user?.encrypted_password || "").trim(),
              password_plain: String(user?.password_plain || "").trim(),
              session_name: String(user?.session_name || "").trim(),
              target_name: String(user?.target_name || user?.server || "").trim(),
              source: "upload_profiles_json",
            }))
            .filter((user) => Boolean(user.name && user.server))
        : [];

      if (servers.length || users.length) {
        return {
          servers: servers.sort((a, b) => a.name.localeCompare(b.name)),
          users: users.sort((a, b) => `${a.server}:${a.name}`.localeCompare(`${b.server}:${b.name}`)),
        };
      }
    } catch (_error) {
      // Ignore invalid legacy profile file and continue with empty defaults.
    }
  }

  return { servers: [], users: [] };
}

function importUploadSourceToConfig(sourcePath) {
  const normalizedSourcePath = (sourcePath || "").trim();
  if (!normalizedSourcePath || !fs.existsSync(normalizedSourcePath)) {
    throw new Error("The selected upload source file was not found.");
  }

  const extension = path.extname(normalizedSourcePath).toLowerCase();
  if (extension === ".json") {
    const profiles = parseCredentialsProfiles(normalizedSourcePath);
    if (!profiles.servers.length || !profiles.users.length) {
      throw new Error("The selected credentials JSON file did not contain usable upload profiles.");
    }
    persistCredentialsJson(normalizedSourcePath);
    saveUploadImportMarker({
      sourceKind: "credentials_json",
      sourcePath: CREDENTIALS_JSON_PATH,
    });
    return {
      source_kind: "credentials_json",
      source_path: normalizedSourcePath,
      config_path: CREDENTIALS_JSON_PATH,
      profile_summary: summarizeUploadProfiles(parseCredentialsProfiles(CREDENTIALS_JSON_PATH)),
    };
  }

  if (extension === ".ini") {
    fs.mkdirSync(path.dirname(WINSCP_INI_PATH), { recursive: true });
    fs.copyFileSync(normalizedSourcePath, WINSCP_INI_PATH);
    const generatedJsonPath = generateCredentialsJsonFromWinscpIni(WINSCP_INI_PATH);
    persistCredentialsJson(generatedJsonPath, CREDENTIALS_JSON_PATH, true);
    saveUploadImportMarker({
      sourceKind: "winscp_ini",
      sourcePath: WINSCP_INI_PATH,
    });
    return {
      source_kind: "winscp_ini",
      source_path: normalizedSourcePath,
      config_path: CREDENTIALS_JSON_PATH,
      generated_json_path: CREDENTIALS_JSON_PATH,
      profile_summary: summarizeUploadProfiles(parseCredentialsProfiles(CREDENTIALS_JSON_PATH)),
    };
  }

  throw new Error("Please choose either a WinSCP.ini file or a credentials JSON file.");
}

function findServerForTarget(profiles, targetName) {
  const normalizedTarget = normalizeUploadTargetName(targetName);
  return (profiles.servers || []).find((server) => {
    return [server.name, server.host, server.target_name].some(
      (value) => normalizeUploadTargetName(value) === normalizedTarget
    );
  }) || null;
}

function getServerDisplayForTarget(profiles, targetName) {
  const server = findServerForTarget(profiles, targetName);
  if (!server) {
    return "No server name available";
  }
  return (server.host || server.actual_server_name || server.name || "No server name available").trim();
}

function getUserNamesForServer(profiles, serverName) {
  return (profiles.users || [])
    .filter((user) => normalizeUploadTargetName(user.server) === normalizeUploadTargetName(serverName))
    .map((user) => user.name);
}

function findWinscpExecutable() {
  const defaultPaths = [
    "C:\\Program Files (x86)\\WinSCP\\WinSCP.com",
    "C:\\Program Files\\WinSCP\\WinSCP.com",
    "C:\\Program Files (x86)\\WinSCP\\WinSCP.exe",
    "C:\\Program Files\\WinSCP\\WinSCP.exe",
  ];
  return defaultPaths.find((candidate) => fs.existsSync(candidate)) || "";
}

function resolveUploadProfile(profiles, serverName, userName) {
  let server = (profiles.servers || []).find((item) => item.name === serverName);
  if (!server) {
    server = findServerForTarget(profiles, serverName);
  }
  const user = (profiles.users || []).find(
    (item) => item.name === userName && normalizeUploadTargetName(item.server) === normalizeUploadTargetName(serverName)
  );

  if (!server) {
    throw new Error(`The selected upload server for ${serverName} was not found.`);
  }
  if (!user) {
    throw new Error(`The selected upload user for ${serverName} was not found.`);
  }

  let password = user.password || user.password_plain || "";
  if (!password && user.password_env) {
    password = process.env[user.password_env] || "";
  }

  const winscpPath = findWinscpExecutable();
  if (!password && (!winscpPath || !user.session_name)) {
    throw new Error(`No usable password is configured for ${userName}.`);
  }

  return {
    server_name: serverName,
    user_name: userName,
    host: server.host || "",
    port: Number(server.port || 22),
    username: user.username || "",
    password,
    session_name: user.session_name || "",
    winscp_path: winscpPath,
  };
}

function resolveUploadTargets(profiles, selectedTargets) {
  return (selectedTargets || []).map((target) => {
    const serverName = (target.server_name || "").trim();
    const userName = (target.user_name || "").trim();
    const remoteDirectory = (target.remote_directory || "").trim();
    if (!serverName) {
      throw new Error("An upload target is missing its server name.");
    }
    if (!userName) {
      throw new Error(`Please choose a user for ${serverName} before using upload.`);
    }
    if (!remoteDirectory) {
      throw new Error(`Please enter the remote upload location for ${serverName}.`);
    }

    return {
      server_name: serverName,
      user_name: userName,
      remote_directory: remoteDirectory,
      connection_details: resolveUploadProfile(profiles, serverName, userName),
    };
  });
}

async function ensureRemoteDirectory(client, remoteDirectory) {
  const parts = remoteDirectory.replace(/^\/+|\/+$/g, "").split("/");
  let currentPath = "";
  for (const part of parts) {
    if (!part) {
      continue;
    }
    currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
    try {
      await client.stat(currentPath);
    } catch (_error) {
      await client.mkdir(currentPath, true);
    }
  }
}

function withTimeout(promise, timeoutMs, description) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${description} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function closeSftpClient(client, timeoutMs = SFTP_CLOSE_TIMEOUT_MS) {
  let closePromise;
  try {
    closePromise = Promise.resolve(client.end()).catch(() => {});
  } catch (_error) {
    closePromise = Promise.resolve();
  }

  let timer;
  const closedNormally = await Promise.race([
    closePromise.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);

  if (!closedNormally) {
    try {
      client.client?.destroy?.();
    } catch (_error) {
      // The transfer is already complete; a failed forced disconnect must not block the next target.
    }
  }
}

function uploadFileWithWinscp(localPath, remoteDirectory, sessionName, winscpPath) {
  const iniPath = getExistingWinscpIniPath();
  if (!iniPath) {
    throw new Error("WinSCP.ini was not found in the expected upload_import locations.");
  }

  const scriptPath = path.join(os.tmpdir(), `winscp_upload_${Date.now()}.txt`);
  fs.writeFileSync(
    scriptPath,
    [`open "${sessionName}"`, `put "${localPath}" "${remoteDirectory.replace(/\/+$/, "")}/"`, "exit"].join("\n"),
    "utf8"
  );

  try {
    const result = spawnSync(winscpPath, [`/ini=${iniPath}`, `/script=${scriptPath}`, "/nointeractiveinput"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: SFTP_OPERATION_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (result.error) {
      throw new Error(`WinSCP upload failed for session ${sessionName}. ${result.error.message}`);
    }
    if (result.status !== 0) {
      const details = (result.stderr || result.stdout || "Unknown WinSCP error.").trim();
      throw new Error(`WinSCP upload failed for session ${sessionName}. ${details}`);
    }
    return `${remoteDirectory.replace(/\/+$/, "")}/${path.basename(localPath)}`;
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }
}

function testConnectionWithWinscp(remoteDirectory, sessionName, winscpPath) {
  const iniPath = getExistingWinscpIniPath();
  if (!iniPath) {
    throw new Error("WinSCP.ini was not found in the expected upload_import locations.");
  }

  const normalizedRemoteDirectory = (remoteDirectory || "").trim();
  const scriptLines = [`open "${sessionName}"`];
  if (normalizedRemoteDirectory) {
    scriptLines.push(`cd "${normalizedRemoteDirectory}"`);
    scriptLines.push("pwd");
  }
  scriptLines.push("exit");

  const scriptPath = path.join(os.tmpdir(), `winscp_test_${Date.now()}.txt`);
  fs.writeFileSync(scriptPath, scriptLines.join("\n"), "utf8");

  try {
    const result = spawnSync(winscpPath, [`/ini=${iniPath}`, `/script=${scriptPath}`, "/nointeractiveinput"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: SFTP_CONNECT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (result.error) {
      throw new Error(`WinSCP connection test failed for session ${sessionName}. ${result.error.message}`);
    }
    if (result.status !== 0) {
      const details = (result.stderr || result.stdout || "Unknown WinSCP error.").trim();
      throw new Error(`WinSCP connection test failed for session ${sessionName}. ${details}`);
    }
    return normalizedRemoteDirectory
      ? `Connected successfully and confirmed ${normalizedRemoteDirectory}.`
      : "Connected successfully.";
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }
}

async function testUploadConnection(connectionDetails, remoteDirectory) {
  const normalizedRemoteDirectory = (remoteDirectory || "").trim();
  if (!normalizedRemoteDirectory) {
    throw new Error("Please enter the remote upload location.");
  }

  if (connectionDetails.winscp_path && connectionDetails.session_name && !connectionDetails.password) {
    return testConnectionWithWinscp(
      normalizedRemoteDirectory,
      connectionDetails.session_name,
      connectionDetails.winscp_path
    );
  }

  const client = new SftpClient();
  try {
    await withTimeout(client.connect({
      host: connectionDetails.host,
      port: connectionDetails.port,
      username: connectionDetails.username,
      password: connectionDetails.password,
    }), SFTP_CONNECT_TIMEOUT_MS, "SFTP connection");
    await withTimeout(client.list(normalizedRemoteDirectory), SFTP_CONNECT_TIMEOUT_MS, "Remote directory check");
    return `Connected successfully and confirmed ${normalizedRemoteDirectory}.`;
  } finally {
    await closeSftpClient(client);
  }
}

async function uploadFileWithSftp(
  localPath,
  remoteDirectory,
  connectionDetails,
  client = new SftpClient(),
  timeouts = {}
) {
  const connectTimeoutMs = timeouts.connectTimeoutMs || SFTP_CONNECT_TIMEOUT_MS;
  const operationTimeoutMs = timeouts.operationTimeoutMs || SFTP_OPERATION_TIMEOUT_MS;
  const closeTimeoutMs = timeouts.closeTimeoutMs || SFTP_CLOSE_TIMEOUT_MS;

  try {
    await withTimeout(client.connect({
      host: connectionDetails.host,
      port: connectionDetails.port,
      username: connectionDetails.username,
      password: connectionDetails.password,
    }), connectTimeoutMs, "SFTP connection");
    await withTimeout(
      ensureRemoteDirectory(client, remoteDirectory),
      operationTimeoutMs,
      "Remote directory preparation"
    );
    const remotePath = `${remoteDirectory.replace(/\/+$/, "")}/${path.basename(localPath)}`;
    await withTimeout(client.put(localPath, remotePath), operationTimeoutMs, "SFTP upload");

    const remoteStats = await withTimeout(client.stat(remotePath), connectTimeoutMs, "Uploaded file verification");
    const localSize = fs.statSync(localPath).size;
    if (Number(remoteStats?.size) !== localSize) {
      throw new Error(
        `Upload verification failed for ${path.basename(localPath)}: expected ${localSize} bytes, found ${remoteStats?.size ?? "unknown"}.`
      );
    }
    return remotePath;
  } finally {
    await closeSftpClient(client, closeTimeoutMs);
  }
}

async function uploadFile(localPath, remoteDirectory, connectionDetails) {
  const normalizedRemoteDirectory = (remoteDirectory || "").trim();
  if (!normalizedRemoteDirectory) {
    throw new Error("Please enter the remote upload location.");
  }

  if (connectionDetails.winscp_path && connectionDetails.session_name && !connectionDetails.password) {
    return uploadFileWithWinscp(
      localPath,
      normalizedRemoteDirectory,
      connectionDetails.session_name,
      connectionDetails.winscp_path
    );
  }

  return uploadFileWithSftp(localPath, normalizedRemoteDirectory, connectionDetails);
}

async function uploadFileWithRetry(localPath, remoteDirectory, connectionDetails, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || DEFAULT_UPLOAD_ATTEMPTS));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 750));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await uploadFile(localPath, remoteDirectory, connectionDetails);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`Upload failed after ${attempts} attempts: ${lastError?.message || "Unknown upload error."}`);
}

async function uploadTargetsSequentially(localPath, targets = [], options = {}) {
  const seen = new Set();
  const selectedTargets = (Array.isArray(targets) ? targets : []).filter((target) => {
    const c = target.connection_details || {};
    const key = [String(c.host || c.session_name || target.server_name).toLowerCase(), c.port || 22, String(target.remote_directory || "").replace(/\/+$/, "")].join("|");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const upload = typeof options.upload === "function" ? options.upload : uploadFile;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  let completedCount = 0;

  onProgress({
    state: "upload-batch-start",
    current: 0,
    total: selectedTargets.length,
    targetNames: selectedTargets.map((target) => target.server_name),
  });

  const results = [];
  for (const target of selectedTargets) {
    results.push(await (async () => {
    onProgress({
      state: "uploading",
      current: completedCount,
      total: selectedTargets.length,
      uploadTarget: target.server_name,
    });
    try {
      const remotePath = await upload(localPath, target.remote_directory, target.connection_details);
      completedCount += 1;
      const result = {
        serverName: target.server_name,
        userName: target.user_name || "",
        remoteDirectory: target.remote_directory,
        remotePath,
        status: "completed",
        message: `Upload to ${target.server_name} completed.`,
      };
      onProgress({
        state: "upload-target-complete",
        current: completedCount,
        total: selectedTargets.length,
        uploadTarget: target.server_name,
        result,
      });
      return result;
    } catch (error) {
      completedCount += 1;
      const result = {
        serverName: target.server_name,
        userName: target.user_name || "",
        remoteDirectory: target.remote_directory,
        remotePath: "",
        status: "failed",
        message: error.message,
      };
      onProgress({
        state: "upload-target-error",
        current: completedCount,
        total: selectedTargets.length,
        uploadTarget: target.server_name,
        detail: error.message,
        result,
      });
      return result;
    }
    })());
  }

  onProgress({
    state: results.some((result) => result.status === "failed") ? "upload-batch-warning" : "upload-complete",
    current: completedCount,
    total: selectedTargets.length,
    results,
  });
  return results;
}

module.exports = {
  getServerDisplayForTarget,
  getUploadProfileSourcePath,
  getUploadTargetNames,
  getUserNamesForServer,
  importUploadSourceToConfig,
  loadUploadProfiles,
  resolveUploadTargets,
  summarizeUploadProfiles,
  testUploadConnection,
  closeSftpClient,
  uploadFile,
  uploadFileWithRetry,
  uploadFileWithSftp,
  uploadTargetsSequentially,
  withTimeout,
};
