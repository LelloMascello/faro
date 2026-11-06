// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";

const { useWidgetAPI } = vi.hoisted(() => ({ useWidgetAPI: vi.fn() }));
vi.mock("utils/proxy/use-widget-api", () => ({ default: useWidgetAPI }));

import Component from "./component";

describe("widgets/outlook/component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders skeleton while loading and fallback link when href is omitted", () => {
    useWidgetAPI.mockReturnValue({ data: undefined, error: undefined });
    const { container } = renderWithProviders(<Component service={{ widget: { type: "outlook" } }} />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
    const footerLink = screen.getByText(/faromail\.openMail/).closest("a");
    expect(footerLink).toHaveAttribute("href", "https://outlook.office.com/mail/");
  });

  it("renders Outlook messages and unread badge", () => {
    useWidgetAPI.mockReturnValue({
      data: {
        unread: 2,
        messages: [
          {
            id: "o1",
            from: "Prof. Rossi",
            subject: "Materiale della prossima lezione",
            snippet: "Trovate le slide su WeBeep…",
            date: "2026-11-05T08:45:00Z",
            unread: true,
            link: "https://outlook.office.com/mail/",
          },
        ],
      },
      error: undefined,
    });

    renderWithProviders(<Component service={{ widget: { type: "outlook" } }} />);

    expect(screen.getByText("faromail.unread")).toBeInTheDocument();
    expect(screen.getByText("Prof. Rossi")).toBeInTheDocument();
  });
});
