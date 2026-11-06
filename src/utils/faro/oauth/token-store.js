import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CONF_DIR } from "utils/config/config";

const STORE_FILENAME = "faro-oauth.json";

export class FaroOAuthError extends Error {
  constructor(message, { status = 500, code = "oauth_error" } = {}) {
    super(message);
    this.name = "FaroOAuthError";
    this.status = status;
    this.code = code;
  }
}

export function getStorePath(configDir) {
  const dir = configDir || process.env.HOMEPAGE_CONFIG_DIR || CONF_DIR;
  return join(dir, STORE_FILENAME);
}

export async function readTokenStore(configDir) {
  const storePath = getStorePath(configDir);
  let raw;
  try {
    raw = await readFile(storePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { version: 1, accounts: {} };
    }
    throw new FaroOAuthError(`Unable to read OAuth token store: ${err.message}`, {
      status: 500,
      code: "store_read_error",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FaroOAuthError("Invalid JSON in faro-oauth.json", {
      status: 500,
      code: "store_corrupt",
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { version: 1, accounts: {} };
  }

  const accounts =
    parsed.accounts && typeof parsed.accounts === "object" && !Array.isArray(parsed.accounts) ? parsed.accounts : {};

  return {
    version: parsed.version ?? 1,
    accounts,
  };
}

function cliCommandForProvider(provider) {
  if (provider === "microsoft") return "outlook";
  return provider || "google";
}

export async function readAccount(accountKey, expectedProvider, configDir) {
  if (!accountKey || typeof accountKey !== "string") {
    const cmd = cliCommandForProvider(expectedProvider);
    throw new FaroOAuthError(`Missing 'account' in widget configuration (link one with: pnpm faro:auth ${cmd})`, {
      status: 400,
      code: "missing_account_config",
    });
  }

  const store = await readTokenStore(configDir);
  const account = store.accounts[accountKey];
  if (!account || typeof account !== "object") {
    const cmd = cliCommandForProvider(expectedProvider);
    throw new FaroOAuthError(
      `OAuth account '${accountKey}' not linked. Run: pnpm faro:auth ${cmd} --account ${accountKey}`,
      {
        status: 401,
        code: "account_not_linked",
      },
    );
  }

  if (expectedProvider && account.provider && account.provider !== expectedProvider) {
    throw new FaroOAuthError(
      `Account '${accountKey}' is configured for provider '${account.provider}', expected '${expectedProvider}'`,
      {
        status: 400,
        code: "provider_mismatch",
      },
    );
  }

  if (!account.clientId || !account.refreshToken) {
    const cmd = cliCommandForProvider(expectedProvider || account.provider);
    throw new FaroOAuthError(
      `Incomplete OAuth credentials for '${accountKey}'. Re-run: pnpm faro:auth ${cmd} --account ${accountKey}`,
      {
        status: 401,
        code: "incomplete_credentials",
      },
    );
  }

  return account;
}

let writeChain = Promise.resolve();
let tmpCounter = 0;

export function writeAccount(accountKey, patch, configDir) {
  if (!accountKey || typeof accountKey !== "string") {
    return Promise.reject(
      new FaroOAuthError("Account key must be a non-empty string", {
        status: 400,
        code: "invalid_account_key",
      }),
    );
  }

  const run = async () => {
    const dir = configDir || process.env.HOMEPAGE_CONFIG_DIR || CONF_DIR;
    const storePath = join(dir, STORE_FILENAME);
    await mkdir(dir, { recursive: true });

    const current = await readTokenStore(dir);
    const existing = current.accounts[accountKey] ?? {};
    const updatedAccount = {
      ...existing,
      ...patch,
      updatedAt: patch?.updatedAt ?? new Date().toISOString(),
    };

    const nextStore = {
      version: 1,
      accounts: {
        ...current.accounts,
        [accountKey]: updatedAccount,
      },
    };

    tmpCounter += 1;
    const tmpPath = `${storePath}.${process.pid}.${Date.now()}.${tmpCounter}.tmp`;
    const payload = `${JSON.stringify(nextStore, null, 2)}\n`;

    try {
      await writeFile(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
      await chmod(tmpPath, 0o600);
      await rename(tmpPath, storePath);
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw new FaroOAuthError(`Unable to save OAuth token store: ${err.message}`, {
        status: 500,
        code: "store_write_error",
      });
    }

    return updatedAccount;
  };

  const resultPromise = writeChain.then(run, run);
  writeChain = resultPromise.catch(() => {});
  return resultPromise;
}
