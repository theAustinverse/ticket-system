import { motionIsOff } from './motionPrefs';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

interface RevealProps {
  as?: 'div' | 'section' | 'h2' | 'li' | 'p';
  className?: string;
  /** Where the block slides in from. */
  from?: 'up' | 'left' | 'right' | 'zoom';
  /** Stagger in ms, for siblings that arrive together. */
  delay?: number;
  children: ReactNode;
}

/**
 * Fades and slides its content in the first time it scrolls into view, then
 * stays put. With reduced motion (or no IntersectionObserver) it renders
 * visible from the start, so nothing is ever left hidden.
 */
export function Reveal({ as = 'div', className = '', from = 'up', delay = 0, children }: RevealProps) {
  // One concrete tag type keeps the ref and props simple; the element is only ever a block container.
  const Tag = as as 'div';
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(() => motionIsOff());

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  const style = { '--reveal-delay': `${delay}ms` } as CSSProperties;
  return (
    <Tag
      ref={ref}
      style={style}
      className={`reveal reveal-${from} ${shown ? 'is-in' : ''} ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
