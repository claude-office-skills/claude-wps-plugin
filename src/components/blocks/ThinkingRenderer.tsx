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

function ThinkingRenderer({
  isThinking,
  thinkingMs,
  thinkingContent,
  startTime,
}: Props) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - startTime) / 1000),
  );
  const [expanded, setExpanded] = useState(isThinking);
  const prevThinking = useRef(isThinking);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevThinking.current && !isThinking) {
      setExpanded(false);
    }
    prevThinking.current = isThinking;
  }, [isThinking]);

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

  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "34f850",
    },
    body: JSON.stringify({
      sessionId: "34f850",
      location: "ThinkingRenderer.tsx:render",
      message: "ThinkingRenderer render decision",
      data: {
        isThinking,
        thinkingMs,
        hasContent: !!thinkingContent,
        contentLen: thinkingContent?.length || 0,
        willHide_noMs: !thinkingMs || thinkingMs < 1000,
        willHide_noContent: !thinkingContent && !isThinking,
      },
      timestamp: Date.now(),
      hypothesisId: "H-THINK",
    }),
  }).catch(() => {});
  // #endregion

  if (isThinking) {
    const charCount = thinkingContent?.length || 0;
    const badge =
      charCount > 0 ? `${Math.ceil(charCount / 4)} tokens` : undefined;

    return (
      <SidebarBlock
        type="thinking"
        status="running"
        title={`Thinking... ${elapsed}s`}
        badge={badge}
        collapsed={!expanded}
        onToggle={() => setExpanded((v) => !v)}
      >
        {expanded && thinkingContent && (
          <div ref={bodyRef} style={{ ...thinkingBodyStyle, maxHeight: 200 }}>
            {thinkingContent}
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 14,
                marginLeft: 2,
                background: "var(--text-muted)",
                borderRadius: 1,
                opacity: 0.7,
                animation: "thinkBlink 0.8s step-end infinite",
                verticalAlign: "text-bottom",
              }}
            />
          </div>
        )}
        <style>{`@keyframes thinkBlink{0%,100%{opacity:.7}50%{opacity:0}}`}</style>
      </SidebarBlock>
    );
  }

  if (!thinkingMs || thinkingMs < 1000) return null;
  if (!thinkingContent) return null;

  const durationSec = (thinkingMs / 1000).toFixed(1);
  const charCount = thinkingContent?.length || 0;
  const tokenEst = Math.ceil(charCount / 4);

  return (
    <SidebarBlock
      type="thinking"
      status="success"
      title={`Thought for ${durationSec}s`}
      badge={tokenEst > 0 ? `~${tokenEst} tokens` : undefined}
      collapsed={!expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      {expanded && thinkingContent && (
        <div ref={bodyRef} style={{ ...thinkingBodyStyle, maxHeight: 280 }}>
          {thinkingContent}
        </div>
      )}
    </SidebarBlock>
  );
}

export default memo(ThinkingRenderer);
