import { useState, useEffect, useRef, useLayoutEffect, memo } from "react";
import SidebarBlock from "../SidebarBlock";

interface Props {
  isThinking: boolean;
  thinkingMs?: number;
  thinkingContent?: string;
  startTime: number;
}

const thinkingBodyStyle: React.CSSProperties = {
  padding: "6px 14px 8px",
  overflowY: "auto",
  fontSize: 11,
  fontStyle: "italic",
  color: "var(--text-muted)",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

function ThinkingRenderer({ isThinking, thinkingMs, thinkingContent, startTime }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isThinking) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [isThinking, startTime]);

  useLayoutEffect(() => {
    if (bodyRef.current && (isThinking || expanded)) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [thinkingContent, isThinking, expanded]);

  if (isThinking) {
    const charCount = thinkingContent?.length || 0;
    const badge = charCount > 0 ? `${Math.ceil(charCount / 4)} tokens` : undefined;

    return (
      <SidebarBlock
        type="thinking"
        status="running"
        title={`Thinking... ${elapsed}s`}
        badge={badge}
      >
        {thinkingContent && (
          <div
            ref={bodyRef}
            style={{ ...thinkingBodyStyle, maxHeight: 200 }}
          >
            {thinkingContent}
            <span style={{
              display: "inline-block",
              width: 6,
              height: 14,
              marginLeft: 2,
              background: "var(--text-muted)",
              borderRadius: 1,
              opacity: 0.7,
              animation: "thinkBlink 0.8s step-end infinite",
              verticalAlign: "text-bottom",
            }} />
          </div>
        )}
        <style>{`@keyframes thinkBlink{0%,100%{opacity:.7}50%{opacity:0}}`}</style>
      </SidebarBlock>
    );
  }

  if (!thinkingMs || thinkingMs < 1000) return null;

  const durationSec = (thinkingMs / 1000).toFixed(1);
  const hasContent = !!thinkingContent;
  const charCount = thinkingContent?.length || 0;
  const tokenEst = Math.ceil(charCount / 4);

  return (
    <SidebarBlock
      type="thinking"
      status="success"
      title={`Thought for ${durationSec}s`}
      badge={tokenEst > 0 ? `~${tokenEst} tokens` : undefined}
      collapsed={!expanded}
      onToggle={hasContent ? () => setExpanded((v) => !v) : undefined}
    >
      {expanded && thinkingContent && (
        <div
          ref={bodyRef}
          style={{ ...thinkingBodyStyle, maxHeight: 280 }}
        >
          {thinkingContent}
        </div>
      )}
    </SidebarBlock>
  );
}

export default memo(ThinkingRenderer);
