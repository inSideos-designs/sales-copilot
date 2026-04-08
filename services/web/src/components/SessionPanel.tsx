"use client";

import { cn } from "@/lib/utils";

export type SessionStatus = "idle" | "connecting" | "active" | "ended" | "error";

/**
 * UI view-model for a suggestion. Mapped from the protocol's `SuggestionMessage`
 * by the parent container — `id` is synthesized client-side (the wire format
 * has no stable id), and `confidence` / `tickAtMs` are dropped from the type
 * but the parent passes the wall-clock offset via `tickOffsetMs` so we can
 * render the editorial "T+05.2s" timestamp.
 */
export interface RenderedSuggestion {
  id: string;
  intent: string;
  suggestion: string;
  sentiment: number;
  tickOffsetMs?: number;
}

interface Props {
  status: SessionStatus;
  suggestions: RenderedSuggestion[];
  onStart: () => void;
  onEnd: () => void;
  errorMessage?: string;
  sessionId?: string;
}

const SENTIMENT_SPINE: Record<number, string> = {
  [-2]: "var(--color-sentiment-very-negative)",
  [-1]: "var(--color-sentiment-negative)",
  [0]: "var(--color-sentiment-neutral)",
  [1]: "var(--color-sentiment-positive)",
  [2]: "var(--color-sentiment-very-positive)",
};

function spineColor(sentiment: number): string {
  if (sentiment <= -2) return SENTIMENT_SPINE[-2];
  if (sentiment === -1) return SENTIMENT_SPINE[-1];
  if (sentiment === 0) return SENTIMENT_SPINE[0];
  if (sentiment === 1) return SENTIMENT_SPINE[1];
  return SENTIMENT_SPINE[2];
}

const STATUS_GLYPH: Record<SessionStatus, string> = {
  idle: "○",
  connecting: "◐",
  active: "●",
  ended: "■",
  error: "✕",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "IDLE",
  connecting: "CONNECTING",
  active: "ACTIVE",
  ended: "ENDED",
  error: "ERROR",
};

const STATUS_ACCENT: Record<SessionStatus, string> = {
  idle: "text-muted-foreground",
  connecting: "text-primary animate-status-pulse",
  active: "text-primary",
  ended: "text-muted-foreground",
  error: "text-destructive",
};

function formatTickOffset(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return "T+--.--";
  const seconds = ms / 1000;
  const sign = seconds >= 0 ? "+" : "-";
  const absSec = Math.abs(seconds);
  const whole = Math.floor(absSec).toString().padStart(2, "0");
  const decimal = Math.floor((absSec - Math.floor(absSec)) * 10);
  return `T${sign}${whole}.${decimal}`;
}

export function SessionPanel({
  status,
  suggestions,
  onStart,
  onEnd,
  errorMessage,
  sessionId,
}: Props) {
  const isActive = status === "active" || status === "connecting";

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 px-8 py-10">
      {/* ---------- Header / wordmark ---------- */}
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-5xl leading-none tracking-tight">
            Sales <span className="italic text-primary">Copilot</span>
          </h1>
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]">
            {sessionId ? (
              <span className="text-muted-foreground">
                <span className="text-foreground/50">SESS</span>{" "}
                {sessionId.replace(/^sess_/, "")}
              </span>
            ) : null}
            <span
              className="text-muted-foreground"
              data-testid="status-line"
              aria-live="polite"
            >
              <span className="text-foreground/40">status:</span>{" "}
              <span className={cn("inline-flex items-center gap-1.5", STATUS_ACCENT[status])}>
                <span aria-hidden>{STATUS_GLYPH[status]}</span>
                {STATUS_LABEL[status]}
              </span>
            </span>
          </div>
        </div>
        {/* editorial amber hairline */}
        <div className="h-px w-full bg-gradient-to-r from-primary/60 via-primary/20 to-transparent" />
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Live coaching · phase 1 · canned suggestion stream
        </p>
      </header>

      {/* ---------- Primary action ---------- */}
      <div className="flex items-center justify-between gap-6">
        {isActive ? (
          <button
            type="button"
            onClick={onEnd}
            className={cn(
              "group inline-flex h-12 items-center gap-3 border border-destructive/40",
              "bg-destructive/10 px-6 font-mono text-[12px] uppercase tracking-[0.22em]",
              "text-destructive transition-all hover:bg-destructive/20 hover:border-destructive/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50",
            )}
          >
            <span aria-hidden className="text-base leading-none">■</span>
            End Session
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className={cn(
              "group inline-flex h-12 items-center gap-3 border border-primary/40",
              "bg-primary/10 px-6 font-mono text-[12px] uppercase tracking-[0.22em]",
              "text-primary transition-all hover:bg-primary/20 hover:border-primary/80",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            )}
          >
            <span aria-hidden className="text-base leading-none">▶</span>
            Start Session
          </button>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {suggestions.length === 0
            ? "0 signals"
            : `${suggestions.length} signal${suggestions.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* ---------- Error region ---------- */}
      {errorMessage ? (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 font-sans text-sm text-destructive"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive/70">
            ⚠ Capture error
          </div>
          <div className="mt-1">{errorMessage}</div>
        </div>
      ) : null}

      {/* ---------- Suggestions feed ---------- */}
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-baseline justify-between border-b border-border/60 pb-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            ↓ Coaching feed
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
            sentiment / intent / suggestion
          </span>
        </div>

        {suggestions.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="animate-status-pulse">▸</span> Standby
            </p>
            <p className="font-display text-2xl italic text-muted-foreground/80">
              Coaching will appear here once the session is live.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {suggestions.map((s, idx) => (
              <li
                key={s.id}
                className="animate-card-rise relative flex overflow-hidden border border-border/60 bg-card/70 backdrop-blur-sm"
                style={{ animationDelay: `${Math.min(idx * 30, 240)}ms` }}
              >
                {/* sentiment spine */}
                <div
                  className="animate-spine-flash w-1 shrink-0"
                  style={
                    {
                      ["--spine-color" as string]: spineColor(s.sentiment),
                      backgroundColor: spineColor(s.sentiment),
                    } as React.CSSProperties
                  }
                  aria-hidden
                />
                <div className="flex flex-1 flex-col gap-2 px-5 py-4">
                  <div className="flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    <span>
                      <span className="text-foreground/40">{formatTickOffset(s.tickOffsetMs)}</span>
                      <span className="px-2 text-foreground/20">·</span>
                      <span className="text-foreground/70">{s.intent.replace(/_/g, " ")}</span>
                    </span>
                    <span
                      className="text-foreground/30"
                      style={{ color: spineColor(s.sentiment) }}
                    >
                      sentiment {s.sentiment >= 0 ? `+${s.sentiment}` : s.sentiment}
                    </span>
                  </div>
                  <p className="font-display text-xl leading-snug text-foreground">
                    {s.suggestion}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- Footer ---------- */}
      <footer className="mt-auto pt-6">
        <div className="border-t border-border/40 pt-4 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/60">
          Sales Copilot · Phase 1 skeleton · Cloud Run / us-central1
        </div>
      </footer>
    </section>
  );
}
