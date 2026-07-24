import { useEffect, useRef, useState } from 'react';
import bgmTrack from '../assets/audio/bgm.mp3';

const STORAGE_KEY = 'bgm-muted';

/**
 * Mounted once at the app root so it keeps playing underneath route changes.
 * Browsers block autoplay-with-sound until the user has interacted with the
 * page at least once, so we optimistically try to play on mount and, if
 * that's rejected, retry on the first click/keydown anywhere on the page.
 */
export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [muted, setMuted] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true',
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.muted = muted;
    audio.volume = 0.35;

    function tryPlay() {
      audio?.play().catch(() => {
        // Autoplay blocked; wait for a user gesture instead.
      });
    }
    tryPlay();

    function onFirstInteraction() {
      tryPlay();
      window.removeEventListener('click', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    }
    window.addEventListener('click', onFirstInteraction);
    window.addEventListener('keydown', onFirstInteraction);

    return () => {
      window.removeEventListener('click', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.muted = muted;
      if (muted) {
        audio.pause();
      } else {
        audio.play().catch(() => {
          // Still blocked until a user gesture; the click that just set
          // muted=false already counts as one, so this normally succeeds.
        });
      }
    }
    localStorage.setItem(STORAGE_KEY, String(muted));
  }, [muted]);

  return (
    <>
      <audio ref={audioRef} src={bgmTrack} loop />
      <button
        type="button"
        className="bgm-toggle"
        aria-label={muted ? '開啟背景音樂' : '關閉背景音樂'}
        onClick={() => setMuted((m) => !m)}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </>
  );
}
