import cache from "memory-cache";

import { FaroOAuthError, readAccount, writeAccount } from "./token-store";

import createLogger from "utils/logger";

const logger = createLogger("faroGoogleOAuth");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CACHE_PREFIX = "faro:oauth:google:access:";
const inflightRefreshes = new Map();

function getCacheKey(accountKey, configDir) {
  return `${CACHE_PREFIX}${configDir || "default"}:${accountKey}`;
}

export function clearGoogleTokenCache() {
  for (const key of cache.keys()) {
    if (typeof key === "string" && key.startsWith(CACHE_PREFIX)) {
      cache.del(key);
    }
  }
  inflightRefreshes.clear();
}

export function invalidateGoogleAccessToken(accountKey, configDir) {
  cache.del(getCacheKey(accountKey, configDir));
}

async function refreshGoogleAccessToken(accountKey, configDir) {
  const account = await readAccount(accountKey, "google", configDir);

  const body = new URLSearchParams({
    client_id: account.clientId,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  });
  if (account.clientSecret) {
    body.set("client_secret", account.clientSecret);
  }

  let response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (err) {
    logger.debug("Network error refreshing Google token for '%s': %s", accountKey, err.message);
    throw new FaroOAuthError(`Network error refreshing Google OAuth token: ${err.message}`, {
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
    if (errCode === "invalid_grant") {
      throw new FaroOAuthError(
        `Google refresh token expired or revoked for '${accountKey}'. Re-link with: pnpm faro:auth google --account ${accountKey}`,
        {
          status: 401,
          code: "invalid_grant",
        },
      );
    }

    const description = data.error_description || data.error || `HTTP ${response.status}`;
    throw new FaroOAuthError(`Google OAuth token refresh failed (${description})`, {
      status: response.status >= 400 && response.status < 600 ? response.status : 502,
      code: errCode,
    });
  }

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

export async function getGoogleAccessToken(accountKey, { configDir, forceRefresh = false } = {}) {
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

  const promise = refreshGoogleAccessToken(accountKey, configDir).finally(() => {
    inflightRefreshes.delete(inflightKey);
  });
  inflightRefreshes.set(inflightKey, promise);
  return promise;
}

async function performGoogleRequest(url, accessToken, init = {}) {
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
    throw new FaroOAuthError(`Network error calling Google API: ${err.message}`, {
      status: 502,
      code: "api_network_error",
    });
  }

  return response;
}

export async function googleFetch(accountKey, url, init = {}, { configDir } = {}) {
  let token = await getGoogleAccessToken(accountKey, { configDir });
  let response = await performGoogleRequest(url, token, init);

  if (response.status === 401) {
    invalidateGoogleAccessToken(accountKey, configDir);
    token = await getGoogleAccessToken(accountKey, { configDir, forceRefresh: true });
    response = await performGoogleRequest(url, token, init);
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
    logger.debug("Google API HTTP %d: %s", response.status, apiMessage);
    throw new FaroOAuthError(`Google API error: ${apiMessage}`, {
      status: response.status,
      code: parsed?.error?.status || "google_api_error",
    });
  }

  return parsed;
}
