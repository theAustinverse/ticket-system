import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { CreatedSponsorship, SponsorshipInfo } from '../api/types';

/** Sentinel for the 4th option; the three presets are plain numbers. */
const CUSTOM = 'custom';

/**
 * Small-sponsorship box under the event list. No money moves here: picking an
 * amount records a pledge and shows the transfer instructions plus a 6-digit
 * reference code, which an admin later matches against the bank statement.
 */
export function SponsorBox() {
  const { token } = useAuth();
  const [info, setInfo] = useState<SponsorshipInfo | null>(null);
  const [choice, setChoice] = useState<number | typeof CUSTOM | null>(null);
  const [custom, setCustom] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSponsorship | null>(null);

  useEffect(() => {
    api.getSponsorshipInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  if (!info) return null;

  const amount = choice === CUSTOM ? Number(custom) : choice;
  const validAmount =
    amount !== null &&
    Number.isInteger(amount) &&
    amount >= info.minAmount &&
    amount <= info.maxAmount;

  async function submit() {
    if (!token || !validAmount || amount === null) return;
    setSubmitting(true);
    setError(null);
    try {
      setCreated(await api.createSponsorship(token, amount));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '送出失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <section className="sponsor-box">
        <h2>謝謝你的支持！</h2>
        <p>
          你選擇贊助 <strong>NT$ {created.amount.toLocaleString()}</strong>。請依下方方式轉帳，
          <strong>轉帳備註請填對帳碼</strong>，行政組收到後會確認。
        </p>
        <p className="sponsor-code">
          對帳碼 <strong>{created.referenceCode}</strong>
        </p>
        {created.paymentInfo ? (
          <pre className="sponsor-payment">{created.paymentInfo}</pre>
        ) : (
          <p className="hint">收款方式將由行政組另行公告，你的贊助意願已記錄。</p>
        )}
        <button
          type="button"
          onClick={() => {
            setCreated(null);
            setChoice(null);
            setCustom('');
          }}
        >
          再贊助一筆
        </button>
      </section>
    );
  }

  return (
    <section className="sponsor-box">
      <h2>小額贊助</h2>
      <p className="hint">支持行政組與創作者，讓活動更精彩。金額隨喜，感謝你！</p>
      <div className="sponsor-options" role="radiogroup" aria-label="贊助金額">
        {info.presets.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={choice === n}
            className={`sponsor-option ${choice === n ? 'is-selected' : ''}`}
            onClick={() => setChoice(n)}
          >
            NT$ {n}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={choice === CUSTOM}
          className={`sponsor-option ${choice === CUSTOM ? 'is-selected' : ''}`}
          onClick={() => setChoice(CUSTOM)}
        >
          自訂金額
        </button>
      </div>
      {choice === CUSTOM && (
        <label className="sponsor-custom">
          金額（NT${info.minAmount}–{info.maxAmount.toLocaleString()}，整數）
          <input
            type="number"
            inputMode="numeric"
            min={info.minAmount}
            max={info.maxAmount}
            step={1}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="輸入想贊助的金額"
          />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      {token ? (
        <button type="button" disabled={!validAmount || submitting} onClick={submit}>
          {submitting ? '送出中…' : '我要贊助'}
        </button>
      ) : (
        <p className="hint">
          請先 <Link to="/login">登入</Link> 再贊助
        </p>
      )}
    </section>
  );
}
