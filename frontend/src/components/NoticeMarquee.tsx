import { useEffect } from 'react';

/** Kept as one constant so the wording lives in exactly one place. */
export const NOTICE_TEXT =
  '票券收費統一繳交給領導人，凡有任何人以任何形式進行收費必為詐騙，請抱持謹慎！';

/**
 * Scrolling anti-scam notice pinned above the navbar on public pages.
 *
 * The navbar is sticky at top: 0, so while this is mounted it publishes its
 * height as --notice-h and the navbar sits just below it (see .navbar). The
 * text is repeated so the loop has no gap; the second copy is aria-hidden so
 * a screen reader reads the notice once. With reduced motion the animation is
 * off and the text simply wraps (see styles.css).
 */
export function NoticeMarquee() {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--notice-h', '2.3rem');
    return () => {
      root.style.removeProperty('--notice-h');
    };
  }, []);

  return (
    <div className="notice-marquee" role="note" aria-label="防詐騙提醒">
      <div className="notice-marquee-track">
        <span className="notice-marquee-item">⚠ {NOTICE_TEXT}</span>
        <span className="notice-marquee-item" aria-hidden="true">
          ⚠ {NOTICE_TEXT}
        </span>
      </div>
    </div>
  );
}
