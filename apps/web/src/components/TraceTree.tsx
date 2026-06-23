import { useMemo, useState } from "react";
import type { TraceEvent } from "../types";

interface TraceTreeProps {
  events: TraceEvent[];
  streaming: boolean;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * Per-message trace panel. Every chunk Anthropic streamed (`message_start`,
 * `content_block_*`, `message_delta`, `message_stop`) is forwarded from the
 * server and rendered here. Default state is collapsed; expand to drill into
 * individual events. Each event row is independently collapsible to show its
 * full JSON payload.
 *
 * Events are also grouped under their content block so the timeline reads
 * naturally — message-level events sit at the top, then one node per content
 * block (text / thinking / tool_use / etc.) with its deltas as children.
 */
export function TraceTree({
  events,
  streaming,
  startedAt,
  finishedAt,
}: TraceTreeProps) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => groupByBlock(events), [events]);
  const elapsed = useElapsed(startedAt, finishedAt, streaming);
  const counts = useMemo(() => countBlocks(events), [events]);

  if (events.length === 0 && !streaming) return null;

  return (
    <div className="trace">
      <button
        type="button"
        className="trace-header"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="trace-arrow">{open ? "▾" : "▸"}</span>
        <span className="trace-title">
          {streaming ? "Running" : "Trace"}
          {streaming && <span className="trace-pulse" />}
        </span>
        <span className="trace-meta">
          {events.length} events
          {counts.length > 0 && ` · ${counts}`}
          {elapsed !== null && ` · ${formatElapsed(elapsed)}`}
        </span>
      </button>

      {open && (
        <div className="trace-body">
          {groups.map((group, i) => (
            <TraceGroup key={i} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

type Group =
  | { kind: "single"; event: TraceEvent }
  | {
      kind: "block";
      index: number;
      blockType: string;
      events: TraceEvent[];
    };

function groupByBlock(events: TraceEvent[]): Group[] {
  const out: Group[] = [];
  // Keep a per-index pointer to the current open block group so deltas land
  // inside the right one (Anthropic interleaves blocks by index, not order).
  const openByIndex = new Map<number, Group & { kind: "block" }>();

  for (const ev of events) {
    if (ev.type === "content_block_start") {
      const block = (ev as { content_block?: { type?: string } }).content_block;
      const idx = (ev as { index?: number }).index ?? 0;
      const group: Group & { kind: "block" } = {
        kind: "block",
        index: idx,
        blockType: block?.type ?? "?",
        events: [ev],
      };
      out.push(group);
      openByIndex.set(idx, group);
    } else if (
      ev.type === "content_block_delta" ||
      ev.type === "content_block_stop"
    ) {
      const idx = (ev as { index?: number }).index ?? 0;
      const group = openByIndex.get(idx);
      if (group) group.events.push(ev);
      else out.push({ kind: "single", event: ev });
    } else {
      out.push({ kind: "single", event: ev });
    }
  }
  return out;
}

function countBlocks(events: TraceEvent[]): string {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type === "content_block_start") {
      const block = (ev as { content_block?: { type?: string } }).content_block;
      const t = block?.type ?? "?";
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
}

function TraceGroup({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);

  if (group.kind === "single") {
    return <TraceRow event={group.event} indent={0} />;
  }

  // Block group — header row + collapsible children.
  const summary = summarizeBlockGroup(group);
  return (
    <div>
      <button
        type="button"
        className="trace-row trace-row-group"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="trace-arrow">{open ? "▾" : "▸"}</span>
        <span className="trace-type">
          content_block[{group.index}] {group.blockType}
        </span>
        <span className="trace-summary">{summary}</span>
      </button>
      {open && (
        <div className="trace-children">
          {group.events.map((ev, i) => (
            <TraceRow key={i} event={ev} indent={1} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraceRow({
  event,
  indent,
}: {
  event: TraceEvent;
  indent: number;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeEvent(event);
  return (
    <div>
      <button
        type="button"
        className={`trace-row${indent > 0 ? " trace-row-child" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="trace-arrow">{open ? "▾" : "▸"}</span>
        <span className="trace-type">{event.type}</span>
        <span className="trace-summary">{summary}</span>
      </button>
      {open && (
        <pre className={`trace-json${indent > 0 ? " trace-json-child" : ""}`}>
          {safeStringify(event)}
        </pre>
      )}
    </div>
  );
}

function summarizeEvent(event: TraceEvent): string {
  switch (event.type) {
    case "message_start": {
      const msg = (event as { message?: Record<string, unknown> }).message;
      return [msg?.model, msg?.id].filter(Boolean).join(" · ");
    }
    case "content_block_start": {
      const cb = (event as { content_block?: { type?: string; name?: string } })
        .content_block;
      return cb?.name ? `${cb.type} (${cb.name})` : (cb?.type ?? "");
    }
    case "content_block_delta": {
      const d = (event as { delta?: Record<string, unknown> }).delta;
      const t = d?.type as string | undefined;
      if (t === "text_delta") {
        const text = (d?.text as string) ?? "";
        return `+${text.length} chars`;
      }
      if (t === "thinking_delta") {
        const text = (d?.thinking as string) ?? "";
        return `+${text.length} chars`;
      }
      if (t === "input_json_delta") {
        const text = (d?.partial_json as string) ?? "";
        return `+${text.length} chars`;
      }
      if (t === "signature_delta") return "signature";
      return t ?? "";
    }
    case "content_block_stop":
      return "";
    case "message_delta": {
      const d = (event as { delta?: { stop_reason?: string } }).delta;
      const usage = (event as { usage?: { output_tokens?: number } }).usage;
      const parts: string[] = [];
      if (d?.stop_reason) parts.push(d.stop_reason);
      if (usage?.output_tokens != null)
        parts.push(`${usage.output_tokens} out tokens`);
      return parts.join(" · ");
    }
    case "message_stop":
      return "";
    default:
      return "";
  }
}

function summarizeBlockGroup(
  group: Extract<Group, { kind: "block" }>,
): string {
  const deltas = group.events.filter((e) => e.type === "content_block_delta");
  let chars = 0;
  for (const d of deltas) {
    const delta = (d as { delta?: Record<string, unknown> }).delta;
    const t = delta?.type;
    const s =
      t === "text_delta"
        ? (delta?.text as string)
        : t === "thinking_delta"
          ? (delta?.thinking as string)
          : t === "input_json_delta"
            ? (delta?.partial_json as string)
            : "";
    if (s) chars += s.length;
  }
  const stopped = group.events.some((e) => e.type === "content_block_stop");
  return `${deltas.length} deltas · ${chars} chars${stopped ? "" : " · open"}`;
}

function useElapsed(
  startedAt: number | undefined,
  finishedAt: number | undefined,
  streaming: boolean,
): number | null {
  // Re-render at ~5fps while streaming so the timer advances live; stop once
  // the response lands. `useState` here is just a tick counter.
  const [, setTick] = useState(0);
  useEffectInterval(streaming, () => setTick((t) => t + 1), 200);

  if (startedAt == null) return null;
  if (finishedAt != null) return finishedAt - startedAt;
  if (streaming) return Date.now() - startedAt;
  return null;
}

// Tiny effect helper so the import block stays compact.
import { useEffect } from "react";
function useEffectInterval(active: boolean, cb: () => void, ms: number) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(cb, ms);
    return () => clearInterval(id);
  }, [active, cb, ms]);
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
