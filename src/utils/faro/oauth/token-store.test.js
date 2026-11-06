import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FaroOAuthError, getStorePath, readAccount, readTokenStore, writeAccount } from "./token-store";

describe("utils/faro/oauth/token-store", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "faro-oauth-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns empty store when faro-oauth.json does not exist", async () => {
    const store = await readTokenStore(tempDir);
    expect(store).toEqual({ version: 1, accounts: {} });
  });

  it("writes accounts atomically with 0600 permissions and merges concurrent writes", async () => {
    await Promise.all([
      writeAccount(
        "personale",
        {
          provider: "google",
          clientId: "gid",
          clientSecret: "gsecret",
          refreshToken: "rt-google",
        },
        tempDir,
      ),
      writeAccount(
        "polimi",
        {
          provider: "microsoft",
          clientId: "mid",
          tenant: "common",
          refreshToken: "rt-ms",
        },
        tempDir,
      ),
    ]);

    const googleAcc = await readAccount("personale", "google", tempDir);
    const msAcc = await readAccount("polimi", "microsoft", tempDir);

    expect(googleAcc.refreshToken).toBe("rt-google");
    expect(msAcc.refreshToken).toBe("rt-ms");

    const fileStat = await stat(getStorePath(tempDir));
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("updates an existing account preserving untouched fields", async () => {
    await writeAccount(
      "polimi",
      {
        provider: "microsoft",
        clientId: "mid",
        tenant: "organizations",
        refreshToken: "old-token",
        email: "studente@polimi.it",
      },
      tempDir,
    );

    await writeAccount("polimi", { refreshToken: "rotated-token" }, tempDir);
    const updated = await readAccount("polimi", "microsoft", tempDir);

    expect(updated.refreshToken).toBe("rotated-token");
    expect(updated.email).toBe("studente@polimi.it");
    expect(updated.tenant).toBe("organizations");
  });

  it("throws actionable FaroOAuthError for missing config, missing account, or provider mismatch", async () => {
    await expect(readAccount("", "google", tempDir)).rejects.toMatchObject({
      name: "FaroOAuthError",
      status: 400,
      code: "missing_account_config",
    });

    await expect(readAccount("missing", "microsoft", tempDir)).rejects.toMatchObject({
      name: "FaroOAuthError",
      status: 401,
      code: "account_not_linked",
    });

    await writeAccount(
      "personale",
      {
        provider: "google",
        clientId: "gid",
        refreshToken: "rt",
      },
      tempDir,
    );

    await expect(readAccount("personale", "microsoft", tempDir)).rejects.toMatchObject({
      status: 400,
      code: "provider_mismatch",
    });
  });

  it("throws FaroOAuthError when faro-oauth.json is corrupted", async () => {
    await writeFile(getStorePath(tempDir), "{not-json", "utf8");
    await expect(readTokenStore(tempDir)).rejects.toBeInstanceOf(FaroOAuthError);
  });
});
