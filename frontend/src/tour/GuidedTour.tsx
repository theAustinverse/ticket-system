import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTour } from './TourProvider';
import { buildSteps } from './steps';
import { SimScreenView } from './screens';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

export function GuidedTour() {
  const { isActive, stepIndex, demoEventId, next, prev, end } = useTour();
  const location = useLocation();
  const navigate = useNavigate();

  const steps = useMemo(() => buildSteps(demoEventId), [demoEventId]);
  const step = isActive ? steps[stepIndex] : undefined;

  const [rect, setRect] = useState<Rect | null>(null);
  const [notFound, setNotFound] = useState(false);
  const selectorRef = useRef<string | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(0);

  // Keep the browser on the route this step is anchored to.
  useEffect(() => {
    if (!step) return;
    const wantRoute =
      step.kind === 'real' ? step.route : step.kind === 'center' ? step.route : undefined;
    if (wantRoute && location.pathname !== wantRoute) {
      navigate(wantRoute);
    }
  }, [step, location.pathname, navigate]);

  const measure = useCallback(() => {
    const selector = selectorRef.current;
    if (!selector) return;
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  // Locate the target once per step: retry on a timer (tolerates async page
  // loads), scroll it into view instantly, measure synchronously right after
  // (reading layout geometry forces the browser to apply the scroll before
  // returning a value, so no extra paint-frame wait is needed — and relying
  // on requestAnimationFrame here was fragile, since rAF only fires on an
  // actual paint and can be starved during rapid/backgrounded interaction).
  // The tour blocks real interaction (see .tour-catcher and the
  // disabled/readOnly sim inputs), so nothing besides our own scrollIntoView
  // call can move the target after that — no need for a perpetual poll.
  useEffect(() => {
    if (!isActive || !step) return;

    const selector =
      step.kind === 'real' ? step.selector : step.kind === 'sim' ? step.highlight ?? null : null;
    selectorRef.current = selector;
    setRect(null);
    setNotFound(false);

    if (!selector) return; // centered card, or a sim step with no specific highlight

    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();

    const measureNow = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const tryFind = () => {
      if (cancelled) return;
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        measureNow(el);
        // Re-measure once more shortly after: guards against the rare case
        // where this step's own render (e.g. a route change still settling,
        // or the simulated screen mounting for the first time) lands the
        // element somewhere slightly different than this first, immediate
        // reading — self-corrects without depending on exactly why.
        timer = window.setTimeout(() => {
          if (cancelled) return;
          const el2 = document.querySelector(selector) as HTMLElement | null;
          if (el2) measureNow(el2);
        }, 150);
        return;
      }
      if (Date.now() - startedAt > 4000) {
        setNotFound(true);
        return;
      }
      timer = window.setTimeout(tryFind, 100);
    };
    tryFind();

    window.addEventListener('resize', measure);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [isActive, step, stepIndex, location.pathname, measure]);

  // The card's real height, so it can be placed by measurement instead of a
  // guess: a tall target (the whole personal-info block) used to push the card
  // up and off the top of the screen.
  useLayoutEffect(() => {
    if (tipRef.current) setTipH(tipRef.current.offsetHeight);
  }, [step, stepIndex, rect, notFound]);

  // The simulated page can be scrolled by hand; keep the spotlight on its target.
  useEffect(() => {
    if (!isActive) return;
    const layer = document.querySelector('.tour-sim-layer');
    if (!layer) return;
    layer.addEventListener('scroll', measure, { passive: true });
    return () => layer.removeEventListener('scroll', measure);
  }, [isActive, step, measure]);

  if (!isActive || !step) return null;

  const total = steps.length;
  const isLast = stepIndex === total - 1;
  const isSim = step.kind === 'sim';
  const showRing = !!rect;

  // Tooltip placement: below the target if the whole card fits there, else
  // above; if the target is so tall that neither side has room, the card sits
  // over the edge of the screen with more room. Always clamped fully on-screen
  // (the card itself scrolls if the screen is shorter than the card). Centered
  // when there's no target (welcome/finish cards or an unfound element).
  let tooltipStyle: React.CSSProperties;
  if (rect) {
    const vh = window.innerHeight;
    const margin = 12;
    const gap = PAD + 6;
    const h = Math.min(tipH || 240, vh - margin * 2);
    const roomBelow = vh - (rect.top + rect.height) - gap - margin;
    const roomAbove = rect.top - gap - margin;
    let top: number;
    if (roomBelow >= h) top = rect.top + rect.height + gap;
    else if (roomAbove >= h) top = rect.top - gap - h;
    else top = roomBelow >= roomAbove ? vh - h - margin : margin;
    top = Math.min(Math.max(top, margin), vh - h - margin);
    // Half of the CSS width (min(340px, 100vw - 32px)) — keeps the card fully
    // on-screen on narrow phones instead of the old fixed 180px assumption,
    // which overflowed below ~360px-wide viewports.
    const halfWidth = Math.min(340, window.innerWidth - 32) / 2;
    let left = rect.left + rect.width / 2;
    left = Math.min(Math.max(left, halfWidth + 16), window.innerWidth - halfWidth - 16);
    tooltipStyle = { top, left, transform: 'translateX(-50%)' };
  } else {
    tooltipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="tour-root">
      {/* Simulated page for downstream steps sits beneath the spotlight. */}
      {isSim && (
        <div className="tour-sim-layer">
          <SimScreenView screen={step.screen} />
        </div>
      )}

      {/* Click-blocker: freezes the underlying page during real-element steps. */}
      {!isSim && <div className="tour-catcher" onClick={(e) => e.stopPropagation()} />}

      {/* Dark backdrop with a bright window over the target (box-shadow trick). */}
      {showRing && rect && (
        <div
          className="tour-ring"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      )}
      {/* No target → a plain full-screen dark veil behind the centered card. */}
      {!showRing && <div className="tour-veil" />}

      <div className="tour-tooltip" style={tooltipStyle} ref={tipRef}>
        <div className="tour-scroll">
          <p className="tour-step-count">
            步驟 {stepIndex + 1} / {total}
          </p>
          <h3 className="tour-title">{step.title}</h3>
          <p className="tour-body">{step.body}</p>
          {notFound && step.kind === 'real' && (
            <p className="tour-note">（此區塊需登入或開賣後才會出現，這裡先為你說明。）</p>
          )}
        </div>
        <div className="tour-controls">
          <button type="button" className="tour-skip" onClick={end}>
            跳過
          </button>
          <div className="tour-nav">
            {stepIndex > 0 && (
              <button type="button" className="tour-prev" onClick={prev}>
                上一步
              </button>
            )}
            <button type="button" className="tour-next" onClick={isLast ? end : next}>
              {isLast ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
