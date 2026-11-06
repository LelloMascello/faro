// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import MailList, { formatMailTimestamp } from "./mail-list";

import { renderWithProviders } from "test-utils/render-with-providers";

describe("components/faro/mail-list", () => {
  it("formats today, yesterday, and older timestamps", () => {
    const t = (key) => key;
    const now = DateTime.local();

    const todayIso = now.set({ hour: 10, minute: 42 }).toISO();
    expect(formatMailTimestamp(todayIso, t, "it")).toBe("10:42");

    const yesterdayIso = now.minus({ days: 1 }).set({ hour: 14, minute: 0 }).toISO();
    expect(formatMailTimestamp(yesterdayIso, t, "it")).toBe("faromail.yesterday");

    const olderIso = DateTime.local(2025, 3, 12, 9, 0).toISO();
    expect(formatMailTimestamp(olderIso, t, "en")).toMatch(/12\s+Mar/i);
  });

  it("renders skeleton rows when loading", () => {
    const { container } = renderWithProviders(<MailList loading skeletonCount={3} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("renders empty state when messages array is empty", () => {
    renderWithProviders(<MailList messages={[]} />);
    expect(screen.getByText("faromail.noMail")).toBeInTheDocument();
  });

  it("renders unread dots only for unread messages and links rows", () => {
    const messages = [
      {
        id: "1",
        from: "Luca Bianchi",
        subject: "Ci vediamo sabato?",
        snippet: "Pensavo di prenotare…",
        date: DateTime.local().set({ hour: 10, minute: 42 }).toISO(),
        unread: true,
        link: "https://mail.google.com/#1",
      },
      {
        id: "2",
        from: "Newsletter",
        subject: "Novità",
        snippet: "Progetti…",
        date: DateTime.local().set({ hour: 8, minute: 30 }).toISO(),
        unread: false,
        link: null,
      },
    ];

    renderWithProviders(<MailList messages={messages} target="_self" />);

    expect(screen.getAllByTestId("unread-dot")).toHaveLength(1);
    const link = screen.getByText("Luca Bianchi").closest("a");
    expect(link).toHaveAttribute("href", "https://mail.google.com/#1");
    expect(link).toHaveAttribute("target", "_self");
    expect(screen.getByText("Newsletter").closest("a")).toBeNull();
  });
});
