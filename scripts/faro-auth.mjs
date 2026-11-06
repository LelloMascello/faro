#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const STORE_FILENAME = "faro-oauth.json";

const GOOGLE_SCOPES_DEFAULT = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks",
];

const GOOGLE_SCOPES_READONLY = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks.readonly",
];

const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Mail.Read"];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        args[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          args[key] = next;
          i += 1;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function getConfigDir(args) {
  if (typeof args["config-dir"] === "string" && args["config-dir"]) {
    return args["config-dir"];
  }
  if (process.env.HOMEPAGE_CONFIG_DIR) {
    return process.env.HOMEPAGE_CONFIG_DIR;
  }
  return join(process.cwd(), "config");
}

async function readStore(configDir) {
  const storePath = join(configDir, STORE_FILENAME);
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.accounts && typeof parsed.accounts === "object") {
      return { version: 1, accounts: parsed.accounts };
    }
    return { version: 1, accounts: {} };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { version: 1, accounts: {} };
    }
    throw err;
  }
}

async function saveAccount(configDir, accountKey, accountData) {
  await mkdir(configDir, { recursive: true });
  const storePath = join(configDir, STORE_FILENAME);
  const current = await readStore(configDir);
  const next = {
    version: 1,
    accounts: {
      ...current.accounts,
      [accountKey]: {
        ...current.accounts[accountKey],
        ...accountData,
        updatedAt: new Date().toISOString(),
      },
    },
  };

  const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, storePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
  return storePath;
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function extractAuthCode(input, expectedState) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Empty authorization input");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes("code=")) {
    const urlStr = trimmed.startsWith("http") ? trimmed : `http://127.0.0.1/?${trimmed.replace(/^\?/, "")}`;
    const parsed = new URL(urlStr);
    const err = parsed.searchParams.get("error");
    if (err) {
      throw new Error(`OAuth error returned: ${err}`);
    }
    const state = parsed.searchParams.get("state");
    if (expectedState && state && state !== expectedState) {
      throw new Error("OAuth state mismatch");
    }
    const code = parsed.searchParams.get("code");
    if (!code) {
      throw new Error("No 'code' parameter found in pasted URL");
    }
    return code;
  }
  return trimmed;
}

function startLoopbackServer(port, expectedState) {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (
          reqUrl.pathname !== "/oauth2callback" &&
          !reqUrl.searchParams.has("code") &&
          !reqUrl.searchParams.has("error")
        ) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h2>Autorizzazione fallita: ${error}</h2><p>Puoi chiudere questa scheda.</p>`);
          rejectCode(new Error(`Google OAuth error: ${error}`));
          return;
        }

        const state = reqUrl.searchParams.get("state");
        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("State mismatch.");
          rejectCode(new Error("OAuth state mismatch"));
          return;
        }

        const code = reqUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing authorization code.");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h2>Account Google collegato con successo a Faro!</h2><p>Puoi chiudere questa scheda e tornare al terminale.</p>",
        );
        resolveCode(code);
      } catch (err) {
        rejectCode(err);
      }
    });

    server.on("error", rejectServer);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        server,
        port: address.port,
        codePromise,
      });
    });
  });
}

async function promptIfMissing(rl, currentValue, question, defaultValue = "") {
  if (typeof currentValue === "string" && currentValue.trim()) {
    return currentValue.trim();
  }
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function runGoogleFlow(args, configDir) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const account = await promptIfMissing(rl, args.account, "Nome account (usato in services.yaml)", "personale");
    const existing = (await readStore(configDir)).accounts[account] ?? {};

    const clientId = await promptIfMissing(
      rl,
      args["client-id"],
      "Google OAuth Client ID (Desktop app)",
      existing.clientId || "",
    );
    if (!clientId) {
      throw new Error("Client ID obbligatorio.");
    }

    const clientSecret = await promptIfMissing(
      rl,
      args["client-secret"],
      "Google OAuth Client Secret (Desktop app)",
      existing.clientSecret || "",
    );

    const scopes = args["no-tasks-write"] ? GOOGLE_SCOPES_READONLY : GOOGLE_SCOPES_DEFAULT;
    const state = base64Url(randomBytes(16));
    const { verifier, challenge } = createPkcePair();
    const requestedPort = args.port ? Number(args.port) : 0;

    const { server, port, codePromise } = await startLoopbackServer(requestedPort, state);
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    console.log("\n1) Apri questo URL nel browser e autorizza l'account Google:\n");
    console.log(`   ${authUrl.toString()}\n`);
    console.log("2) Se sei in locale, il browser completera' il collegamento in automatico.");
    console.log(
      "   Se sei via SSH/Docker (e 127.0.0.1 non carica), copia l'URL completo dalla barra indirizzi e incollalo qui sotto:\n",
    );

    const abortController = new AbortController();
    const manualPromise = rl
      .question("URL di redirect (oppure attendi il callback automatico): ", { signal: abortController.signal })
      .then((line) => extractAuthCode(line, state));

    let code;
    try {
      code = await Promise.race([codePromise, manualPromise]);
    } finally {
      abortController.abort();
      manualPromise.catch(() => {});
      server.close();
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    if (clientSecret) {
      tokenParams.set("client_secret", clientSecret);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: tokenParams.toString(),
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(
        `Scambio token Google fallito: ${tokenData.error_description || tokenData.error || tokenRes.status}`,
      );
    }

    const refreshToken = tokenData.refresh_token || existing.refreshToken;
    if (!refreshToken) {
      throw new Error(
        "Google non ha restituito un refresh_token. Riprova rimuovendo prima l'accesso dell'app da myaccount.google.com/permissions.",
      );
    }

    let email = null;
    try {
      const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        email = profile.emailAddress || null;
      }
    } catch {
      // non-fatal if Gmail API isn't enabled yet
    }

    const savedPath = await saveAccount(configDir, account, {
      provider: "google",
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      refreshToken,
      scopes,
      ...(email ? { email } : {}),
    });

    console.log(`\nCollegamento completato per '${account}'${email ? ` (${email})` : ""}.`);
    console.log(`Salvato in: ${savedPath} (permessi 0600)\n`);
  } finally {
    rl.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runMicrosoftFlow(args, configDir) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let account;
  let clientId;
  let tenant;
  let existing;
  try {
    account = await promptIfMissing(rl, args.account, "Nome account (usato in services.yaml)", "polimi");
    existing = (await readStore(configDir)).accounts[account] ?? {};
    clientId = await promptIfMissing(
      rl,
      args["client-id"],
      "Microsoft Entra Application (client) ID",
      existing.clientId || "",
    );
    if (!clientId) {
      throw new Error("Client ID obbligatorio.");
    }
    tenant = await promptIfMissing(
      rl,
      args.tenant,
      "Tenant Microsoft (common, consumers, organizations o tenant ID)",
      existing.tenant || "common",
    );
  } finally {
    rl.close();
  }

  const deviceUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`;
  const deviceRes = await fetch(deviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: MICROSOFT_SCOPES.join(" "),
    }).toString(),
  });
  const deviceData = await deviceRes.json();

  if (!deviceRes.ok || !deviceData.device_code) {
    throw new Error(
      `Richiesta device code fallita: ${deviceData.error_description || deviceData.error || deviceRes.status}`,
    );
  }

  console.log(`\n${deviceData.message}\n`);
  console.log("In attesa della conferma nel browser...");

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  let intervalSec = Number(deviceData.interval) || 5;
  const deadline = Date.now() + (Number(deviceData.expires_in) || 900) * 1000;

  let tokenData = null;
  while (Date.now() < deadline) {
    await sleep(intervalSec * 1000);

    const pollRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: deviceData.device_code,
      }).toString(),
    });
    const body = await pollRes.json();

    if (pollRes.ok && body.access_token) {
      tokenData = body;
      break;
    }

    if (body.error === "authorization_pending") {
      continue;
    }
    if (body.error === "slow_down") {
      intervalSec += 5;
      continue;
    }

    const hint =
      body.error === "consent_required" ||
      String(body.error_description || "").includes("AADSTS65001") ||
      String(body.error_description || "").includes("AADSTS90094")
        ? "\nNota: il tenant universitario potrebbe richiedere l'approvazione dell'amministratore IT per le app di terze parti."
        : "";
    throw new Error(`Autenticazione Microsoft fallita: ${body.error_description || body.error}${hint}`);
  }

  if (!tokenData) {
    throw new Error("Tempo scaduto per il codice dispositivo. Riprova.");
  }

  const refreshToken = tokenData.refresh_token || existing.refreshToken;
  if (!refreshToken) {
    throw new Error("Microsoft non ha restituito un refresh_token (verifica lo scope offline_access).");
  }

  let email = null;
  try {
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      email = me.mail || me.userPrincipalName || null;
    }
  } catch {
    // non-fatal
  }

  const savedPath = await saveAccount(configDir, account, {
    provider: "microsoft",
    clientId,
    tenant,
    refreshToken,
    scopes: MICROSOFT_SCOPES,
    ...(email ? { email } : {}),
  });

  console.log(`\nCollegamento completato per '${account}'${email ? ` (${email})` : ""}.`);
  console.log(`Salvato in: ${savedPath} (permessi 0600)\n`);
}

async function listAccounts(configDir) {
  const store = await readStore(configDir);
  const entries = Object.entries(store.accounts);
  if (entries.length === 0) {
    console.log(`Nessun account salvato in ${join(configDir, STORE_FILENAME)}.`);
    return;
  }
  console.log(`Account collegati in ${join(configDir, STORE_FILENAME)}:`);
  for (const [key, acc] of entries) {
    console.log(
      `  - ${key}: provider=${acc.provider}${acc.email ? ` (${acc.email})` : ""} aggiornato=${acc.updatedAt || "?"}`,
    );
  }
}

function printUsage() {
  console.log(`Uso:
  pnpm faro:auth google  [--account personale] [--client-id ID] [--client-secret SECRET] [--no-tasks-write] [--config-dir DIR]
  pnpm faro:auth outlook [--account polimi]    [--client-id ID] [--tenant common] [--config-dir DIR]
  pnpm faro:auth list    [--config-dir DIR]`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = (args._[0] || "").toLowerCase();
  const configDir = getConfigDir(args);

  if (!command || args.help || args.h) {
    printUsage();
    return;
  }

  if (command === "google" || command === "gmail" || command === "googlecalendar") {
    await runGoogleFlow(args, configDir);
    return;
  }

  if (command === "outlook" || command === "microsoft") {
    await runMicrosoftFlow(args, configDir);
    return;
  }

  if (command === "list") {
    await listAccounts(configDir);
    return;
  }

  console.error(`Comando sconosciuto: '${command}'\n`);
  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nErrore: ${err.message}`);
  process.exitCode = 1;
});
