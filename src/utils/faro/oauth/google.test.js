import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

vi.mock("utils/logger", () => ({
  default: () => logger,
}));

import { clearGoogleTokenCache, getGoogleAccessToken, googleFetch } from "./google";
import { readAccount, writeAccount } from "./token-store";

describe("utils/faro/oauth/google", () => {
  let tempDir;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "faro-google-test-"));
    clearGoogleTokenCache();
    global.fetch = vi.fn();

    await writeAccount(
      "personale",
      {
        provider: "google",
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        refreshToken: "rt-1",
      },
      tempDir,
    );
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    clearGoogleTokenCache();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("caches refreshed access tokens and deduplicates concurrent refreshes", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), { status: 200 }),
    );

    const [t1, t2] = await Promise.all([
      getGoogleAccessToken("personale", { configDir: tempDir }),
      getGoogleAccessToken("personale", { configDir: tempDir }),
    ]);

    expect(t1).toBe("at-1");
    expect(t2).toBe("at-1");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const cached = await getGoogleAccessToken("personale", { configDir: tempDir });
    expect(cached).toBe("at-1");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws 401 invalid_grant with re-link instructions when refresh token is revoked", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), {
        status: 400,
      }),
    );

    await expect(getGoogleAccessToken("personale", { configDir: tempDir })).rejects.toMatchObject({
      status: 401,
      code: "invalid_grant",
      message: expect.stringContaining("pnpm faro:auth google --account personale"),
    });
  });

  it("persists rotated refresh tokens and retries once on 401 during googleFetch", async () => {
    global.fetch
      // initial token refresh
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "stale-at", refresh_token: "rt-2", expires_in: 3600 }), {
          status: 200,
        }),
      )
      // first API call returns 401
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }))
      // forced refresh returns fresh token
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh-at", expires_in: 3600 }), { status: 200 }))
      // retried API call succeeds
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "user@gmail.com" }), { status: 200 }));

    const result = await googleFetch(
      "personale",
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {},
      { configDir: tempDir },
    );

    expect(result).toEqual({ emailAddress: "user@gmail.com" });
    const stored = await readAccount("personale", "google", tempDir);
    expect(stored.refreshToken).toBe("rt-2");
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
