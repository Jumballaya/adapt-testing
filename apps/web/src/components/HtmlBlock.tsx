import morphdom from "morphdom";
import { useEffect, useRef } from "react";

interface HtmlBlockProps {
  /** Stable id so script-dedup state persists for the same block. */
  blockId: string;
  /** Cumulative HTML received so far. */
  content: string;
  /** True once the closing fence has arrived (or the message stopped streaming). */
  complete: boolean;
}

/**
 * Streaming-aware HTML host. The flow per delta:
 *
 *   1. Parse the incoming `content` into a detached <div>.
 *   2. morphdom-diff that against our persistent wrapper inside the shadow
 *      root. Existing nodes that match by tag + position are preserved (their
 *      attributes / text are mutated in place); only genuinely new nodes are
 *      created and inserted.
 *   3. Activate any newly-inserted <script> tags (innerHTML never executes
 *      scripts on its own; we replace each with a fresh element). Dedup by
 *      src/textContent so a Tailwind CDN tag or boot snippet runs once.
 *
 * Because newly-created elements are the only ones that fire CSS animations,
 * a `* { animation: fade-in-elem ... }` rule injected into the shadow root
 * causes every freshly-inserted element to ease in — and preserved elements
 * to stay completely still. No flicker, no re-trigger, no strobe.
 */
export function HtmlBlock({ blockId, content, complete: _complete }: HtmlBlockProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const seenScriptsRef = useRef<Set<string>>(new Set());

  // One-time shadow-root setup: attach root, inject the animation rule, and
  // create the persistent wrapper that morphdom diffs against. (morphdom
  // wants a real Element, not a ShadowRoot, so we keep one stable child.)
  useEffect(() => {
    const host = hostRef.current;
    if (!host || shadowRef.current) return;

    const shadow = host.attachShadow({ mode: "open" });
    shadowRef.current = shadow;

    const styleEl = document.createElement("style");
    styleEl.textContent = SHADOW_STYLES;
    shadow.appendChild(styleEl);

    const wrapper = document.createElement("div");
    wrapper.dataset.morphRoot = "";
    shadow.appendChild(wrapper);
    wrapperRef.current = wrapper;
  }, []);

  // Reset script-dedup memory when this slot is reused for a different block.
  useEffect(() => {
    seenScriptsRef.current = new Set();
  }, [blockId]);

  // Patch the wrapper to match the latest buffer, then activate new scripts.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const next = document.createElement("div");
    next.innerHTML = content;

    morphdom(wrapper, next, {
      childrenOnly: true,
      // Keep our marker on the wrapper itself across morphs.
      onBeforeElUpdated: (fromEl, toEl) => {
        // Skip morphing already-activated scripts whose content matches —
        // morphdom would otherwise mutate textContent on identical scripts
        // and could throw away activation state in edge cases.
        if (
          fromEl.tagName === "SCRIPT" &&
          toEl.tagName === "SCRIPT" &&
          fromEl.textContent === toEl.textContent &&
          (fromEl as HTMLScriptElement).src ===
            (toEl as HTMLScriptElement).src
        ) {
          return false;
        }
        return true;
      },
    });

    activateNewScripts(wrapper, seenScriptsRef.current);
  }, [content]);

  return <div ref={hostRef} className="html-block" />;
}

/**
 * Inert <script> elements created via innerHTML / morphdom don't execute. To
 * run them we clone each into a fresh element and swap it in. Each unique
 * script (by src for external, textContent for inline) runs at most once
 * across the entire stream.
 */
function activateNewScripts(root: Element, seen: Set<string>): void {
  const scripts = Array.from(root.querySelectorAll("script"));
  for (const oldScript of scripts) {
    const key = oldScript.src
      ? `src:${oldScript.src}`
      : `inline:${oldScript.textContent ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fresh = document.createElement("script");
    for (const { name, value } of Array.from(oldScript.attributes)) {
      fresh.setAttribute(name, value);
    }
    if (oldScript.textContent) fresh.textContent = oldScript.textContent;
    oldScript.parentNode?.replaceChild(fresh, oldScript);
  }
}

/**
 * Per-element fade-in inside the shadow root. The animation only fires when
 * an element first becomes connected to the document tree — so morphdom-
 * preserved elements stay still and only freshly-inserted ones animate.
 *
 * Opacity-only on purpose: a transform would shift the element 2–4px during
 * the fade, growing the page's scrollHeight every frame for the duration of
 * the animation. With many elements fading at once that micro-jitters the
 * scroll loop and reads as visual noise. Holding final layout from frame 1
 * keeps everything still except the alpha channel.
 *
 * `[data-morph-root]` (the persistent wrapper) is exempted so the very first
 * mount doesn't fade an empty container.
 */
const SHADOW_STYLES = `
  *:not([data-morph-root]) {
    animation: fade-in-elem 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes fade-in-elem {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    *:not([data-morph-root]) { animation: none; }
  }
`;
