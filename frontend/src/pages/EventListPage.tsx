import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { EventSummary } from '../api/types';
import { PageLoading } from '../components/PageLoading';
import { SponsorBox } from '../components/SponsorBox';
import { ContactBox } from '../components/ContactBox';
import { ChangelogBox } from '../components/ChangelogBox';
import { ChangelogPopup } from '../components/ChangelogPopup';
import { CHANGELOG, recentEntries } from '../changelog';
import { Reveal } from '../components/Reveal';
import { motionIsOff } from '../components/motionPrefs';
import eventPoster from '../assets/poster/event-poster.webp';

const BASE_CHAPTERS = [
  { id: 'home-top', label: '首頁' },
  { id: 'home-events', label: '活動列表' },
  { id: 'home-more', label: '贊助與聯絡' },
];
const CHANGELOG_CHAPTER = { id: 'home-changelog', label: '更新日誌' };

/** Taipei time, matching the rest of the site, whatever the visitor's device clock says. */
function formatSession(startTime: string): string {
  return new Date(startTime).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Home page as a scroll story: a full-screen hero whose poster drifts and
 * fades as you scroll, then chapters that slide in when they arrive, a thin
 * progress line, and dots on the side showing which chapter you're in.
 * It is only presentation — the event links, sponsor box and contact box are
 * the same components as before, and the purchase path is untouched.
 */
export function EventListPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string>(BASE_CHAPTERS[0].id);
  const { token } = useAuth();
  const showChangelog = recentEntries(CHANGELOG).length > 0;
  const chapters = showChangelog ? [...BASE_CHAPTERS, CHANGELOG_CHAPTER] : BASE_CHAPTERS;
  const heroRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    api
      .listEvents()
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '載入活動列表失敗，請重新整理再試一次');
        setLoading(false);
      });
  }, []);

  // Scroll-linked bits: the progress line and the hero's drift/fade. One passive
  // listener, coalesced to one write per frame, and nothing at all when the
  // visitor prefers less motion.
  useEffect(() => {
    if (loading || error || motionIsOff()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (barRef.current) barRef.current.style.transform = `scaleX(${max > 0 ? Math.min(y / max, 1) : 0})`;
      const hero = heroRef.current;
      if (hero) {
        const p = Math.min(Math.max(y / Math.max(hero.offsetHeight, 1), 0), 1);
        hero.style.setProperty('--hero-p', p.toFixed(3));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [loading, error]);

  // Which chapter is on screen, for the side dots.
  useEffect(() => {
    if (loading || error || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { threshold: [0.25, 0.5, 0.75] },
    );
    for (const c of chapters) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [loading, error, chapters.length]);

  if (loading) return <PageLoading />;
  if (error) return <div className="page error">{error}</div>;

  function goTo(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: motionIsOff() ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  const primary = events[0];
  const session = primary?.sessions?.[0];

  return (
    <div className="home">
      <div className="home-progress" aria-hidden="true">
        <span ref={barRef} />
      </div>
      <nav className="home-dots" aria-label="首頁章節">
        {chapters.map((c) => (
          <button
            key={c.id}
            type="button"
            className={active === c.id ? 'is-active' : ''}
            aria-label={c.label}
            aria-current={active === c.id ? 'true' : undefined}
            onClick={() => goTo(c.id)}
          >
            <span>{c.label}</span>
          </button>
        ))}
      </nav>

      <header id="home-top" ref={heroRef} className="home-hero">
        <div className="home-hero-bg" style={{ backgroundImage: `url(${eventPoster})` }} />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-kicker">TS ANNUAL PARTY</p>
          <h1>{primary?.name ?? 'TS年度盛會'}</h1>
          {primary?.description && <p className="home-tagline">{primary.description}</p>}
          {session && (
            <dl className="home-facts">
              <div>
                <dt>日期</dt>
                <dd>{formatSession(session.startTime)}</dd>
              </div>
              <div>
                <dt>地點</dt>
                <dd>{session.venue}</dd>
              </div>
            </dl>
          )}
          <button type="button" className="home-cta" onClick={() => goTo('home-events')}>
            查看活動 ↓
          </button>
        </div>
        <div className="home-scroll-hint" aria-hidden="true">
          <span>向下捲動</span>
          <i />
        </div>
      </header>

      <section id="home-events" className="home-chapter">
        <Reveal as="h2" className="home-chapter-title">
          <span className="home-chapter-no">01</span>活動列表
        </Reveal>
        {events.length === 0 && <p>目前沒有活動</p>}
        <ul className={`event-list ${token ? '' : 'event-list-guest'}`}>
          {events.map((event, i) => (
            <li key={event.id}>
              <Reveal from={i % 2 === 0 ? 'left' : 'right'} delay={i * 90}>
                <Link
                  to={`/events/${event.id}`}
                  className={`event-card ${token ? '' : 'event-card-guest'}`}
                >
                  {token && <h2>{event.name}</h2>}
                  {token && event.description && <p>{event.description}</p>}
                  {!token && (
                    <div
                      className="event-card-poster"
                      style={{ backgroundImage: `url(${eventPoster})` }}
                    />
                  )}
                </Link>
              </Reveal>
            </li>
          ))}
          {token && (
            <li>
              <Reveal from="right" delay={events.length * 90}>
                <Link to="/trailer" className="event-card">
                  <h2>TS年度盛會</h2>
                  <p>史詩級鉅作，重磅登場</p>
                </Link>
              </Reveal>
            </li>
          )}
        </ul>
      </section>

      <section id="home-more" className="home-chapter">
        <Reveal as="h2" className="home-chapter-title">
          <span className="home-chapter-no">02</span>贊助與聯絡
        </Reveal>
        <Reveal from="up">
          <SponsorBox />
        </Reveal>
        <Reveal from="up" delay={120}>
          <ContactBox />
        </Reveal>
      </section>

      {showChangelog && (
        <section id="home-changelog" className="home-chapter">
          <Reveal as="h2" className="home-chapter-title">
            <span className="home-chapter-no">03</span>更新日誌
          </Reveal>
          <Reveal from="up">
            <ChangelogBox />
          </Reveal>
        </section>
      )}

      <ChangelogPopup />
    </div>
  );
}
