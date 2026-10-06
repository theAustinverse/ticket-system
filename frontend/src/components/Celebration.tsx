import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import fireworksLand from '../assets/anim/fireworks-l.mp4';
import fireworksPort from '../assets/anim/fireworks-p.mp4';
import { currentOrientation } from '../transitions/clips';
import { motionAllowed } from '../transitions/motion';

/**
 * Full-screen fireworks that play once over a success page and fade away on
 * their own. Taps pass straight through. Skipped under reduced motion / data
 * saver, and `onceKey` stops it replaying when the same page is reloaded.
 */
export function Celebration({ onceKey }: { onceKey: string }) {
  const [on, setOn] = useState(() => {
    if (!motionAllowed()) return false;
    try {
      return !sessionStorage.getItem(onceKey);
    } catch {
      return true;
    }
  });
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!on) return;
    try {
      sessionStorage.setItem(onceKey, '1');
    } catch {
      // Private mode: it may replay on reload, which is harmless.
    }
    const stop = window.setTimeout(() => setOn(false), 6000);
    return () => window.clearTimeout(stop);
  }, [on, onceKey]);

  if (!on) return null;
  // Portaled to <body>: pages animate with a transform, which would make a
  // fixed child size itself to the page card instead of the screen.
  return createPortal(
    <video
      ref={ref}
      className="celebration"
      src={currentOrientation() === 'port' ? fireworksPort : fireworksLand}
      autoPlay
      muted
      playsInline
      aria-hidden="true"
      onEnded={() => setOn(false)}
    />,
    document.body,
  );
}
