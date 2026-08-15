import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

export type BrowserPanelEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "message"; data: unknown };

export interface BrowserPanelProps {
  src: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  allow?: string;
  fallback?: ReactNode;
  onEvent?: (event: BrowserPanelEvent) => void;
}

export function BrowserPanel({ src, title = "Browser Kit live view", className, style, allow = "clipboard-read; clipboard-write; fullscreen", fallback, onEvent }: BrowserPanelProps) {
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const iframeTitle = useMemo(() => title, [title]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data === "browser-kit-disconnected" || event.data === "browserbase-disconnected") {
        setConnected(false);
        onEvent?.({ type: "disconnected" });
        return;
      }
      onEvent?.({ type: "message", data: event.data });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onEvent]);

  if (failed && fallback) return fallback;

  return (
    <div className={className} style={{ position: "relative", minHeight: 320, background: "#111", ...style }} data-browser-kit-status={connected ? "connected" : "connecting"}>
      <iframe
        title={iframeTitle}
        src={src}
        onLoad={() => {
          setConnected(true);
          setFailed(false);
          onEvent?.({ type: "connected" });
        }}
        onError={() => {
          setConnected(false);
          setFailed(true);
          onEvent?.({ type: "disconnected" });
        }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
        allow={allow}
        style={{ border: 0, width: "100%", height: "100%", minHeight: 320, display: "block" }}
      />
      {!connected && !failed ? (
        <div aria-live="polite" style={{ position: "absolute", inset: 12, pointerEvents: "none", color: "#aaa", fontSize: 12 }}>
          Connecting to browser…
        </div>
      ) : null}
      {failed && !fallback ? (
        <div role="alert" style={{ position: "absolute", inset: 12, color: "#fca5a5", fontSize: 12 }}>
          Browser view disconnected. Refresh or request a new live-view token.
        </div>
      ) : null}
    </div>
  );
}
