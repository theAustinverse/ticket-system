import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Kept as one constant so the wording lives in exactly one place. */
export const NOTICE_TEXT =
  '票券收費統一繳交給領導人，凡有任何人以任何形式進行收費必為詐騙，請抱持謹慎！';

/** Scroll speed in px/s: the loop length (and so its duration) varies with screen width, the speed doesn't. */
const SCROLL_SPEED = 60;

/**
 * Scrolling anti-scam notice pinned above the navbar on public pages.
 *
 * The navbar is sticky at top: 0, so while this is mounted it publishes its
 * height as --notice-h and the navbar sits just below it (see .navbar).
 *
 * The loop is two identical groups slid left by exactly one group's width, so
 * it only stays gapless if one group is at least as wide as the screen. A
 * single sentence is shorter than a wide monitor, so each group repeats the
 * sentence as many times as it takes to cover the viewport (re-measured on
 * resize). Every copy after the first is aria-hidden, so a screen reader reads
 * the notice once. With reduced motion the animation is off and just the one
 * sentence wraps (see styles.css).
 */
export function NoticeMarquee() {
  const itemRef = useRef<HTMLSpanElement | null>(null);
  const [copies, setCopies] = useState(1);
  const [groupWidth, setGroupWidth] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--notice-h', '2.3rem');
    return () => {
      root.style.removeProperty('--notice-h');
    };
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const item = itemRef.current;
      if (!item) return;
      const itemWidth = item.getBoundingClientRect().width;
      if (itemWidth <= 0) return;
      const n = Math.max(1, Math.ceil(window.innerWidth / itemWidth));
      setCopies(n);
      setGroupWidth(n * itemWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    // Web fonts change the sentence's width after first paint.
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const group = (hidden: boolean) => (
    <div className="notice-marquee-group" aria-hidden={hidden || undefined}>
      {Array.from({ length: copies }, (_, i) => (
        <span
          key={i}
          ref={!hidden && i === 0 ? itemRef : undefined}
          className="notice-marquee-item"
          aria-hidden={hidden || i > 0 ? true : undefined}
        >
          ⚠ {NOTICE_TEXT}
        </span>
      ))}
    </div>
  );

  return (
    <div className="notice-marquee" role="note" aria-label="防詐騙提醒">
      <div
        className="notice-marquee-track"
        style={groupWidth ? { animationDuration: `${groupWidth / SCROLL_SPEED}s` } : undefined}
      >
        {group(false)}
        {group(true)}
      </div>
    </div>
  );
}
