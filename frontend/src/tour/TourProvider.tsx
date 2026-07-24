import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

/**
 * Drives the interactive buyer tutorial. The tour is a single ordered list
 * of steps (see steps.tsx) that spans the whole purchase journey. Pages the
 * user can browse pre-launch (event list / detail) are highlighted live;
 * the downstream pages that need real backend state (registration, queue,
 * order, my-tickets) are shown as faithful simulated screens rendered by the
 * tour itself, so nothing touches the real purchase-flow code.
 */
interface TourContextValue {
  isActive: boolean;
  stepIndex: number;
  /** A real event id to build the /events/:id highlight route, resolved at start. */
  demoEventId: string | null;
  start: () => Promise<void>;
  next: () => void;
  prev: () => void;
  end: () => void;
  goTo: (index: number) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [demoEventId, setDemoEventId] = useState<string | null>(null);

  const start = useCallback(async () => {
    // The event-detail highlight step needs a real event id in its route.
    // Grab the first event; if the lookup fails, the tour still runs and
    // those steps fall back to a centered explainer (see GuidedTour).
    try {
      const events = await api.listEvents();
      setDemoEventId(events[0]?.id ?? null);
    } catch {
      setDemoEventId(null);
    }
    setStepIndex(0);
    setIsActive(true);
  }, []);

  const end = useCallback(() => {
    setIsActive(false);
    setStepIndex(0);
  }, []);

  const next = useCallback(() => setStepIndex((i) => i + 1), []);
  const prev = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);
  const goTo = useCallback((index: number) => setStepIndex(index), []);

  const value = useMemo(
    () => ({ isActive, stepIndex, demoEventId, start, next, prev, end, goTo }),
    [isActive, stepIndex, demoEventId, start, next, prev, end, goTo],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within a TourProvider');
  return ctx;
}
