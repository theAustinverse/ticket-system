import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import { CLIPS, currentOrientation, planFor, type ClipVariant, type Mode, type Orientation } from './clips';
import { motionAllowed } from './motion';

interface Active {
  key: number;
  clip: ClipVariant;
  mode: Mode;
  video: HTMLVideoElement;
}

// Each clip gets one <video> element, created after the page is idle and kept
// buffered in a hidden parent, then moved into the overlay when it's needed.
// A transition only plays if its clip is already buffered: waiting on the
// network would delay navigation, which is worse than no animation.
// Only the current orientation's files are fetched (a phone downloads the
// 1080x1920 set, a desktop the 1920x1080 set), re-warmed if the device turns.
const warm = new Map<string, HTMLVideoElement>();
let warmHost: HTMLDivElement | null = null;

function warmAll(o: Orientation) {
  if (!motionAllowed()) return;
  if (!warmHost) {
    warmHost = document.createElement('div');
    warmHost.className = 'route-fx-warm';
    warmHost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(warmHost);
  }
  for (const clip of Object.values(CLIPS)) {
    const variant = clip[o];
    if (warm.has(variant.id)) continue;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = variant.src;
    warmHost.appendChild(v);
    v.load();
    warm.set(variant.id, v);
  }
}

function takeReady(clip: ClipVariant): HTMLVideoElement | null {
  const v = warm.get(clip.id);
  // HAVE_FUTURE_DATA: enough buffered to play through without stalling.
  return v && v.readyState >= 3 ? v : null;
}

/**
 * Holds the location the router actually renders. On a path change with a
 * planned shot it keeps showing the old page until the shot covers the
 * screen (cover mode), or swaps at once and plays a non-blocking reveal.
 */
export function useRouteTransition() {
  const location = useLocation();
  const [shown, setShown] = useState<Location>(location);
  const [fx, setFx] = useState<Active | null>(null);
  const prevPath = useRef(location.pathname);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);

  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const run = () => warmAll(currentOrientation());
    const t = window.setTimeout(() => (idle ? idle(run) : run()), 2500);
    // A phone turned sideways needs the other set; fetch it once it settles.
    const mq = window.matchMedia('(orientation: portrait)');
    const onTurn = () => window.setTimeout(run, 1500);
    mq.addEventListener('change', onTurn);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener('change', onTurn);
    };
  }, []);

  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    if (location.pathname === prevPath.current) {
      // Same page (query/state change): never animate.
      setShown(location);
      return;
    }
    prevPath.current = location.pathname;

    const plan = motionAllowed() ? planFor(location.pathname, currentOrientation()) : null;
    const video = plan ? takeReady(plan.clip) : null;
    if (!plan || !video) {
      setFx(null);
      setShown(location);
      return;
    }
    const key = ++counter.current;
    setFx({ key, clip: plan.clip, mode: plan.mode, video });
    if (plan.mode === 'cover') {
      timer.current = window.setTimeout(() => setShown(location), plan.clip.peakMs);
    } else {
      setShown(location);
    }
  }, [location]);

  // Stable identity: RouteFx re-runs its effect when this changes, which would restart the animation.
  const done = useCallback(
    (key: number) => setFx((cur) => (cur && cur.key === key ? null : cur)),
    [],
  );
  return { shown, fx, done };
}

export function RouteFx({ fx, onDone }: { fx: Active; onDone: (key: number) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const backdrop = backdropRef.current;
    if (!host || !backdrop) return;
    const { video, clip, mode } = fx;
    const peak = clip.peakMs;
    const total = clip.durationMs;

    // Backdrop keeps the page hidden around the peak even where the clip itself
    // has gaps (neon lines, flying tiles); the clip is screen-blended on top.
    // Offsets must stay within [0,1] and never decrease, whatever the clip's
    // peak is (a late peak would push the last offset past the end).
    const at = (ms: number) => Math.min(1, Math.max(0, ms / total));
    const frames: Keyframe[] =
      mode === 'cover'
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: at(peak - 260) },
            { opacity: 1, offset: at(peak + 120) },
            { opacity: 0, offset: at(peak + 560) },
            { opacity: 0, offset: 1 },
          ]
        : [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: at(80) },
            { opacity: 0, offset: at(430) },
            { opacity: 0, offset: 1 },
          ];
    const anim = backdrop.animate(frames, { duration: total, fill: 'forwards' });
    // Some shots don't clear to black on their own, so ease the picture in and
    // out too instead of letting it pop on and off.
    const fade = host.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: at(Math.min(150, total * 0.2)) },
        { opacity: 1, offset: at(total - 380) },
        { opacity: 0, offset: 1 },
      ],
      { duration: total, fill: 'forwards' },
    );

    video.className = 'route-fx-video';
    host.appendChild(video);
    video.currentTime = 0;
    video.play().catch(() => undefined);

    let finished = false;
    // Hands the element back to its hidden parent. Only a natural end (or the
    // safety timeout) reports completion: a cleanup caused by a re-run or an
    // unmount must not, or it would tear down the overlay it is cleaning up.
    const release = (notify: boolean) => {
      if (finished) return;
      finished = true;
      video.pause();
      video.currentTime = 0;
      video.className = '';
      warmHostOf()?.appendChild(video);
      if (notify) onDone(fx.key);
    };
    const end = () => release(true);
    video.addEventListener('ended', end);
    const safety = window.setTimeout(end, total + 400);
    return () => {
      window.clearTimeout(safety);
      video.removeEventListener('ended', end);
      anim.cancel();
      fade.cancel();
      release(false);
    };
  }, [fx, onDone]);

  return (
    <div className="route-fx" data-mode={fx.mode} aria-hidden="true">
      <div className="route-fx-backdrop" ref={backdropRef} />
      <div className="route-fx-host" ref={hostRef} />
    </div>
  );
}

function warmHostOf() {
  return warmHost;
}
