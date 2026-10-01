import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type {
  AdminSponsorship,
  AdminSponsorshipList,
  SponsorshipStatus,
} from '../api/types';

const STATUS_LABEL: Record<SponsorshipStatus, string> = {
  PENDING: '待核對',
  RECEIVED: '已收到',
  CANCELLED: '已取消',
};

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: AdminSponsorship[]) {
  const head = ['時間', '贊助者', 'Email', '金額', '對帳碼', '狀態', '轉帳回報時間', '確認時間'];
  const lines = rows.map((r) =>
    [
      new Date(r.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      r.donorName,
      r.donorEmail,
      r.amount,
      r.referenceCode,
      STATUS_LABEL[r.status],
      r.reportedAt
        ? new Date(r.reportedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
        : '',
      r.confirmedAt
        ? new Date(r.confirmedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
        : '',
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM so Excel opens the Chinese text as UTF-8.
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sponsorships.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminSponsorshipsPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminSponsorshipList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load(authToken: string) {
    return api
      .adminListSponsorships(authToken)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : '載入失敗'));
  }

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    load(token);
  }, [token, navigate]);

  async function setStatus(id: string, status: SponsorshipStatus) {
    if (!token) return;
    setBusyId(id);
    try {
      await api.adminUpdateSponsorship(token, id, status);
      await load(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更新失敗');
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <div className="page error">{error}</div>;
  if (!data) return <div className="page">載入中…</div>;

  const { totals, sponsorships } = data;
  return (
    <div className="page">
      <Link to="/admin/dashboard" className="link-button">
        ← 返回後台選單
      </Link>
      <h1>贊助管理</h1>
      <p>
        已收到 <strong>NT$ {totals.received.toLocaleString()}</strong>（{totals.receivedCount} 筆）｜
        待核對 NT$ {totals.pending.toLocaleString()}（{totals.pendingCount} 筆）
      </p>
      <p className="hint">
        贊助者自行轉帳，備註填對帳碼。「轉帳回報」是贊助者說自己已轉帳（尚未回報不代表沒轉）。對帳單上看到款項後，再按「標記已收到」；「已收到」才會計入金額。
      </p>
      <button type="button" onClick={() => exportCsv(sponsorships)} disabled={sponsorships.length === 0}>
        匯出 CSV
      </button>
      {sponsorships.length === 0 && <p>目前沒有贊助紀錄</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>贊助者</th>
              <th>金額</th>
              <th>對帳碼</th>
              <th>狀態</th>
              <th>轉帳回報</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sponsorships.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</td>
                <td>
                  {r.donorName}
                  <br />
                  <span className="hint">{r.donorEmail}</span>
                </td>
                <td>NT$ {r.amount.toLocaleString()}</td>
                <td>{r.referenceCode}</td>
                <td>{STATUS_LABEL[r.status]}</td>
                <td>
                  {r.reportedAt
                    ? new Date(r.reportedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
                    : '—'}
                </td>
                <td>
                  {r.status !== 'RECEIVED' && (
                    <button disabled={busyId === r.id} onClick={() => setStatus(r.id, 'RECEIVED')}>
                      標記已收到
                    </button>
                  )}{' '}
                  {r.status === 'PENDING' && (
                    <button disabled={busyId === r.id} onClick={() => setStatus(r.id, 'CANCELLED')}>
                      取消
                    </button>
                  )}
                  {r.status !== 'PENDING' && (
                    <button disabled={busyId === r.id} onClick={() => setStatus(r.id, 'PENDING')}>
                      退回待核對
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
