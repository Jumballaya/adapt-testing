import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ServerEvent } from "../types";
import { MessageBubble } from "./MessageBubble";

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

/**
 * Per-streaming-message smoothing buffer. Anthropic streams in irregular bursts
 * (a chunk of tokens, a pause, another chunk); applying those deltas to React
 * state directly produces an irregular paint cadence — that's what the eye
 * reads as "jittery". This buffer absorbs the bursts and drains them on a
 * uniform per-frame schedule at a rate that tracks the smoothed inflow, so
 * paints land at a steady cadence even as the underlying API rate drifts.
 */
interface DrainState {
  /** Chars received from the server but not yet committed to message.content. */
  pending: string;
  /** Smoothed inflow rate, chars per ms. EMA over individual delta rates. */
  emaRate: number;
  /** Accumulator for sub-1-char drain amounts so we don't lose fractional progress. */
  fractionalDebt: number;
  deltaCount: number;
  lastDeltaAt: number;
  lastTickAt: number;
  rafId: number | null;
  /** Set when the server's `done` event arrives. The drain loop continues
   *  until the buffer empties, then finalizes the message (streaming: false). */
  done: boolean;
}

const EMA_ALPHA = 0.15;
const INITIAL_RATE_CHARS_PER_MS = 0.05; // ~50 chars/s seed; adapts within a few deltas
const FLUSH_WINDOW_MS = 300; // after `done`, drain remaining buffer over this long
const SCROLL_DECAY = 0.15; // close 15% of remaining scroll gap per frame

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** True while we should auto-follow the bottom of the chat. Flipped off when
   *  the user wheels/touchmoves themselves out of bottom range; flipped back
   *  on when they wheel/touch back near the bottom (or hit Send). */
  const stickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  /** One DrainState per assistant message id that's currently streaming. */
  const drainsRef = useRef<Map<string, DrainState>>(new Map());

  const isStreaming = useMemo(
    () => messages.some((m) => m.streaming),
    [messages],
  );

  // Continuous scroll-follow loop. Runs the entire time ANY message is
  // streaming, not once per messages update. That fixes the "have to scroll
  // down before it follows" symptom: with a per-update loop, if a tween
  // settled between deltas the viewport could fall behind the live edge with
  // no loop running to catch it. Here the loop is always alive while
  // streaming, no-ops when there's nothing to do, and stops cleanly when
  // streaming ends.
  useEffect(() => {
    if (!isStreaming) return;
    const el = scrollRef.current;
    if (!el) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (stickToBottomRef.current) {
        const target = el.scrollHeight - el.clientHeight;
        const distance = target - el.scrollTop;
        if (Math.abs(distance) >= 0.5) {
          el.scrollTop = el.scrollTop + distance * SCROLL_DECAY;
        }
      }
      scrollRafRef.current = requestAnimationFrame(tick);
    };

    scrollRafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [isStreaming]);

  // Track whether the user is parked near the bottom (80px tolerance).
  //
  //  - `scroll` fires for both user AND our rAF-driven scrollTop writes; we
  //    must IGNORE it while the rAF is running. When the rAF isn't running,
  //    scroll events come from scrollbar drags and are safe to act on.
  //  - `wheel` / `touchmove` fire ONLY on real user input — these are the
  //    "user wants out of auto-follow" signal. We DON'T cancel the scroll
  //    rAF here (the continuous loop just no-ops when stickToBottom is
  //    false), so the user can also wheel back to the bottom and have
  //    auto-follow re-engage on the next frame.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const recheckPosition = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < 80;
    };

    const onScroll = () => {
      if (scrollRafRef.current != null) return; // it's us, not the user
      recheckPosition();
    };

    const onUserInput = () => {
      // Defer one frame so wheel/touch has applied to scrollTop first.
      requestAnimationFrame(recheckPosition);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onUserInput, { passive: true });
    el.addEventListener("touchmove", onUserInput, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserInput);
      el.removeEventListener("touchmove", onUserInput);
    };
  }, []);

  // Cleanup any in-flight loops on unmount.
  useEffect(() => {
    return () => {
      for (const s of drainsRef.current.values()) {
        if (s.rafId != null) cancelAnimationFrame(s.rafId);
      }
      drainsRef.current.clear();
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // ---- Smoothing buffer plumbing ----

  /**
   * Drain the buffer toward `m.content` on each animation frame at the
   * smoothed inflow rate. fractionalDebt accumulates sub-1-char progress so
   * slow streams (e.g. 5 chars/s) drain smoothly rather than jumping a whole
   * char per frame.
   */
  const ensureDrainLoop = (id: string) => {
    const s = drainsRef.current.get(id);
    if (!s || s.rafId != null) return;
    s.lastTickAt = performance.now();

    const tick = () => {
      const s = drainsRef.current.get(id);
      if (!s) return;

      const now = performance.now();
      const dt = now - s.lastTickAt;
      s.lastTickAt = now;

      // Drain rate: smoothed inflow rate normally; speed up to clear the
      // remainder in ~FLUSH_WINDOW_MS once the server has signaled `done`.
      let rate = s.emaRate;
      if (s.done) {
        const flushRate = s.pending.length / FLUSH_WINDOW_MS;
        rate = Math.max(rate, flushRate);
      }

      s.fractionalDebt += rate * dt;
      let take = Math.floor(s.fractionalDebt);
      s.fractionalDebt -= take;
      take = Math.min(take, s.pending.length);

      if (take > 0) {
        const slice = s.pending.slice(0, take);
        s.pending = s.pending.slice(take);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, content: m.content + slice } : m,
          ),
        );
      }

      if (s.pending.length === 0) {
        if (s.done) {
          // Server done AND buffer empty → finalize the message.
          drainsRef.current.delete(id);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, streaming: false, finishedAt: Date.now() }
                : m,
            ),
          );
          return;
        }
        // Empty buffer but server still streaming — pause the loop until
        // the next delta enqueues something.
        s.rafId = null;
        return;
      }

      s.rafId = requestAnimationFrame(tick);
    };

    s.rafId = requestAnimationFrame(tick);
  };

  const enqueueText = (id: string, text: string) => {
    const now = performance.now();
    let s = drainsRef.current.get(id);
    if (!s) {
      // First delta for this message. Seed with a reasonable rate; EMA
      // adjusts once we have multiple deltas to compare.
      s = {
        pending: text,
        emaRate: INITIAL_RATE_CHARS_PER_MS,
        fractionalDebt: 0,
        deltaCount: 1,
        lastDeltaAt: now,
        lastTickAt: now,
        rafId: null,
        done: false,
      };
      drainsRef.current.set(id, s);
    } else {
      const dt = Math.max(now - s.lastDeltaAt, 1);
      const instantRate = text.length / dt;
      s.emaRate = EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * s.emaRate;
      s.lastDeltaAt = now;
      s.deltaCount++;
      s.pending += text;
    }
    ensureDrainLoop(id);
  };

  const markDone = (id: string) => {
    const s = drainsRef.current.get(id);
    if (s) {
      s.done = true;
      ensureDrainLoop(id);
    } else {
      // Server completed before any text delta arrived (rare; e.g. an empty
      // response). Apply directly.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, streaming: false, finishedAt: Date.now() }
            : m,
        ),
      );
    }
  };

  /** Server-side or network error: dump remaining buffer + an error note. */
  const flushAndError = (id: string, message: string) => {
    const s = drainsRef.current.get(id);
    const pending = s?.pending ?? "";
    if (s?.rafId != null) cancelAnimationFrame(s.rafId);
    drainsRef.current.delete(id);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              content: m.content + pending + `\n\n_Error: ${message}_`,
              streaming: false,
              finishedAt: Date.now(),
              error: message,
            }
          : m,
      ),
    );
  };

  /** User clicked Stop: keep what we have, cut the buffer, mark not streaming. */
  const flushAndStop = (id: string) => {
    const s = drainsRef.current.get(id);
    const pending = s?.pending ?? "";
    if (s?.rafId != null) cancelAnimationFrame(s.rafId);
    drainsRef.current.delete(id);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              content: m.content + pending,
              streaming: false,
              finishedAt: Date.now(),
            }
          : m,
      ),
    );
  };

  // ---- Send ----

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
      trace: [],
      startedAt: Date.now(),
    };

    // Snapshot history BEFORE appending the placeholder (placeholder has
    // empty content and would 400 if shipped to the API).
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Sending implies "watch the response" — re-engage auto-follow even if
    // the user had scrolled up earlier in the conversation.
    stickToBottomRef.current = true;
    setMessages((prev) => [...prev, userMsg, placeholder]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      await readSSE(res.body, (event) => {
        switch (event.type) {
          case "text":
            // Text deltas go through the smoothing buffer.
            enqueueText(assistantId, event.text);
            break;
          case "event":
            // Trace events are metadata — apply directly, no smoothing needed.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, trace: [...(m.trace ?? []), event.event] }
                  : m,
              ),
            );
            break;
          case "done":
            markDone(assistantId);
            break;
          case "error":
            flushAndError(assistantId, event.message);
            break;
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        flushAndStop(assistantId);
      } else {
        flushAndError(assistantId, message);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="chat">
      <div className="messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="empty">
            Try: <em>“show me a pricing card with three tiers”</em> or{" "}
            <em>“what's the capital of France?”</em>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message Claude…  (Shift+Enter for newline)"
          rows={2}
          disabled={busy}
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="btn"
            aria-label="Stop generating"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect
                x="2.5"
                y="2.5"
                width="9"
                height="9"
                rx="1.5"
                fill="currentColor"
              />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            className="btn"
            disabled={!input.trim()}
            aria-label="Send"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 13V3M8 3L3.5 7.5M8 3L12.5 7.5" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * Parse an SSE response body and dispatch each `data: {...}` event to `onEvent`.
 * The server emits one JSON object per `data:` line, terminated by a blank line.
 */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ServerEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on event terminator (blank line). Keep the trailing partial.
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      // An event can have multiple `data:` lines; concatenate them.
      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""));
      if (dataLines.length === 0) continue;

      try {
        const parsed = JSON.parse(dataLines.join("\n")) as ServerEvent;
        onEvent(parsed);
      } catch {
        // Malformed event — skip rather than die mid-stream.
      }
    }
  }
}
