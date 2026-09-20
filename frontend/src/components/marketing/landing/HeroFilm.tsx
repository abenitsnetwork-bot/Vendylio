import { createElement as h } from 'react';
import { ScrollScrub, type ScrollScrubScene, type ScrollScrubTheme } from './ScrollScrub';
import type { LandingVideo } from '@/lib/server/landing';

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

function buildHeroScene(video: LandingVideo | null): ScrollScrubScene {
  return {
    id: 'scene-01',
    label: 'Your business',
    kicker: 'YOUR STOREFRONT. YOUR NEXT CHAPTER.',
    title: 'Your Business.\nOnline. Delivered.',
    body: 'Turn what you do into a store people can shop. Build your storefront, take orders and make the next move.',
    clip: video?.url ?? FALLBACK_CLIP,
    poster: video?.posterUrl ?? FALLBACK_POSTER,
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

export function HeroFilm({ video }: { video: LandingVideo | null }) {
  const scene = buildHeroScene(video);
  return (
    <div className="vendylio-film">
      <ScrollScrub scenes={[scene]} theme={HERO_THEME} />
    </div>
  );
}
