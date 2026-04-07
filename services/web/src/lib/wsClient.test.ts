import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { SessionWebSocket } from "./wsClient";
import type { ServerMessage } from "./protocol";

// Fake WebSocket constructor that captures the instance so tests can drive it.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  // Mirror the standard WebSocket.OPEN constant so wsClient.send() readyState
  // checks succeed when this fake replaces the global WebSocket constructor.
  static OPEN = 1;
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: (ev: { code: number; reason: string }) => void;
  onerror?: (ev: Event) => void;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  // Test helpers
  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  emitMessage(data: string) {
    this.onmessage?.({ data });
  }
}

describe("SessionWebSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    FakeWebSocket.instances = [];
  });

  it("connects to the given URL and fires onOpen", () => {
    const onOpen = vi.fn();
    const ws = new SessionWebSocket({ url: "ws://example/ws/session", onOpen, onMessage: () => {}, onClose: () => {} });
    ws.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe("ws://example/ws/session");

    FakeWebSocket.instances[0].emitOpen();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("parses and forwards server messages", () => {
    const received: ServerMessage[] = [];
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: (msg) => received.push(msg),
      onClose: () => {},
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();

    FakeWebSocket.instances[0].emitMessage(
      JSON.stringify({
        type: "suggestion",
        tickAtMs: 1,
        sentiment: 1,
        intent: "discovery",
        suggestion: "Ask X",
        confidence: 0.9,
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "suggestion", suggestion: "Ask X" });
  });

  it("sends client messages as JSON", () => {
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: () => {},
      onClose: () => {},
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();

    ws.sendEndSession("user_clicked_end");

    expect(FakeWebSocket.instances[0].sent).toHaveLength(1);
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toEqual({
      type: "end_session",
      reason: "user_clicked_end",
    });
  });

  it("fires onClose when underlying socket closes", () => {
    const onClose = vi.fn();
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: () => {},
      onClose,
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();
    FakeWebSocket.instances[0].close(1000, "bye");

    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: "bye" });
  });
});
