import { DateTime } from "luxon";
import cache from "memory-cache";

import getServiceWidget from "utils/config/service-helpers";
import { decodeHtmlEntities, parseMaxItems } from "utils/faro/mail-helpers";
import { graphFetch } from "utils/faro/oauth/microsoft";
import { FaroOAuthError } from "utils/faro/oauth/token-store";
import createLogger from "utils/logger";

const logger = createLogger("outlookProxyHandler");
const CACHE_TTL_MS = 2 * 60 * 1000;

function buildDemoPayload(maxItems) {
  const today = DateTime.local();
  const sample = [
    {
      id: "demo-outlook-1",
      from: "Segreteria studenti",
      subject: "Aggiornamento calendario esami",
      snippet: "Sono disponibili le nuove date…",
      date: today.set({ hour: 11, minute: 5, second: 0, millisecond: 0 }).toISO(),
      unread: true,
      link: "https://outlook.office.com/mail/",
    },
    {
      id: "demo-outlook-2",
      from: "Prof. Rossi",
      subject: "Materiale della prossima lezione",
      snippet: "Trovate le slide su WeBeep…",
      date: today.set({ hour: 9, minute: 45, second: 0, millisecond: 0 }).toISO(),
      unread: true,
      link: "https://outlook.office.com/mail/",
    },
    {
      id: "demo-outlook-3",
      from: "Gruppo progetto",
      subject: "Revisione della relazione",
      snippet: "Ho caricato la nuova versione…",
      date: today.set({ hour: 8, minute: 15, second: 0, millisecond: 0 }).toISO(),
      unread: false,
      link: "https://outlook.office.com/mail/",
    },
  ];

  return {
    unread: 2,
    messages: sample.slice(0, maxItems),
  };
}

function formatOutlookSender(fromObj) {
  const emailAddr = fromObj?.emailAddress;
  if (!emailAddr) {
    return "(Sconosciuto)";
  }
  const name = (emailAddr.name || "").trim();
  if (name) {
    return decodeHtmlEntities(name);
  }
  return emailAddr.address || "(Sconosciuto)";
}

export default async function outlookProxyHandler(req, res) {
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
  const focusedOnly = widget.focusedOnly === true || widget.focusedOnly === "true";
  const cacheKey = `faro:outlook:data:${accountKey}:${focusedOnly ? "focused" : "all"}:${maxItems}`;

  const cachedPayload = cache.get(cacheKey);
  if (cachedPayload) {
    return res.status(200).json(cachedPayload);
  }

  try {
    const msgParams = new URLSearchParams({
      $top: String(maxItems),
      $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,webLink",
      $orderby: "receivedDateTime desc",
    });

    if (focusedOnly) {
      msgParams.set(
        "$filter",
        "inferenceClassification eq 'focused' and receivedDateTime ge 1970-01-01T00:00:00Z",
      );
    }

    const [folderInfo, messagesData] = await Promise.all([
      graphFetch(accountKey, "/me/mailFolders/inbox?$select=unreadItemCount"),
      graphFetch(accountKey, `/me/mailFolders/inbox/messages?${msgParams.toString()}`),
    ]);

    const rawList = Array.isArray(messagesData?.value) ? messagesData.value.slice(0, maxItems) : [];

    const messages = rawList.map((msg) => ({
      id: msg.id,
      from: formatOutlookSender(msg.from),
      subject: decodeHtmlEntities(msg.subject || "").trim() || "(Nessun oggetto)",
      snippet: decodeHtmlEntities(msg.bodyPreview || "").replace(/\s+/g, " ").trim(),
      date: msg.receivedDateTime || null,
      unread: msg.isRead === false,
      link: msg.webLink || "https://outlook.office.com/mail/",
    }));

    const payload = {
      unread: Number(folderInfo?.unreadItemCount) || 0,
      messages,
    };

    cache.put(cacheKey, payload, CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (err) {
    if (err instanceof FaroOAuthError) {
      logger.debug("Outlook OAuth/Graph error for '%s': %s", accountKey, err.message);
      return res.status(err.status || 500).json({ error: { message: err.message } });
    }
    logger.error("Unexpected error in outlookProxyHandler: %s", err.message);
    return res.status(500).json({ error: { message: "Unexpected error loading Outlook data" } });
  }
}
