import lantern from '../assets/anim/lantern.mp4';
import neon from '../assets/anim/neon.mp4';
import tram from '../assets/anim/tram.mp4';
import mahjong from '../assets/anim/mahjong.mp4';
import coins from '../assets/anim/coins.mp4';
import lion from '../assets/anim/lion.mp4';
import envelope from '../assets/anim/envelope.mp4';
import tramTail from '../assets/anim/tram-tail.mp4';
import coinsTail from '../assets/anim/coins-tail.mp4';
import mahjongTail from '../assets/anim/mahjong-tail.mp4';

/**
 * One shot per clip, rendered by Higgsfield on a pure-black background and
 * trimmed/sped up with ffmpeg to ~1.8s. Black is made transparent in the
 * browser with mix-blend-mode: screen, so no alpha channel is needed.
 *
 * peakMs is the moment (in the trimmed clip) when the picture covers the whole
 * screen — the route swaps there, so the page change is hidden behind it.
 */
export interface Clip {
  id: string;
  src: string;
  durationMs: number;
  peakMs: number;
}

export const CLIPS = {
  lantern: { id: 'lantern', src: lantern, durationMs: 1910, peakMs: 1090 },
  neon: { id: 'neon', src: neon, durationMs: 1900, peakMs: 1100 },
  tram: { id: 'tram', src: tram, durationMs: 1850, peakMs: 1100 },
  mahjong: { id: 'mahjong', src: mahjong, durationMs: 1830, peakMs: 940 },
  coins: { id: 'coins', src: coins, durationMs: 1800, peakMs: 900 },
  lion: { id: 'lion', src: lion, durationMs: 1890, peakMs: 780 },
  envelope: { id: 'envelope', src: envelope, durationMs: 1780, peakMs: 1000 },
  // The last 650ms of a shot (the picture clearing away), cut into its own
  // file for reveal mode so playback never has to seek.
  tramTail: { id: 'tram-tail', src: tramTail, durationMs: 650, peakMs: 0 },
  coinsTail: { id: 'coins-tail', src: coinsTail, durationMs: 650, peakMs: 0 },
  mahjongTail: { id: 'mahjong-tail', src: mahjongTail, durationMs: 650, peakMs: 0 },
} satisfies Record<string, Clip>;

export type ClipId = keyof typeof CLIPS;

/**
 * cover:  play the whole shot, swap the route at the peak (the screen is
 *         fully covered), then reveal. The new page appears ~1s late.
 * reveal: swap the route at once and play only the *Tail clip (the picture
 *         clearing away) over the new page, never blocking taps. Used on the
 *         buy path (register -> queue -> order), where a second of added
 *         delay costs real seats.
 */

export type Mode = 'cover' | 'reveal';

export interface Plan {
  clip: Clip;
  mode: Mode;
}

/** One storyboard shot per part of the site. null = no transition at all. */
export function planFor(pathname: string): Plan | null {
  // Door staff, a guest opening a shared ticket, and the back office must
  // never wait on an animation.
  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/checkin') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/lab-3d')
  ) {
    return null;
  }
  if (pathname === '/' || pathname === '/events') return { clip: CLIPS.lantern, mode: 'cover' };
  if (pathname.startsWith('/events/')) return { clip: CLIPS.neon, mode: 'cover' };
  if (pathname === '/login' || pathname === '/profile') return { clip: CLIPS.envelope, mode: 'cover' };
  if (pathname.startsWith('/register/')) return { clip: CLIPS.mahjongTail, mode: 'reveal' };
  if (pathname.startsWith('/queue/')) return { clip: CLIPS.tramTail, mode: 'reveal' };
  if (pathname.startsWith('/order/') || pathname.startsWith('/orders/')) {
    return { clip: CLIPS.coinsTail, mode: 'reveal' };
  }
  if (pathname === '/my-tickets' || pathname === '/entry-guide') {
    return { clip: CLIPS.mahjong, mode: 'cover' };
  }
  if (pathname === '/trailer') return { clip: CLIPS.lion, mode: 'cover' };
  return null;
}
