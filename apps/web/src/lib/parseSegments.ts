/**
 * Split a streaming markdown string into renderable segments.
 *
 * Why: react-markdown won't yield a code block until its closing fence has
 * arrived. We want ```html ... ``` to render progressively while the model is
 * still typing, so we tease those blocks out ourselves and let plain prose go
 * through react-markdown as before.
 *
 * - Text segments are rendered with react-markdown.
 * - HTML segments are streamed into a sandboxed iframe via document.write.
 *   While the closing fence hasn't arrived yet, the segment is marked
 *   `complete: false` and the rest of the buffer is its body.
 *
 * Edge cases the parser handles:
 *   - opening fence has streamed in but not yet a newline → empty html segment
 *   - opening fence with content but no closing fence yet → partial html
 *   - ```html that's NOT at the start of a line → ignored, treated as text
 */

export type Segment =
  | { kind: "text"; content: string }
  | {
      kind: "html";
      index: number;
      content: string;
      complete: boolean;
    };

const OPEN = "```html";
const FENCE = "```";

export function parseSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let htmlIdx = 0;

  while (i < input.length) {
    const open = findOpenFence(input, i);

    if (open === -1) {
      // No more html fences — rest of buffer is prose.
      const rest = input.slice(i);
      if (rest.length > 0) segments.push({ kind: "text", content: rest });
      break;
    }

    if (open > i) {
      segments.push({ kind: "text", content: input.slice(i, open) });
    }

    // Skip past `\`\`\`html` plus any optional spaces/tabs and the newline.
    let contentStart = open + OPEN.length;
    while (
      contentStart < input.length &&
      (input[contentStart] === " " || input[contentStart] === "\t")
    ) {
      contentStart++;
    }
    if (input[contentStart] === "\r") contentStart++;
    if (input[contentStart] === "\n") {
      contentStart++;
    } else if (contentStart >= input.length) {
      // Stream cut at exactly "```html" — render an empty placeholder block.
      segments.push({
        kind: "html",
        index: htmlIdx++,
        content: "",
        complete: false,
      });
      break;
    } else {
      // We have ```html<garbage> with no newline yet — wait for it.
      segments.push({
        kind: "html",
        index: htmlIdx++,
        content: "",
        complete: false,
      });
      break;
    }

    const close = findCloseFence(input, contentStart);
    if (close === -1) {
      segments.push({
        kind: "html",
        index: htmlIdx++,
        content: input.slice(contentStart),
        complete: false,
      });
      break;
    }

    segments.push({
      kind: "html",
      index: htmlIdx++,
      content: input.slice(contentStart, close),
      complete: true,
    });

    // Advance past the closing fence line (newline if present).
    const nl = input.indexOf("\n", close);
    i = nl === -1 ? input.length : nl + 1;
  }

  return segments;
}

function findOpenFence(s: string, from: number): number {
  let pos = from;
  while (pos <= s.length - OPEN.length) {
    const idx = s.indexOf(OPEN, pos);
    if (idx === -1) return -1;
    const atLineStart = idx === 0 || s[idx - 1] === "\n";
    const next = s[idx + OPEN.length];
    const followedByEol =
      next === undefined ||
      next === "\n" ||
      next === "\r" ||
      next === " " ||
      next === "\t";
    if (atLineStart && followedByEol) return idx;
    pos = idx + OPEN.length;
  }
  return -1;
}

function findCloseFence(s: string, from: number): number {
  let pos = from;
  while (pos <= s.length - FENCE.length) {
    const idx = s.indexOf(FENCE, pos);
    if (idx === -1) return -1;
    const atLineStart = idx === from || s[idx - 1] === "\n";
    if (atLineStart) {
      // Make sure this is a bare closing fence, not the start of another
      // language block (e.g. ```js). Allow trailing whitespace on the line.
      let after = idx + FENCE.length;
      while (after < s.length && (s[after] === " " || s[after] === "\t")) {
        after++;
      }
      if (after === s.length || s[after] === "\n" || s[after] === "\r") {
        return idx;
      }
    }
    pos = idx + FENCE.length;
  }
  return -1;
}
