import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hk-prologue-seen';

const NARRATION = `歲月如歌，留聲機裡的舊曲迴盪在冰室的時光裡。從維多利亞港的點點星帆，到璀璨奪目的都會夜景，香港的歷史是一幅流動的畫卷。我們銘記的，不只是那段黃金歲月的繁華奪目，更是那份在風雨中昂首闊步、歷久彌新的香江靈魂。現在就讓我們把那些斑駁的陳年記憶暫時封存，把時間線拉回2026年10月31日的今天，一同目賭我們璀璨輝煌的崢嶸歲月與迴腸盪氣的狹義精神。`;

/**
 * One-time narration shown the first time a visitor enters the site this
 * session, layered above the loading flicker so the story lands before any
 * page content does. Dismissal is remembered in sessionStorage so it doesn't
 * repeat on every route change within the same visit.
 */
export function Prologue() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="prologue-overlay" role="dialog" aria-modal="true">
      <div className="prologue-panel">
        <p className="prologue-eyebrow">香江往事</p>
        <h2 className="prologue-title">今晚，只對自己人</h2>
        <p className="prologue-text">{NARRATION}</p>
        <button className="prologue-button" onClick={dismiss}>
          步入盛會
        </button>
      </div>
    </div>
  );
}
