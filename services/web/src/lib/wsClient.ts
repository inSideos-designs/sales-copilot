import {
  parseServerMessage,
  serializeClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";

interface SessionWebSocketOptions {
  url: string;
  onOpen: () => void;
  onMessage: (msg: ServerMessage) => void;
  onClose: (ev: { code: number; reason: string }) => void;
  onError?: (err: unknown) => void;
}

export class SessionWebSocket {
  private readonly opts: SessionWebSocketOptions;
  private ws: WebSocket | null = null;

  constructor(opts: SessionWebSocketOptions) {
    this.opts = opts;
  }

  connect(): void {
    if (this.ws) {
      return;
    }
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.opts.onOpen();
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = parseServerMessage(ev.data);
        this.opts.onMessage(msg);
      } catch (err) {
        if (this.opts.onError) {
          this.opts.onError(err);
        }
      }
    };

    ws.onclose = (ev) => {
      // Tear down before notifying so a synchronous reconnect from inside
      // the user's onClose handler sees a clean slate.
      this.ws = null;
      this.opts.onClose({ code: ev.code, reason: ev.reason });
    };

    ws.onerror = (ev) => {
      if (this.opts.onError) {
        this.opts.onError(ev);
      }
    };
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(serializeClientMessage(msg));
  }

  sendClientHello(clientVersion: string): void {
    this.send({ type: "client_hello", clientVersion });
  }

  sendEndSession(reason: string): void {
    this.send({ type: "end_session", reason });
  }

  close(reason = ""): void {
    if (this.ws) {
      this.ws.close(1000, reason);
    }
  }
}
