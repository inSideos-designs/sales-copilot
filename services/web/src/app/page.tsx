"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SessionPanel, type RenderedSuggestion, type SessionStatus } from "@/components/SessionPanel";
import { captureMeetingTabAudio, AudioCaptureError } from "@/lib/audioCapture";
import { SessionWebSocket } from "@/lib/wsClient";
import type { ServerMessage } from "@/lib/protocol";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:8080/ws/session";

export default function HomePage() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<RenderedSuggestion[]>([]);

  const wsRef = useRef<SessionWebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close("cleanup");
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "session_started") {
      setStatus("active");
      return;
    }
    if (msg.type === "suggestion") {
      setSuggestions((prev) => [
        ...prev,
        {
          id: `${msg.tickAtMs}-${prev.length}`,
          intent: msg.intent,
          suggestion: msg.suggestion,
          sentiment: msg.sentiment,
        },
      ]);
      return;
    }
    if (msg.type === "error") {
      setErrorMessage(`${msg.code}: ${msg.message}`);
      return;
    }
  }, []);

  const handleStart = useCallback(async () => {
    setErrorMessage(undefined);
    setSuggestions([]);
    setStatus("connecting");

    try {
      streamRef.current = await captureMeetingTabAudio();
    } catch (err) {
      if (err instanceof AudioCaptureError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage((err as Error).message);
      }
      setStatus("error");
      return;
    }

    const ws = new SessionWebSocket({
      url: GATEWAY_URL,
      onOpen: () => {
        ws.sendClientHello("0.1.0");
      },
      onMessage: handleServerMessage,
      onClose: () => {
        cleanup();
        setStatus((prev) => (prev === "error" ? "error" : "ended"));
      },
      onError: () => {
        setErrorMessage("WebSocket error. Is the gateway running?");
        setStatus("error");
        cleanup();
      },
    });
    wsRef.current = ws;
    ws.connect();
  }, [cleanup, handleServerMessage]);

  const handleEnd = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.sendEndSession("user_clicked_end");
    }
    cleanup();
    setStatus("ended");
  }, [cleanup]);

  return (
    <main className="min-h-screen">
      <SessionPanel
        status={status}
        suggestions={suggestions}
        onStart={handleStart}
        onEnd={handleEnd}
        errorMessage={errorMessage}
      />
    </main>
  );
}
