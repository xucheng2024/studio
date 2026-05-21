"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

type Props = {
  src: string;
  title: string;
};

/** Native audio for direct file URLs; shows a fallback link when the source fails to load. */
export function MemberZoneAudioPlayer({ src, title }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p className={`text-sm ${ui.muted}`}>
        This audio file could not be loaded in the browser.{" "}
        <a href={src} target="_blank" rel="noreferrer" className={ui.link}>
          Open audio link
        </a>
      </p>
    );
  }

  return (
    <audio
      controls
      preload="metadata"
      className="w-full"
      title={title}
      onError={() => setFailed(true)}
    >
      <source src={src} />
    </audio>
  );
}
