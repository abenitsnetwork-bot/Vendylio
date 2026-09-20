import { createElement as h } from 'react';
import { ScrollScrub, type ScrollScrubScene, type ScrollScrubTheme } from './ScrollScrub';
import type { LandingImage, LandingVideo } from '@/lib/server/landing';

// Same accent/panel/ivory/soft tokens as the rest of the page (globals.css
// @theme) — kept as literal hex here because ScrollScrub sets them as inline
// CSS custom properties on its own root, outside the .vendylio-landing scope
// where the --v-* aliases live.
const HERO_THEME: ScrollScrubTheme = {
  accent: '#DD5B2E',
  background: '#16322D',
  ink: '#F3F1EA',
  muted: '#E3E9DD',
};

// Bundled fallback — used until a SUPERADMIN uploads a replacement via
// /admin/site-content → Video (SiteVideo key `landing_hero_video`). One clip
// serves both desktop and mobile (no separate lightweight mobile encode) so
// swapping it never requires a schema change.
const FALLBACK_CLIP = '/assets/landing/scene-01.mp4';
const FALLBACK_POSTER = '/assets/landing/scene-01-poster.png';

function buildHeroScene(
  video: LandingVideo | null,
  showcaseImage: LandingImage | undefined,
): ScrollScrubScene {
  // The poster is the frame shown before/while the clip buffers, and the
  // fallback whenever the browser can't play video — it doubles as a real
  // hero image, so it defaults to the same admin-editable photo used in the
  // intro section right below (hero_showcase) rather than the bundled
  // stock still, unless the admin set an explicit poster on their own
  // uploaded video.
  return {
    id: 'scene-01',
    label: 'Your business',
    kicker: 'YOUR STOREFRONT. YOUR NEXT CHAPTER.',
    title: 'Your Business.\nOnline. Delivered.',
    body: 'Turn what you do into a store people can shop. Build your storefront, take orders and make the next move.',
    clip: video?.url ?? FALLBACK_CLIP,
    poster: video?.posterUrl ?? showcaseImage?.url ?? FALLBACK_POSTER,
    scroll: 2.35,
    linger: 0.12,
    objectPosition: 'center center',
    actions: h(
      'div',
      { className: 'hero-actions' },
      h(
        'a',
        { href: '/register', className: 'hero-cta' },
        'Open your store',
        h('span', { 'aria-hidden': true }, '↗'),
      ),
      h('a', { href: '#possibility', className: 'film-skip' }, 'Explore Vendylio ↓'),
      h('p', { className: 'hero-note' }, 'Start free. No credit card required.'),
    ),
  };
}

export function HeroFilm({
  video,
  showcaseImage,
}: {
  video: LandingVideo | null;
  showcaseImage?: LandingImage | undefined;
}) {
  const scene = buildHeroScene(video, showcaseImage);
  return (
    <div className="vendylio-film">
      <ScrollScrub scenes={[scene]} theme={HERO_THEME} />
    </div>
  );
}
