'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';

interface VideoSectionProps {
  url: string;
  posterUrl: string | null;
}

/**
 * Below-the-hero homepage video (SUPERADMIN-uploaded, /admin/site-content →
 * Video). Click-to-play, not autoplay — avoids browser autoplay-with-sound
 * restrictions and the bandwidth cost of an always-loading hero video.
 * Renders nothing when no video has been uploaded yet (HomePage only mounts
 * this when `video` is non-null — no built-in placeholder, unlike images).
 */
export function VideoSection({ url, posterUrl }: VideoSectionProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="bg-background px-4 pb-16 font-body lg:px-14 lg:pb-20">
      <div className="mx-auto max-w-5xl">
        <div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-panel shadow-xl">
          {playing ? (
            <video
              src={url}
              poster={posterUrl ?? undefined}
              controls
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label="Play video"
              className="group absolute inset-0 flex h-full w-full items-center justify-center"
            >
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <video
                  src={url}
                  muted
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35" />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-lg transition-transform group-hover:scale-105 sm:h-20 sm:w-20">
                <Icon i="play" size={28} className="ml-1 text-foreground" />
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
