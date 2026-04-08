// Mirror of services/gateway/src/sales_copilot_gateway/protocol.py.
// If you change one, change the other.

export type ClientMessage =
  | { type: "client_hello"; clientVersion: string; idToken?: string }
  | { type: "end_session"; reason: string };

export type ServerMessage =
  | { type: "session_started"; sessionId: string; startedAtMs: number }
  | {
      type: "suggestion";
      tickAtMs: number;
      sentiment: number;
      intent: string;
      suggestion: string;
      confidence: number;
    }
  | { type: "error"; code: string; message: string };

export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function parseServerMessage(raw: string): ServerMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ProtocolError(`invalid JSON: ${(err as Error).message}`);
  }
  if (typeof data !== "object" || data === null) {
    throw new ProtocolError("message must be a JSON object");
  }
  const obj = data as Record<string, unknown>;
  const type = obj.type;

  if (type === "session_started") {
    return {
      type: "session_started",
      sessionId: String(obj.sessionId ?? ""),
      startedAtMs: Number(obj.startedAtMs ?? 0),
    };
  }
  if (type === "suggestion") {
    return {
      type: "suggestion",
      tickAtMs: Number(obj.tickAtMs ?? 0),
      sentiment: Number(obj.sentiment ?? 0),
      intent: String(obj.intent ?? ""),
      suggestion: String(obj.suggestion ?? ""),
      confidence: Number(obj.confidence ?? 0),
    };
  }
  if (type === "error") {
    return {
      type: "error",
      code: String(obj.code ?? ""),
      message: String(obj.message ?? ""),
    };
  }
  throw new ProtocolError(`unknown message type: ${String(type)}`);
}
