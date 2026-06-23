import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseSegments } from "../lib/parseSegments";
import type { ChatMessage } from "../types";
import { HtmlBlock } from "./HtmlBlock";
import { TraceTree } from "./TraceTree";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-body">{message.content}</div>
      </div>
    );
  }

  // Assistant: split the streaming buffer into prose + html-fence segments.
  // Prose goes through react-markdown; html segments stream into a shadow
  // DOM so they appear as the model types.
  const segments = parseSegments(message.content);
  const empty = segments.length === 0 && message.streaming;

  return (
    <div className="msg msg-assistant">
      <div className="msg-body">
        <TraceTree
          events={message.trace ?? []}
          streaming={!!message.streaming}
          startedAt={message.startedAt}
          finishedAt={message.finishedAt}
        />
        {empty && <span className="cursor">…</span>}
        {segments.map((seg, i) => {
          if (seg.kind === "text") {
            return (
              <ReactMarkdown key={`t-${i}`} remarkPlugins={[remarkGfm]}>
                {seg.content}
              </ReactMarkdown>
            );
          }
          // The block is "complete" when its closing fence arrived OR when
          // the whole message has stopped streaming (model never closed it).
          const complete = seg.complete || !message.streaming;
          return (
            <HtmlBlock
              key={`h-${seg.index}`}
              blockId={`${message.id}-${seg.index}`}
              content={seg.content}
              complete={complete}
            />
          );
        })}
      </div>
    </div>
  );
}
