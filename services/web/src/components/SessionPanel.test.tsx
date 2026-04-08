import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SessionPanel } from "./SessionPanel";

describe("SessionPanel", () => {
  it("shows the Start button when idle", () => {
    render(
      <SessionPanel
        status="idle"
        suggestions={[]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /start session/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /end session/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the End button when active", () => {
    render(
      <SessionPanel
        status="active"
        suggestions={[]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /end session/i })).toBeInTheDocument();
  });

  it("renders suggestions in order", () => {
    render(
      <SessionPanel
        status="active"
        suggestions={[
          { id: "1", intent: "discovery", suggestion: "Ask about metrics", sentiment: 0 },
          { id: "2", intent: "qualify_budget", suggestion: "Confirm budget", sentiment: 1 },
        ]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ask about metrics");
    expect(items[1]).toHaveTextContent("Confirm budget");
  });

  it("calls onStart when Start clicked", () => {
    const onStart = vi.fn();
    render(
      <SessionPanel status="idle" suggestions={[]} onStart={onStart} onEnd={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("calls onEnd when End clicked", () => {
    const onEnd = vi.fn();
    render(
      <SessionPanel status="active" suggestions={[]} onStart={() => {}} onEnd={onEnd} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /end session/i }));
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("renders the live status line with the current status", () => {
    render(
      <SessionPanel
        status="connecting"
        suggestions={[]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    const statusLine = screen.getByTestId("status-line");
    expect(statusLine).toHaveTextContent(/status/i);
    expect(statusLine).toHaveTextContent(/connecting/i);
    expect(statusLine).toHaveAttribute("aria-live", "polite");
  });
});
