import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type QrScannerType from 'qr-scanner';
import { api, ApiError, CHECKIN_TOKEN_KEY } from '../api/client';
import type { CheckInResult, CheckinSeat } from '../api/types';
import { formatTaipei, holderLabel, parseScannedToken, SEAT_STATUS_LABEL } from '../tickets';

const QUICK_MODE_KEY = 'checkin-quick-mode';
/** The same QR held in front of the camera re-reads several times a second — ignore repeats for this long after it's been handled. */
const REPEAT_IGNORE_MS = 3000;

type Outcome =
  | { kind: 'seat'; seat: CheckinSeat; result?: CheckInResult }
  | { kind: 'message'; text: string };

function readQuickMode(): boolean {
  try {
    return localStorage.getItem(QUICK_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function describe(seat: CheckinSeat, result?: CheckInResult) {
  if (result === 'CHECKED_IN') return { ok: true, text: '報到成功' };
  if (seat.status === 'CHECKED_IN') {
    const when = seat.checkedInAt ? formatTaipei(seat.checkedInAt) : '';
    return { ok: false, text: `已經報到過（${when}，${seat.checkedInBy ?? '—'}）` };
  }
  if (seat.status === 'VALID') return { ok: true, text: '可入場，請核對姓名' };
  return { ok: false, text: SEAT_STATUS_LABEL[seat.status] };
}

export function CheckinPage() {
  const navigate = useNavigate();
  const [token] = useState(() => localStorage.getItem(CHECKIN_TOKEN_KEY));
  const [stats, setStats] = useState<{ total: number; checkedIn: number } | null>(null);
  const [quickMode, setQuickMode] = useState(readQuickMode);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CheckinSeat[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const handlingRef = useRef(false);
  const lastRef = useRef<{ token: string; at: number } | null>(null);
  const quickRef = useRef(quickMode);
  quickRef.current = quickMode;
  // While someone valid is on screen waiting for 確認報到, a second code
  // drifting into the camera must not replace them — they'd never be
  // checked in, and staff might not notice the card changed.
  const awaitingConfirmRef = useRef(false);
  awaitingConfirmRef.current =
    outcome?.kind === 'seat' && outcome.seat.status === 'VALID' && !outcome.result;

  useEffect(() => {
    if (!token) navigate('/checkin/login');
  }, [token, navigate]);

  const refreshStats = useCallback(() => {
    if (!token) return;
    api.checkinStats(token).then(setStats).catch(() => {});
  }, [token]);

  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 15000);
    return () => clearInterval(id);
  }, [refreshStats]);

  const doCheckIn = useCallback(
    async (seat: CheckinSeat) => {
      if (!token) return;
      setBusy(true);
      try {
        const res = await api.checkinCheckIn(token, seat.id);
        setOutcome({ kind: 'seat', seat: res.ticket, result: res.result });
        if (res.result === 'CHECKED_IN') navigator.vibrate?.(120);
        setResults((list) => list?.map((s) => (s.id === seat.id ? res.ticket : s)) ?? list);
        refreshStats();
      } catch (err) {
        setOutcome({ kind: 'message', text: err instanceof ApiError ? `報到失敗：${err.message}` : '網路錯誤，報到未完成，請再試一次' });
      } finally {
        setBusy(false);
      }
    },
    [token, refreshStats],
  );

  const handleDecoded = useCallback(
    async (text: string) => {
      if (!token || handlingRef.current || awaitingConfirmRef.current) return;
      const ticketToken = parseScannedToken(text);
      const last = lastRef.current;
      if (ticketToken && last && last.token === ticketToken && Date.now() - last.at < REPEAT_IGNORE_MS) return;

      handlingRef.current = true;
      try {
        if (!ticketToken) {
          setOutcome({ kind: 'message', text: '這不是本活動的票券 QR Code' });
          return;
        }
        lastRef.current = { token: ticketToken, at: Date.now() };
        const seat = await api.checkinScan(token, ticketToken);
        if (quickRef.current && seat.status === 'VALID') {
          await doCheckIn(seat);
        } else {
          setOutcome({ kind: 'seat', seat });
        }
      } catch (err) {
        setOutcome({
          kind: 'message',
          text:
            err instanceof ApiError && err.status === 404
              ? '查無此票券（可能已轉讓而失效，請對方向購票人索取新連結）'
              : '網路錯誤，請再掃一次或改用手動查詢',
        });
      } finally {
        lastRef.current = ticketToken ? { token: ticketToken, at: Date.now() } : lastRef.current;
        handlingRef.current = false;
      }
    },
    [token, doCheckIn],
  );

  async function startCamera() {
    setCameraError(null);
    if (!videoRef.current) return;
    try {
      // Loaded only here, so the scanner never weighs down any other page.
      const QrScanner = (await import('qr-scanner')).default;
      if (!(await QrScanner.hasCamera())) {
        setCameraError('找不到相機，請改用下方手動查詢');
        return;
      }
      // Unhide the <video> BEFORE the scanner starts: qr-scanner treats a
      // video that's hidden at start() as "caller wants no preview" and pins
      // it to opacity 0 / 0×0 for good — it still decodes, but staff can't
      // see what they're aiming at.
      flushSync(() => setCameraOn(true));
      const scanner = new QrScanner(videoRef.current, (r) => handleDecoded(r.data), {
        preferredCamera: 'environment',
        maxScansPerSecond: 8,
        highlightScanRegion: true,
        returnDetailedScanResult: true,
      });
      scannerRef.current = scanner;
      await scanner.start();
    } catch (err) {
      scannerRef.current?.destroy();
      scannerRef.current = null;
      setCameraOn(false);
      const name = err instanceof DOMException ? err.name : String(err);
      setCameraError(
        name.includes('NotAllowed') || name.includes('Permission')
          ? '相機權限被拒絕。請到瀏覽器設定允許此網站使用相機，再重新整理'
          : '無法啟動相機，請改用下方手動查詢',
      );
    }
  }

  function stopCamera() {
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setCameraOn(false);
  }

  useEffect(() => () => scannerRef.current?.destroy(), []);

  async function undo(seat: CheckinSeat) {
    if (!token || !window.confirm(`確定要撤銷 ${holderLabel(seat.holder)} 的報到嗎？`)) return;
    setBusy(true);
    try {
      const updated = await api.checkinUndo(token, seat.id);
      setOutcome({ kind: 'seat', seat: updated });
      setResults((list) => list?.map((s) => (s.id === seat.id ? updated : s)) ?? list);
      refreshStats();
    } catch {
      setOutcome({ kind: 'message', text: '撤銷失敗，請再試一次' });
    } finally {
      setBusy(false);
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !query.trim()) return;
    setBusy(true);
    try {
      setResults(await api.checkinSearch(token, query.trim()));
    } catch {
      setResults(null);
      setOutcome({ kind: 'message', text: '查詢失敗，請檢查網路' });
    } finally {
      setBusy(false);
    }
  }

  function toggleQuick(next: boolean) {
    setQuickMode(next);
    try {
      localStorage.setItem(QUICK_MODE_KEY, next ? '1' : '0');
    } catch {
      /* per-device preference only */
    }
  }

  const described = outcome?.kind === 'seat' ? describe(outcome.seat, outcome.result) : null;

  return (
    <div className="page checkin-page">
      <div className="checkin-stats">
        <span>已報到</span>
        <strong>
          {stats ? `${stats.checkedIn} / ${stats.total}` : '— / —'}
        </strong>
      </div>

      <div className="checkin-camera">
        <video ref={videoRef} muted playsInline className={cameraOn ? '' : 'is-hidden'} />
        {cameraOn ? (
          <button className="link-button" onClick={stopCamera}>關閉相機</button>
        ) : (
          <button onClick={startCamera}>開始掃描</button>
        )}
        {cameraError && <p className="error">{cameraError}</p>}
        <label className="checkin-quick">
          <input type="checkbox" checked={quickMode} onChange={(e) => toggleQuick(e.target.checked)} />
          快速模式：掃到有效票券就直接報到（排隊很長時使用）
        </label>
      </div>

      {outcome && (
        <div className={`checkin-result ${outcome.kind === 'message' || !described?.ok ? 'is-bad' : 'is-good'}`} role="status">
          {outcome.kind === 'message' ? (
            <p className="checkin-verdict">{outcome.text}</p>
          ) : (
            <>
              <p className="checkin-verdict">{described!.text}</p>
              <p className="checkin-name">{holderLabel(outcome.seat.holder)}</p>
              <p className="hint">
                {outcome.seat.ticketTypeName}・第 {outcome.seat.seatIndex + 1} / {outcome.seat.seatCount} 位
              </p>
              <p className="hint">
                購票人 {outcome.seat.buyerEmail}・{outcome.seat.team}
              </p>
              <div className="button-row">
                {outcome.seat.status === 'VALID' && !outcome.result && (
                  <button disabled={busy} onClick={() => doCheckIn(outcome.seat)}>
                    {busy ? '處理中…' : '確認報到'}
                  </button>
                )}
                {outcome.seat.status === 'CHECKED_IN' && (
                  <button className="link-button" disabled={busy} onClick={() => undo(outcome.seat)}>
                    撤銷報到
                  </button>
                )}
              </div>
            </>
          )}
          <button className="link-button" onClick={() => setOutcome(null)}>
            下一位
          </button>
        </div>
      )}

      <form className="checkin-search" onSubmit={search}>
        <input
          placeholder="手動查詢：姓名、電話或 email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy}>查詢</button>
      </form>

      {results && (
        <div className="checkin-results">
          {results.length === 0 && <p className="hint">查無資料</p>}
          {results.map((seat) => (
            <div key={seat.id} className="checkin-row">
              <div>
                <div className="checkin-name">{holderLabel(seat.holder)}</div>
                <div className="hint">
                  {seat.ticketTypeName}・第 {seat.seatIndex + 1}/{seat.seatCount} 位・{seat.buyerEmail}
                </div>
                <div className={seat.status === 'VALID' ? 'hint' : seat.status === 'CHECKED_IN' ? 'success' : 'error'}>
                  {seat.status === 'CHECKED_IN' && seat.checkedInAt
                    ? `已報到 ${formatTaipei(seat.checkedInAt)}（${seat.checkedInBy ?? '—'}）`
                    : SEAT_STATUS_LABEL[seat.status]}
                </div>
              </div>
              {seat.status === 'VALID' && (
                <button disabled={busy} onClick={() => doCheckIn(seat)}>報到</button>
              )}
              {seat.status === 'CHECKED_IN' && (
                <button className="link-button" disabled={busy} onClick={() => undo(seat)}>撤銷</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
