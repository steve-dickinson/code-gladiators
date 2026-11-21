"use client";

import { useEffect, useRef, useState } from "react";
import { VIEWPORT } from "@/lib/browser";

/**
 * Shows an entry at the size it was tested and judged at, scaled down to fit its card,
 * so nothing is cut off and viewers see what the testers and the judge saw.
 */
export function EntryFrame({ title, src, srcDoc }: { title: string; src?: string; srcDoc?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / VIEWPORT.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        title={title}
        sandbox="allow-scripts"
        src={src}
        srcDoc={src ? undefined : srcDoc}
        className="border-0 bg-white"
        style={{ width: VIEWPORT.width, height: VIEWPORT.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}
      />
    </div>
  );
}
