/**
 * Faithful, non-interactive replicas of the four purchase-flow pages that
 * can't be reached before the sale opens (they need real queue/order state).
 * They reuse the real pages' CSS classes so they look identical, and carry
 * data-tour anchors the tour highlights. Rendering these here means the
 * tutorial never has to touch — or risk — the real purchase-flow code.
 */

export type SimScreen = 'registration' | 'queue' | 'order' | 'mytickets';

export function RegistrationScreen() {
  return (
    <div className="page page-narrow tour-sim-page">
      <h1>報名資料</h1>
      <p className="hint">請填寫真實資料，將作為入場核對依據。</p>
      <div className="form">
        <label className="checkbox-label" data-tour="reg-family">
          <input type="checkbox" readOnly /> 自己已是團體票成員（以下為幫親友代訂）
        </label>

        <div data-tour="reg-personal">
          <label>
            姓名
            <input value="王小明" readOnly />
          </label>
          <label>
            所屬體系
            <input value="德興體系" readOnly />
          </label>
          <label>
            LINE ID
            <input value="ming0716" readOnly />
          </label>
          <label>
            聯絡電話
            <input value="0912345678" readOnly />
          </label>
          <label>
            用餐習慣
            <input value="葷食" readOnly />
          </label>
        </div>

        <div data-tour="reg-quantity">
          <h2>張數</h2>
          <label>
            本次購買張數
            <select value="2" disabled>
              <option>2</option>
            </select>
          </label>
        </div>

        <div className="group-member-block" data-tour="reg-companion">
          <p className="hint">第 2 張 · 親友資料</p>
          <label>
            姓名
            <input value="王大明" readOnly />
          </label>
          <label>
            關係
            <select value="兄弟姊妹" disabled>
              <option>兄弟姊妹</option>
            </select>
          </label>
          <label>
            用餐習慣
            <input value="素食" readOnly />
          </label>
        </div>

        <label data-tour="reg-childseat">
          兒童座椅需求（僅調查用，不另外收費）
          <select value="0" disabled>
            <option value="0">無需求</option>
          </select>
        </label>

        <button type="button" data-tour="reg-submit">
          下一步：進入排隊室
        </button>
      </div>
    </div>
  );
}

export function QueueScreen() {
  return (
    <div className="page page-narrow tour-sim-page">
      <h1>候位中</h1>
      <div className="queue-stage" data-tour="queue-seal">
        <div className="queue-seal">
          <p className="queue-position">第 3 位</p>
        </div>
        <p className="queue-caption">今晚只對自己人，請不要關閉此頁面</p>
      </div>
    </div>
  );
}

export function OrderScreen() {
  return (
    <div className="page page-narrow tour-sim-page">
      <h1>確認訂單</h1>
      <div data-tour="order-summary">
        <p>
          <strong>單人早鳥票</strong> · 第一波
        </p>
        <p className="hint">NT$ 2,200 × 2 張 = NT$ 4,400</p>
      </div>

      <div data-tour="order-review">
        <h2>報名資料</h2>
        <p className="hint">姓名：王小明</p>
        <p className="hint">所屬體系：德興體系</p>
        <p className="hint">LINE ID：ming0716</p>
        <p className="hint">聯絡電話：0912345678</p>
        <p className="hint">兒童座椅需求：0 張（僅調查用，不另外收費）</p>
      </div>

      <button type="button" data-tour="order-submit">
        確認送出訂單
      </button>
    </div>
  );
}

export function MyTicketsScreen() {
  return (
    <div className="page tour-sim-page">
      <h1>我的票卷</h1>
      <div className="my-ticket-list">
        <div className="my-ticket-card" data-tour="ticket-card">
          <h2>單人早鳥票</h2>
          <p className="hint">訂單編號：TS-2026-000123</p>
          <p className="hint">數量：2 張 · NT$ 4,400</p>
          <p>
            狀態：<span className="badge" data-tour="ticket-status">已成立</span>
          </p>
          <p className="hint" data-tour="ticket-refund-note">
            退票截止：2026/10/24 23:59 前可自行退票
          </p>
          <button type="button" className="danger-button" data-tour="ticket-refund">
            退票
          </button>
          <div className="ticket-transfer-block" data-tour="ticket-transfer">
            <button type="button">轉讓給朋友</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SimScreenView({ screen }: { screen: SimScreen }) {
  switch (screen) {
    case 'registration':
      return <RegistrationScreen />;
    case 'queue':
      return <QueueScreen />;
    case 'order':
      return <OrderScreen />;
    case 'mytickets':
      return <MyTicketsScreen />;
  }
}
