import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import express, { type Request, type Response } from "express";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env at the repo root.");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

const SYSTEM_PROMPT = `You render in a chat UI that streams \`html\` fenced code blocks progressively into a shadow DOM, so they appear inline (no iframe seam) and grow tag-by-tag as you type.

Speed rules — these matter:
- For visual requests (a layout, a component, a page, "show me X", "build me Y"), START YOUR RESPONSE IMMEDIATELY with \`\`\`html on the very first line. NO preamble. Do NOT write "Here's...", "Sure...", "I'll create...", or any framing sentence first — the user is waiting for the page to start rendering.
- Save any commentary for AFTER the closing \`\`\` fence, only if it adds something useful.

HTML rules:
- Inside an \`html\` block: fragment-style markup. Do NOT include \`<!doctype>\`, \`<html>\`, \`<head>\`, or \`<body>\` — the content lives in a shadow root and those wrappers are stripped.
- Style with inline styles or a \`<style>\` block at the top of the snippet. Both are scoped by the shadow root.
- Avoid Tailwind CDN — its DOM observer watches the main document, not shadow roots, so utility classes won't compile. Use plain CSS.
- \`<script>\` tags run in the parent's global scope; each unique script runs at most once across streaming updates.

Non-visual rules:
- For prose answers, use clean Markdown — no \`html\` block.
- Mix prose and one or more \`html\` blocks freely when it helps.`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

interface ChatRequestBody {
  messages: Anthropic.MessageParam[];
}

app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages } = req.body as ChatRequestBody;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Disable Nagle so each delta leaves the box immediately rather than being
  // coalesced for ~40-200ms — matters when deltas are short.
  res.socket?.setNoDelay(true);

  // Send a comment line as soon as headers flush. SSE spec ignores it, but it
  // proves the channel is alive end-to-end before any model latency, and forces
  // intermediaries to stop buffering.
  res.write(": open\n\n");

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Abort the upstream call ONLY if the client disconnects mid-stream. Bind to
  // res.close (fires on connection close) and gate on writableEnded so a clean
  // res.end() doesn't trigger an abort. Binding to req.on("close") is wrong:
  // IncomingMessage emits "close" right after the body is parsed, which would
  // abort the SDK call before it ever streamed anything.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log("[/api/chat] client disconnected mid-stream; aborting");
      controller.abort();
    }
  });

  // Heartbeat every 15s so idle proxies don't drop the connection.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  console.log(`[/api/chat] start (${messages.length} msgs)`);
  let deltaCount = 0;

  try {
    const stream = client.messages.stream(
      {
        model: "claude-opus-4-7",
        max_tokens: 16000,
        // Explicit-off: Opus 4.7 defaults to thinking off, but stating it makes
        // the intent clear and guards against future SDK default changes that
        // would otherwise add multi-second TTFT.
        thinking: { type: "disabled" },
        system: SYSTEM_PROMPT,
        messages,
      },
      { signal: controller.signal },
    );

    stream.on("text", (delta) => {
      deltaCount += 1;
      send({ type: "text", text: delta });
    });

    // Mirror every raw API event to the client so the UI can render a full
    // trace (message_start / content_block_* / message_delta / message_stop).
    // This is the same wire shape Anthropic streams over SSE — no
    // transformation, no filtering. The browser decides what to surface.
    stream.on("streamEvent", (event) => {
      send({ type: "event", event });
    });

    const final = await stream.finalMessage();
    send({
      type: "done",
      stop_reason: final.stop_reason,
      usage: final.usage,
    });
    console.log(
      `[/api/chat] done (${deltaCount} deltas, stop=${final.stop_reason})`,
    );
  } catch (err) {
    if (controller.signal.aborted) {
      console.log("[/api/chat] aborted");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat] error:", message);
    send({ type: "error", message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

const port = Number(process.env.PORT ?? 8000);
app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
