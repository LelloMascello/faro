import cache from "memory-cache";

import { FaroOAuthError, readAccount, writeAccount } from "./token-store";

import createLogger from "utils/logger";

const logger = createLogger("faroMicrosoftOAuth");

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const CACHE_PREFIX = "faro:oauth:microsoft:access:";
const inflightRefreshes = new Map();

function getCacheKey(accountKey, configDir) {
  return `${CACHE_PREFIX}${configDir || "default"}:${accountKey}`;
}

export function clearMicrosoftTokenCache() {
  for (const key of cache.keys()) {
    if (typeof key === "string" && key.startsWith(CACHE_PREFIX)) {
      cache.del(key);
    }
  }
  inflightRefreshes.clear();
}

export function invalidateMicrosoftAccessToken(accountKey, configDir) {
  cache.del(getCacheKey(accountKey, configDir));
}

async function refreshMicrosoftAccessToken(accountKey, configDir) {
  const account = await readAccount(accountKey, "microsoft", configDir);
  const tenant = account.tenant || "common";
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: account.clientId,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  });

  if (Array.isArray(account.scopes) && account.scopes.length > 0) {
    body.set("scope", account.scopes.join(" "));
  }
  if (account.clientSecret) {
    body.set("client_secret", account.clientSecret);
  }

  let response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (err) {
    logger.debug("Network error refreshing Microsoft token for '%s': %s", accountKey, err.message);
    throw new FaroOAuthError(`Network error refreshing Microsoft OAuth token: ${err.message}`, {
      status: 502,
      code: "token_network_error",
    });
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    // keep empty object if non-JSON error body
  }

  if (!response.ok || !data.access_token) {
    const errCode = data.error || "token_refresh_failed";
    if (errCode === "invalid_grant" || errCode === "interaction_required") {
      throw new FaroOAuthError(
        `Microsoft refresh token expired or revoked for '${accountKey}'. Re-link with: pnpm faro:auth outlook --account ${accountKey}`,
        {
          status: 401,
          code: errCode,
        },
      );
    }

    const description = data.error_description || data.error || `HTTP ${response.status}`;
    throw new FaroOAuthError(`Microsoft OAuth token refresh failed (${description})`, {
      status: response.status >= 400 && response.status < 600 ? response.status : 502,
      code: errCode,
    });
  }

  // Microsoft rotates refresh tokens; persist the new token atomically right away.
  if (data.refresh_token && data.refresh_token !== account.refreshToken) {
    await writeAccount(
      accountKey,
      {
        refreshToken: data.refresh_token,
      },
      configDir,
    );
  }

  const expiresInSec = Number(data.expires_in) || 3600;
  const ttlMs = Math.max((expiresInSec - 60) * 1000, 10_000);
  cache.put(getCacheKey(accountKey, configDir), data.access_token, ttlMs);

  return data.access_token;
}

export async function getMicrosoftAccessToken(accountKey, { configDir, forceRefresh = false } = {}) {
  const cacheKey = getCacheKey(accountKey, configDir);
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const inflightKey = `${configDir || "default"}:${accountKey}`;
  if (inflightRefreshes.has(inflightKey)) {
    return inflightRefreshes.get(inflightKey);
  }

  const promise = refreshMicrosoftAccessToken(accountKey, configDir).finally(() => {
    inflightRefreshes.delete(inflightKey);
  });
  inflightRefreshes.set(inflightKey, promise);
  return promise;
}

function resolveGraphUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalized = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${GRAPH_BASE_URL}${normalized}`;
}

async function performGraphRequest(url, accessToken, init = {}) {
  const headers = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
    Authorization: `Bearer ${accessToken}`,
  };

  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (err) {
    throw new FaroOAuthError(`Network error calling Microsoft Graph API: ${err.message}`, {
      status: 502,
      code: "api_network_error",
    });
  }

  return response;
}

export async function graphFetch(accountKey, pathOrUrl, init = {}, { configDir } = {}) {
  const url = resolveGraphUrl(pathOrUrl);
  let token = await getMicrosoftAccessToken(accountKey, { configDir });
  let response = await performGraphRequest(url, token, init);

  if (response.status === 401) {
    invalidateMicrosoftAccessToken(accountKey, configDir);
    token = await getMicrosoftAccessToken(accountKey, { configDir, forceRefresh: true });
    response = await performGraphRequest(url, token, init);
  }

  if (response.status === 204) {
    return null;
  }

  const rawText = await response.text();
  let parsed = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const apiMessage = parsed?.error?.message || parsed?.error_description || `HTTP ${response.status}`;
    logger.debug("Microsoft Graph HTTP %d: %s", response.status, apiMessage);
    throw new FaroOAuthError(`Microsoft Graph error: ${apiMessage}`, {
      status: response.status,
      code: parsed?.error?.code || "graph_api_error",
    });
  }

  return parsed;
}
