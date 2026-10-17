import { useEffect, useRef, useState } from 'react';

/** Served from frontend/public/news; the page hides the section if the file is missing. */
export const HEADLINE_IMAGE = '/news/racing-gazette.jpg';
const HEADLINE_ALT = '財神時報 賽馬公報：賽程預測、各路好手介紹與現場活動預告';

/**
 * 頭條新聞: one tall newspaper-style image under the home hero. Tapping it
 * opens a full-size viewer (the gazette's small print is unreadable at column
 * width on a phone), which scrolls when the image is taller than the screen.
 */
export function NewsHeadline({ onMissing }: { onMissing: () => void }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="news-headline"
        onClick={() => setOpen(true)}
        aria-label="放大查看賽馬公報"
      >
        <img src={HEADLINE_IMAGE} alt={HEADLINE_ALT} loading="lazy" onError={onMissing} />
        <span className="news-headline-zoom" aria-hidden="true">點擊放大</span>
      </button>
      {open && (
        <div
          className="news-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="賽馬公報"
          onClick={() => setOpen(false)}
        >
          <button
            ref={closeRef}
            type="button"
            className="news-viewer-close"
            onClick={() => setOpen(false)}
          >
            關閉 ✕
          </button>
          <div className="news-viewer-scroll" onClick={(e) => e.stopPropagation()}>
            <img src={HEADLINE_IMAGE} alt={HEADLINE_ALT} />
          </div>
        </div>
      )}
    </>
  );
}
