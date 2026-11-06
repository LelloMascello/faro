// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";

const { useWidgetAPI } = vi.hoisted(() => ({ useWidgetAPI: vi.fn() }));
vi.mock("utils/proxy/use-widget-api", () => ({ default: useWidgetAPI }));

import Component from "./component";

function render(serviceOverrides = {}) {
  return renderWithProviders(
    <Component
      service={{
        href: "https://mail.google.com",
        widget: { type: "gmail" },
        ...serviceOverrides,
      }}
    />,
    { settings: { hideErrors: false } },
  );
}

describe("widgets/gmail/component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders skeleton while loading", () => {
    useWidgetAPI.mockReturnValue({ data: undefined, error: undefined });
    const { container } = render();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("renders unread badge, messages, and footer link", () => {
    useWidgetAPI.mockReturnValue({
      data: {
        unread: 3,
        messages: [
          {
            id: "1",
            from: "Luca Bianchi",
            subject: "Ci vediamo sabato?",
            snippet: "Pensavo di prenotare…",
            date: "2026-11-05T09:42:00Z",
            unread: true,
            link: "https://mail.google.com/#1",
          },
        ],
      },
      error: undefined,
    });

    render();

    expect(screen.getByText("faromail.unread")).toBeInTheDocument();
    expect(screen.getByText("Luca Bianchi")).toBeInTheDocument();
    expect(screen.getByText(/faromail\.openMail/)).toBeInTheDocument();
  });

  it("renders Container error when API fails", () => {
    useWidgetAPI.mockReturnValue({ data: undefined, error: { message: "Token expired" } });
    render();
    expect(screen.getAllByText(/Token expired/).length).toBeGreaterThan(0);
  });
});
