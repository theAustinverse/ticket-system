import casinoLounge from '../assets/bg/casino-lounge.webp';
import neonStreet from '../assets/bg/neon-street.webp';
import oldAlley from '../assets/bg/old-alley.webp';

const SLIDES = [casinoLounge, neonStreet, oldAlley];

/**
 * Ambient full-viewport slideshow: each frame holds, slowly pushes in (Ken
 * Burns), then crossfades to the next. Mounted once at the app root so it
 * keeps running underneath route changes instead of restarting per page.
 */
export function CinematicBackground() {
  return (
    <div className="cinematic-bg" aria-hidden="true">
      {SLIDES.map((src, i) => (
        <div
          key={src}
          className="bg-layer"
          style={{
            backgroundImage: `url(${src})`,
            animationDelay: `${i * -7}s`,
          }}
        />
      ))}
      <div className="bg-scrim" />
    </div>
  );
}
