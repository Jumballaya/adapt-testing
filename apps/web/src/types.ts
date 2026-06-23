export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
  /**
   * Raw stream events forwarded from the server (Anthropic SDK's `streamEvent`).
   * One entry per chunk Anthropic sent — `message_start`, `content_block_*`,
   * `message_delta`, `message_stop`. Drives the per-message Trace tree.
   */
  trace?: TraceEvent[];
  /** Wall-clock timestamps to compute elapsed time in the trace UI. */
  startedAt?: number;
  finishedAt?: number;
}

/** Untyped on purpose — the SDK's stream-event union evolves; we render JSON. */
export type TraceEvent = {
  type: string;
  [key: string]: unknown;
};

// Wire shape from the server's SSE stream. Mirror of what /api/chat sends.
export type ServerEvent =
  | { type: "text"; text: string }
  | { type: "event"; event: TraceEvent }
  | { type: "done"; stop_reason: string | null; usage: unknown }
  | { type: "error"; message: string };
