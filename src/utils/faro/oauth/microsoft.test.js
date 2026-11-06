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

import { clearMicrosoftTokenCache, getMicrosoftAccessToken, graphFetch } from "./microsoft";
import { readAccount, writeAccount } from "./token-store";

describe("utils/faro/oauth/microsoft", () => {
  let tempDir;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "faro-ms-test-"));
    clearMicrosoftTokenCache();
    global.fetch = vi.fn();

    await writeAccount(
      "polimi",
      {
        provider: "microsoft",
        clientId: "ms-client-id",
        tenant: "organizations",
        refreshToken: "ms-rt-1",
        scopes: ["offline_access", "User.Read", "Mail.Read"],
      },
      tempDir,
    );
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    clearMicrosoftTokenCache();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rotates refresh token on disk and caches access token", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ms-at-1",
          refresh_token: "ms-rt-rotated",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const token = await getMicrosoftAccessToken("polimi", { configDir: tempDir });
    expect(token).toBe("ms-at-1");

    const stored = await readAccount("polimi", "microsoft", tempDir);
    expect(stored.refreshToken).toBe("ms-rt-rotated");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves relative Graph API paths and handles invalid_grant", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "ms-at-1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ unreadItemCount: 2 }), { status: 200 }));

    const inbox = await graphFetch("polimi", "/me/mailFolders/inbox", {}, { configDir: tempDir });
    expect(inbox).toEqual({ unreadItemCount: 2 });
    expect(global.fetch.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/me/mailFolders/inbox");

    clearMicrosoftTokenCache();
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );

    await expect(getMicrosoftAccessToken("polimi", { configDir: tempDir })).rejects.toMatchObject({
      status: 401,
      code: "invalid_grant",
      message: expect.stringContaining("pnpm faro:auth outlook --account polimi"),
    });
  });
});
