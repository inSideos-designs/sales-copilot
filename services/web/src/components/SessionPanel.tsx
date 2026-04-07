"use client";

export type SessionStatus = "idle" | "connecting" | "active" | "ended" | "error";

export interface RenderedSuggestion {
  id: string;
  intent: string;
  suggestion: string;
  sentiment: number;
}

interface Props {
  status: SessionStatus;
  suggestions: RenderedSuggestion[];
  onStart: () => void;
  onEnd: () => void;
  errorMessage?: string;
}

function sentimentBadge(sentiment: number): string {
  if (sentiment <= -2) return "bg-red-600";
  if (sentiment === -1) return "bg-orange-500";
  if (sentiment === 0) return "bg-slate-500";
  if (sentiment === 1) return "bg-emerald-500";
  return "bg-emerald-700";
}

export function SessionPanel({ status, suggestions, onStart, onEnd, errorMessage }: Props) {
  const isActive = status === "active" || status === "connecting";

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sales Copilot</h1>
        <span
          className="text-sm text-slate-400"
          data-testid="status-line"
          aria-live="polite"
        >
          status: {status}
        </span>
      </header>

      <div>
        {isActive ? (
          <button
            type="button"
            onClick={onEnd}
            className="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
          >
            End session
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
          >
            Start session
          </button>
        )}
      </div>

      {errorMessage ? (
        <div role="alert" className="rounded-md bg-red-900/40 p-3 text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div>
        <h2 className="mb-2 text-sm uppercase tracking-wider text-slate-400">
          Suggestions
        </h2>
        {suggestions.length === 0 ? (
          <p className="text-slate-500">No suggestions yet. They&apos;ll appear here live.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 rounded-md bg-slate-900 p-3 shadow"
              >
                <span
                  className={`mt-1 h-2 w-2 rounded-full ${sentimentBadge(s.sentiment)}`}
                  aria-hidden
                />
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    {s.intent}
                  </div>
                  <div className="text-slate-100">{s.suggestion}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
