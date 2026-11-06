import { describe, expect, it } from "vitest";

import { decodeHtmlEntities, parseMaxItems, parseSenderHeader } from "./mail-helpers";

describe("utils/faro/mail-helpers", () => {
  it("decodes named, decimal, and hex HTML entities", () => {
    expect(decodeHtmlEntities("Pensavo &quot;per le 20&quot; &#39;sabato&#39; &amp; &#x2026;")).toBe(
      "Pensavo \"per le 20\" 'sabato' & …",
    );
    expect(decodeHtmlEntities("")).toBe("");
  });

  it("extracts display names or email addresses from From headers", () => {
    expect(parseSenderHeader('"Luca Bianchi" <luca@example.com>')).toBe("Luca Bianchi");
    expect(parseSenderHeader("GitHub <noreply@github.com>")).toBe("GitHub");
    expect(parseSenderHeader("<noreply@github.com>")).toBe("noreply@github.com");
    expect(parseSenderHeader("plain@example.com")).toBe("plain@example.com");
  });

  it("clamps maxItems within valid bounds", () => {
    expect(parseMaxItems(undefined, 3, 20)).toBe(3);
    expect(parseMaxItems("abc", 3, 20)).toBe(3);
    expect(parseMaxItems(-2, 3, 20)).toBe(3);
    expect(parseMaxItems("5", 3, 20)).toBe(5);
    expect(parseMaxItems(99, 3, 20)).toBe(20);
  });
});
