import { DateTime } from "luxon";
import cache from "memory-cache";

import getServiceWidget from "utils/config/service-helpers";
import { decodeHtmlEntities, parseMaxItems, parseSenderHeader } from "utils/faro/mail-helpers";
import { googleFetch } from "utils/faro/oauth/google";
import { FaroOAuthError, readAccount } from "utils/faro/oauth/token-store";
import createLogger from "utils/logger";

const logger = createLogger("gmailProxyHandler");
const CACHE_TTL_MS = 2 * 60 * 1000;
const PROFILE_TTL_MS = 60 * 60 * 1000;
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function getHeader(headers, targetName) {
  if (!Array.isArray(headers)) {
    return "";
  }
  const lower = targetName.toLowerCase();
  const found = headers.find((h) => h?.name?.toLowerCase() === lower);
  return found?.value ?? "";
}

function buildDemoPayload(maxItems) {
  const today = DateTime.local();
  const sample = [
    {
      id: "demo-gmail-1",
      from: "Luca Bianchi",
      subject: "Ci vediamo sabato?",
      snippet: "Pensavo di prenotare per le 20…",
      date: today.set({ hour: 10, minute: 42, second: 0, millisecond: 0 }).toISO(),
      unread: true,
      link: "https://mail.google.com",
    },
    {
      id: "demo-gmail-2",
      from: "GitHub",
      subject: "Nuova attività su FARO",
      snippet: "Il repository è stato aggiornato…",
      date: today.set({ hour: 9, minute: 18, second: 0, millisecond: 0 }).toISO(),
      unread: true,
      link: "https://mail.google.com",
    },
    {
      id: "demo-gmail-3",
      from: "Newsletter",
      subject: "Le novità della settimana",
      snippet: "Progetti e letture da scoprire…",
      date: today.set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toISO(),
      unread: false,
      link: "https://mail.google.com",
    },
  ];

  return {
    unread: 3,
    messages: sample.slice(0, maxItems),
  };
}

async function resolveGmailEmail(accountKey) {
  const profileCacheKey = `faro:gmail:profile:${accountKey}`;
  const cached = cache.get(profileCacheKey);
  if (cached) {
    return cached;
  }

  const stored = await readAccount(accountKey, "google");
  if (stored?.email) {
    cache.put(profileCacheKey, stored.email, PROFILE_TTL_MS);
    return stored.email;
  }

  try {
    const profile = await googleFetch(accountKey, `${GMAIL_API_BASE}/profile`);
    if (profile?.emailAddress) {
      cache.put(profileCacheKey, profile.emailAddress, PROFILE_TTL_MS);
      return profile.emailAddress;
    }
  } catch (err) {
    logger.debug("Unable to fetch Gmail profile email for '%s': %s", accountKey, err.message);
  }
  return null;
}

function buildMessageLink(email, threadIdOrMsgId) {
  const safeId = encodeURIComponent(threadIdOrMsgId);
  if (email) {
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${safeId}`;
  }
  return `https://mail.google.com/mail/u/0/#all/${safeId}`;
}

export default async function gmailProxyHandler(req, res) {
  const { group, service, index } = req.query;
  const widget = await getServiceWidget(group, service, index);

  if (!widget) {
    return res.status(400).json({ error: { message: "Invalid widget configuration" } });
  }

  const maxItems = parseMaxItems(widget.maxItems, 3, 20);

  if (widget.demo === true || widget.demo === "true") {
    return res.status(200).json(buildDemoPayload(maxItems));
  }

  const accountKey = widget.account;
  const query = typeof widget.query === "string" ? widget.query.trim() : "";
  const cacheKey = `faro:gmail:data:${accountKey}:${query}:${maxItems}`;

  const cachedPayload = cache.get(cacheKey);
  if (cachedPayload) {
    return res.status(200).json(cachedPayload);
  }

  try {
    const listParams = new URLSearchParams({
      maxResults: String(maxItems),
    });
    if (query) {
      listParams.set("q", query);
    } else {
      listParams.set("labelIds", "INBOX");
    }

    const [inboxLabel, listData, email] = await Promise.all([
      googleFetch(accountKey, `${GMAIL_API_BASE}/labels/INBOX`),
      googleFetch(accountKey, `${GMAIL_API_BASE}/messages?${listParams.toString()}`),
      resolveGmailEmail(accountKey),
    ]);

    const rawRefs = Array.isArray(listData?.messages) ? listData.messages.slice(0, maxItems) : [];

    const details = await Promise.all(
      rawRefs.map((ref) =>
        googleFetch(
          accountKey,
          `${GMAIL_API_BASE}/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        ),
      ),
    );

    const messages = details.filter(Boolean).map((msg) => {
      const headers = msg?.payload?.headers ?? [];
      const from = parseSenderHeader(getHeader(headers, "From")) || "(Sconosciuto)";
      const subject = decodeHtmlEntities(getHeader(headers, "Subject")).trim() || "(Nessun oggetto)";
      const snippet = decodeHtmlEntities(msg?.snippet || "").replace(/\s+/g, " ").trim();
      const internalMs = Number(msg?.internalDate);
      const dateHeader = getHeader(headers, "Date");
      let isoDate = null;
      if (Number.isFinite(internalMs) && internalMs > 0) {
        isoDate = new Date(internalMs).toISOString();
      } else if (dateHeader) {
        const parsedDate = new Date(dateHeader);
        if (!Number.isNaN(parsedDate.getTime())) {
          isoDate = parsedDate.toISOString();
        }
      }

      const labelIds = Array.isArray(msg?.labelIds) ? msg.labelIds : [];
      return {
        id: msg.id,
        from,
        subject,
        snippet,
        date: isoDate,
        unread: labelIds.includes("UNREAD"),
        link: buildMessageLink(email, msg.threadId || msg.id),
      };
    });

    const payload = {
      unread: Number(inboxLabel?.messagesUnread) || 0,
      messages,
    };

    cache.put(cacheKey, payload, CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (err) {
    if (err instanceof FaroOAuthError) {
      logger.debug("Gmail OAuth/API error for '%s': %s", accountKey, err.message);
      return res.status(err.status || 500).json({ error: { message: err.message } });
    }
    logger.error("Unexpected error in gmailProxyHandler: %s", err.message);
    return res.status(500).json({ error: { message: "Unexpected error loading Gmail data" } });
  }
}
