import { useEffect, useState } from 'react';
import { recentEntries, CHANGELOG, RECENT_DAYS } from '../changelog';

const SEEN_KEY = 'changelog-seen';
const PROLOGUE_KEY = 'hk-prologue-seen';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(id: string) {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    // Private mode etc.: worst case the popup shows again next visit.
  }
}

function prologueDone(): boolean {
  try {
    return !!sessionStorage.getItem(PROLOGUE_KEY);
  } catch {
    return true;
  }
}

/**
 * Pops once per visitor when something new landed in the last few days — the
 * newest recent entry's id is remembered, so it shows again only when a newer
 * feature is added. Waits for the opening narration to be dismissed so the two
 * overlays never stack.
 */
export function ChangelogPopup() {
  const entries = recentEntries(CHANGELOG);
  const newestId = entries[0]?.id ?? null;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!newestId || readSeen() === newestId) return;
    if (prologueDone()) {
      setOpen(true);
      return;
    }
    const timer = window.setInterval(() => {
      if (prologueDone()) {
        window.clearInterval(timer);
        setOpen(true);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [newestId]);

  useEffect(() => {
    if (!open || !newestId) return;
    writeSeen(newestId);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, newestId]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div
        className="modal-card changelog-popup"
        role="dialog"
        aria-modal="true"
        aria-label="系統更新"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>系統更新了 ✨</h2>
        <p className="hint">最近 {RECENT_DAYS} 天新增的功能</p>
        <ul className="changelog-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="changelog-date">{e.date.slice(5).replace('-', '/')}</span>
              <div>
                <strong>{e.title}</strong>
                <p>{e.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setOpen(false)}>
          知道了
        </button>
      </div>
    </div>
  );
}
