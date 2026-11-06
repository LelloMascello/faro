import cache from "memory-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { getServiceWidget, googleFetch, readAccount, FaroOAuthErrorMock, logger } = vi.hoisted(() => {
  class HoistedFaroOAuthError extends Error {
    constructor(message, { status = 500, code = "oauth_error" } = {}) {
      super(message);
      this.name = "FaroOAuthError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    getServiceWidget: vi.fn(),
    googleFetch: vi.fn(),
    readAccount: vi.fn(),
    FaroOAuthErrorMock: HoistedFaroOAuthError,
    logger: { debug: vi.fn(), error: vi.fn() },
  };
});

vi.mock("utils/logger", () => ({ default: () => logger }));
vi.mock("utils/config/service-helpers", () => ({ default: getServiceWidget }));
vi.mock("utils/faro/oauth/google", () => ({ googleFetch }));
vi.mock("utils/faro/oauth/token-store", () => ({
  FaroOAuthError: FaroOAuthErrorMock,
  readAccount,
}));

import gmailProxyHandler from "./proxy";

const req = { query: { group: "La tua giornata", service: "Gmail", index: "0" } };

describe("widgets/gmail/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("returns sample messages in demo mode without calling Google API", async () => {
    getServiceWidget.mockResolvedValueOnce({ type: "gmail", demo: true, maxItems: 2 });
    const res = createMockRes();

    await gmailProxyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.unread).toBe(3);
    expect(res.body.messages).toHaveLength(2);
    expect(googleFetch).not.toHaveBeenCalled();
  });

  it("normalizes Gmail messages, decodes HTML entities, and caches responses", async () => {
    getServiceWidget.mockResolvedValue({ type: "gmail", account: "personale", maxItems: 2 });
    readAccount.mockResolvedValue({ email: "leo@gmail.com" });

    googleFetch
      .mockResolvedValueOnce({ messagesUnread: 4 })
      .mockResolvedValueOnce({ messages: [{ id: "m1" }, { id: "m2" }] })
      .mockResolvedValueOnce({
        id: "m1",
        threadId: "t1",
        snippet: "Pensavo &#39;alle 20&#39; &amp; oltre",
        internalDate: "1762335720000",
        labelIds: ["INBOX", "UNREAD"],
        payload: {
          headers: [
            { name: "From", value: '"Luca Bianchi" <luca@example.com>' },
            { name: "Subject", value: "Ci vediamo sabato?" },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: "m2",
        threadId: "t2",
        snippet: "Aggiornamento",
        internalDate: "1762330000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "GitHub <noreply@github.com>" },
            { name: "Subject", value: "Nuova PR" },
          ],
        },
      });

    const firstRes = createMockRes();
    await gmailProxyHandler(req, firstRes);

    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.body.unread).toBe(4);
    expect(firstRes.body.messages[0]).toMatchObject({
      id: "m1",
      from: "Luca Bianchi",
      subject: "Ci vediamo sabato?",
      snippet: "Pensavo 'alle 20' & oltre",
      unread: true,
      link: "https://mail.google.com/mail/?authuser=leo%40gmail.com#all/t1",
    });
    expect(firstRes.body.messages[1].unread).toBe(false);

    const cachedRes = createMockRes();
    await gmailProxyHandler(req, cachedRes);
    expect(googleFetch).toHaveBeenCalledTimes(4);
    expect(cachedRes.body).toEqual(firstRes.body);
  });

  it("propagates FaroOAuthError status codes cleanly", async () => {
    getServiceWidget.mockResolvedValueOnce({ type: "gmail", account: "unlinked" });
    googleFetch.mockRejectedValueOnce(new FaroOAuthErrorMock("Account not linked", { status: 401 }));

    const res = createMockRes();
    await gmailProxyHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: { message: "Account not linked" } });
  });
});
