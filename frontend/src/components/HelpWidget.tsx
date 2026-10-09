import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { HelpItem } from '../api/types';

/**
 * 客服小幫手 — a floating private Q&A panel for logged-in users. Unlike the
 * public 心情便利貼 next to it, only the asker and the admin see these. The
 * bot answers what it is sure of; otherwise the question is escalated and the
 * admin's reply appears in the same list (checked on open and every 30s).
 */
export function HelpWidget() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HelpItem[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token || !open) return;
    let cancelled = false;
    const load = () =>
      api
        .listMyHelp(token)
        .then((rows) => {
          if (!cancelled) setItems(rows);
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || !token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api.askHelp(token, question);
      setItems((prev) => [...prev, item]);
      setDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '送出失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;

  return (
    <div className="chat-widget help-widget">
      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <span>客服小幫手</span>
            <button
              type="button"
              className="icon-button"
              aria-label="關閉"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="chat-messages" ref={listRef}>
            <p className="hint">
              有系統操作的問題都可以問我（例如怎麼退票、怎麼轉讓）。我不確定的會轉給管理員，回覆會顯示在這裡。
              只有你和管理員看得到。
            </p>
            {items.map((it) => (
              <div key={it.id} className="help-item">
                <div className="help-q">{it.question}</div>
                {it.answer ? (
                  <div className={`help-a ${it.answeredBy === 'ADMIN' ? 'help-a-admin' : ''}`}>
                    <span className="help-by">
                      {it.answeredBy === 'ADMIN' ? '管理員' : '小幫手'}
                    </span>
                    {it.answer}
                  </div>
                ) : (
                  <div className="help-a help-a-wait">
                    <span className="help-by">小幫手</span>
                    這個問題我不太確定，已轉給管理員，回覆後會顯示在這裡。
                  </div>
                )}
              </div>
            ))}
          </div>
          {error && <p className="error chat-error">{error}</p>}
          <form className="chat-input-row" onSubmit={handleSend}>
            <input
              value={draft}
              maxLength={500}
              placeholder="輸入你的問題…"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" disabled={!draft.trim() || busy}>
              {busy ? '思考中' : '送出'}
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="chat-toggle"
        aria-label={open ? '關閉客服小幫手' : '開啟客服小幫手'}
        onClick={() => setOpen((v) => !v)}
      >
        ❓
      </button>
    </div>
  );
}
