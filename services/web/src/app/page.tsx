"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SessionPanel, type RenderedSuggestion, type SessionStatus } from "@/components/SessionPanel";
import { AuthControls } from "@/components/AuthControls";
import { captureMeetingTabAudio, AudioCaptureError } from "@/lib/audioCapture";
import { SessionWebSocket } from "@/lib/wsClient";
import type { ServerMessage } from "@/lib/protocol";
import { useAuth } from "@/hooks/useAuth";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:8080/ws/session";

export default function HomePage() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<RenderedSuggestion[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const { user } = useAuth();

  const wsRef = useRef<SessionWebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close("cleanup");
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    sessionStartedAtRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "session_started") {
      setStatus("active");
      setSessionId(msg.sessionId);
      sessionStartedAtRef.current = msg.startedAtMs;
      return;
    }
    if (msg.type === "suggestion") {
      const startedAt = sessionStartedAtRef.current;
      const offsetMs = startedAt !== null ? msg.tickAtMs - startedAt : undefined;
      setSuggestions((prev) => [
        ...prev,
        {
          id: `${msg.tickAtMs}-${prev.length}`,
          intent: msg.intent,
          suggestion: msg.suggestion,
          sentiment: msg.sentiment,
          tickOffsetMs: offsetMs,
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
    setSessionId(undefined);
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

    // Always re-fetch the ID token right before opening the WS — Firebase
    // silently refreshes if the cached one is near expiry.
    const idToken = user ? await user.getIdToken() : undefined;

    const ws = new SessionWebSocket({
      url: GATEWAY_URL,
      onOpen: () => {
        ws.sendClientHello("0.1.0", idToken);
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
  }, [cleanup, handleServerMessage, user]);

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
        sessionId={sessionId}
        authSlot={<AuthControls />}
      />
    </main>
  );
}
