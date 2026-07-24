import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { ChatMessage } from '../api/types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * The site-wide "心情便利貼" — a floating sticky-note chat widget mounted
 * once at the app root. Only rendered for logged-in users; history loads
 * over REST on open, then a WebSocket keeps it live (new posts and admin
 * moderation/deletes) without polling.
 */
export function ChatWidget() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token || !open) return;

    let cancelled = false;
    api
      .listChatMessages(token)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => {
        if (!cancelled) setError('留言載入失敗');
      });

    const socket = io(BASE_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('chat:new', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });
    socket.on('chat:deleted', ({ id }: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    });
    socket.on('chat:error', (message: string) => setError(message));
    socket.on('connect_error', () => setError('連線失敗，請重新整理再試'));

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !socketRef.current) return;
    setError(null);
    socketRef.current.emit('chat:send', { content });
    setDraft('');
  }

  if (!token) return null;

  return (
    <div className="chat-widget">
      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <span>心情便利貼</span>
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
            {messages.length === 0 && (
              <p className="hint">還沒有人留言，來說句話吧！</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="chat-message">
                <span className="chat-author">{m.authorName}</span>
                <span className="chat-content">{m.content}</span>
              </div>
            ))}
          </div>
          {error && <p className="error chat-error">{error}</p>}
          <form className="chat-input-row" onSubmit={handleSend}>
            <input
              value={draft}
              maxLength={500}
              placeholder="留下你的心情或建議…"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" disabled={!draft.trim()}>
              送出
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="chat-toggle"
        aria-label={open ? '關閉心情便利貼' : '開啟心情便利貼'}
        onClick={() => setOpen((v) => !v)}
      >
        💬
      </button>
    </div>
  );
}
