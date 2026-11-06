const NAMED_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&hellip;": "…",
};

export function decodeHtmlEntities(input) {
  if (!input || typeof input !== "string") {
    return "";
  }

  return input
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip|#39);/gi, (match) => {
      const lower = match.toLowerCase();
      return NAMED_ENTITIES[lower] ?? match;
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    });
}

export function parseSenderHeader(rawFrom) {
  if (!rawFrom || typeof rawFrom !== "string") {
    return "";
  }
  const trimmed = rawFrom.trim();
  const angleMatch = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const displayName = angleMatch[1].trim().replace(/^["']|["']$/g, "").trim();
    if (displayName) {
      return decodeHtmlEntities(displayName);
    }
    return angleMatch[2].trim();
  }
  return decodeHtmlEntities(trimmed.replace(/^["']|["']$/g, ""));
}

export function parseMaxItems(rawValue, fallback = 3, max = 20) {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}
