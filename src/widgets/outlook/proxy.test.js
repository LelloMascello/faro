import cache from "memory-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { getServiceWidget, graphFetch, FaroOAuthErrorMock, logger } = vi.hoisted(() => {
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
    graphFetch: vi.fn(),
    FaroOAuthErrorMock: HoistedFaroOAuthError,
    logger: { debug: vi.fn(), error: vi.fn() },
  };
});

vi.mock("utils/logger", () => ({ default: () => logger }));
vi.mock("utils/config/service-helpers", () => ({ default: getServiceWidget }));
vi.mock("utils/faro/oauth/microsoft", () => ({ graphFetch }));
vi.mock("utils/faro/oauth/token-store", () => ({
  FaroOAuthError: FaroOAuthErrorMock,
}));

import outlookProxyHandler from "./proxy";

const req = { query: { group: "La tua giornata", service: "Outlook", index: "0" } };

describe("widgets/outlook/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("returns sample messages in demo mode", async () => {
    getServiceWidget.mockResolvedValueOnce({ type: "outlook", demo: true });
    const res = createMockRes();

    await outlookProxyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.unread).toBe(2);
    expect(res.body.messages).toHaveLength(3);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("fetches inbox unread count and messages with focusedOnly filter", async () => {
    getServiceWidget.mockResolvedValue({
      type: "outlook",
      account: "polimi",
      maxItems: 2,
      focusedOnly: true,
    });

    graphFetch.mockResolvedValueOnce({ unreadItemCount: 2 }).mockResolvedValueOnce({
      value: [
        {
          id: "o1",
          subject: "Aggiornamento calendario esami",
          from: { emailAddress: { name: "Segreteria studenti", address: "segreteria@polimi.it" } },
          receivedDateTime: "2026-11-05T10:05:00Z",
          bodyPreview: "Sono disponibili le nuove date…",
          isRead: false,
          webLink: "https://outlook.office.com/owa/?ItemID=o1",
        },
        {
          id: "o2",
          subject: "Revisione",
          from: { emailAddress: { name: "", address: "gruppo@polimi.it" } },
          receivedDateTime: "2026-11-05T07:15:00Z",
          bodyPreview: "Ho caricato la nuova versione",
          isRead: true,
          webLink: "",
        },
      ],
    });

    const res = createMockRes();
    await outlookProxyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(graphFetch.mock.calls[1][1]).toContain("inferenceClassification+eq+%27focused%27");
    expect(res.body).toEqual({
      unread: 2,
      messages: [
        {
          id: "o1",
          from: "Segreteria studenti",
          subject: "Aggiornamento calendario esami",
          snippet: "Sono disponibili le nuove date…",
          date: "2026-11-05T10:05:00Z",
          unread: true,
          link: "https://outlook.office.com/owa/?ItemID=o1",
        },
        {
          id: "o2",
          from: "gruppo@polimi.it",
          subject: "Revisione",
          snippet: "Ho caricato la nuova versione",
          date: "2026-11-05T07:15:00Z",
          unread: false,
          link: "https://outlook.office.com/mail/",
        },
      ],
    });
  });

  it("handles FaroOAuthError status codes", async () => {
    getServiceWidget.mockResolvedValueOnce({ type: "outlook", account: "polimi" });
    graphFetch.mockRejectedValueOnce(new FaroOAuthErrorMock("Need admin approval", { status: 403 }));

    const res = createMockRes();
    await outlookProxyHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: { message: "Need admin approval" } });
  });
});
