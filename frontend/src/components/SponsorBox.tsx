import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { MySponsorship, SponsorshipInfo } from '../api/types';
import { Icon3D } from './Icon3D';

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Address with the first and last 6 characters emphasised, so sponsors can check them against the source. */
function CryptoAddress({ address }: { address: string }) {
  return (
    <code className="sponsor-address">
      <strong>{address.slice(0, 8)}</strong>
      {address.slice(8, -6)}
      <strong>{address.slice(-6)}</strong>
    </code>
  );
}

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
  const [created, setCreated] = useState<MySponsorship | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [reported, setReported] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getSponsorshipInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  // Someone who picked an amount, then left before paying, gets their code
  // back instead of having to start over (and burn one of their open slots).
  useEffect(() => {
    if (!token) return;
    api
      .listMySponsorships(token)
      .then((rows) => {
        const open = rows.find((r) => r.status === 'PENDING' && !r.reportedAt);
        if (open) setCreated(open);
      })
      .catch(() => undefined);
  }, [token]);

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

  function reset() {
    setCreated(null);
    setChoice(null);
    setCustom('');
    setTypedCode('');
    setTxHash('');
    setReported(false);
    setError(null);
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard refused (older in-app browsers): the address is selectable text
      setCopied(false);
    }
  }

  async function report() {
    if (!token || !created) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.reportSponsorship(token, created.id, typedCode, txHash.trim() || undefined);
      setReported(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '送出失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  }

  if (created && reported) {
    return (
      <section className="sponsor-box">
        <div className="success-burst">
          <Icon3D name="ingot" motion="pop" size={84} />
          <h2>謝謝你的支持！</h2>
        </div>
        <p>
          已通知行政組。收到 <strong>NT$ {created.amount.toLocaleString()}</strong> 並核對對帳碼{' '}
          <strong>{created.referenceCode}</strong> 後會確認。
        </p>
        <button type="button" onClick={reset}>
          再贊助一筆
        </button>
      </section>
    );
  }

  if (created) {
    return (
      <section className="sponsor-box">
        <h2>最後一步：轉帳</h2>
        <p>
          你選擇贊助 <strong>NT$ {created.amount.toLocaleString()}</strong>，請依下方資訊轉帳。
        </p>
        <p className="sponsor-warn">
          轉帳備註一定要填這組對帳碼，行政組才知道是你轉的！
        </p>
        <p className="sponsor-code">
          對帳碼 <strong>{created.referenceCode}</strong>
        </p>
        {info.paymentInfo ? (
          <pre className="sponsor-payment">{info.paymentInfo}</pre>
        ) : (
          <p className="hint">收款方式將由行政組另行公告。</p>
        )}
        {info.crypto && (
          <div className="sponsor-crypto">
            <h3>或用加密貨幣贊助（選用）</h3>
            <p className="sponsor-warn">
              只收 <strong>{info.crypto.coin}</strong>，網路必須選{' '}
              <strong>{info.crypto.network}</strong>。選錯幣或選錯網路，款項通常無法找回。
            </p>
            <CryptoAddress address={info.crypto.address} />
            <p className="hint">
              轉帳前請核對地址的前 8 碼與最後 6 碼（粗體處）。金額請轉約 NT$ {created.amount.toLocaleString()} 等值的 {info.crypto.coin}。
              {info.crypto.memo && <> 備註／Memo 請填 <strong>{info.crypto.memo}</strong>。</>}
            </p>
            <button type="button" className="link-button" onClick={() => copyAddress(info.crypto!.address)}>
              {copied ? '已複製' : '複製地址'}
            </button>
            <label className="sponsor-custom">
              用加密貨幣轉帳無法填備註，請貼上交易哈希（0x 開頭，共 66 個字元），行政組才能在鏈上核對
              <input
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value.trim())}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {txHash && !TX_HASH_RE.test(txHash) && <p className="error">交易哈希格式不正確</p>}
          </div>
        )}
        <label className="sponsor-custom">
          轉帳完成後，請輸入你在備註填寫的對帳碼，才能送出
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={typedCode}
            onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6 位數對帳碼"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          disabled={typedCode !== created.referenceCode || submitting || (txHash !== '' && !TX_HASH_RE.test(txHash))}
          onClick={report}
        >
          {submitting ? '送出中…' : '我已轉帳，送出'}
        </button>{' '}
        <button type="button" className="link-button" onClick={reset}>
          先不贊助了
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
            {choice === n && <Icon3D name="mahjong" motion="flip" size={26} className="sponsor-tile" />}
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
          {choice === CUSTOM && <Icon3D name="mahjong" motion="flip" size={26} className="sponsor-tile" />}
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
