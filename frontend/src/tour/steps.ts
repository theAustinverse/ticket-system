import type { SimScreen } from './screens';

export type TourStep =
  | {
      kind: 'real';
      /** Route to be on for this step; the tour navigates here first. */
      route: string;
      /** Element to spotlight. If not found on the page, falls back to a centered card. */
      selector: string;
      title: string;
      body: string;
    }
  | {
      kind: 'sim';
      screen: SimScreen;
      /** Sub-element within the simulated screen to spotlight (data-tour anchor). */
      highlight?: string;
      title: string;
      body: string;
    }
  | { kind: 'center'; route?: string; title: string; body: string };

/**
 * The full buyer journey, in order. `eventId` (resolved when the tour starts)
 * is baked into the event-detail routes. Real-element steps live on the two
 * pages a visitor can browse before the sale opens; the rest are simulated.
 */
export function buildSteps(eventId: string | null): TourStep[] {
  const eventRoute = eventId ? `/events/${eventId}` : '/events';

  return [
    {
      kind: 'center',
      route: '/events',
      title: '歡迎使用 TS 搶票系統 🎫',
      body: '這份導覽會帶你走一遍完整的購票流程，從瀏覽活動到完成訂單，也會介紹贊助、聯絡窗口和客服小幫手。點「下一步」開始，隨時可按「跳過」離開。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.navbar-actions a[href="/my-tickets"]',
      title: '我的票券',
      body: '購票完成後，可以隨時從這裡查看你所有的票券、訂單狀態，以及辦理退票、轉讓。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.navbar-actions a[href="/profile"]',
      title: '個人設定',
      body: '在這裡維護你的姓名、所屬體系、LINE ID 與聯絡電話，購票時會自動帶入，省去重複填寫。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.navbar-actions a[href="/contact"]',
      title: '聯絡我們',
      body: '有問題想找人，點這裡看公開的聯絡窗口（姓名、LINE ID、Email），頁面上方還有「官方 LINE」可以一鍵加入。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.help-widget .chat-toggle',
      title: '客服小幫手',
      body: '右下角的 ❓ 可以詢問系統操作的問題（怎麼退票、怎麼轉讓、小額贊助怎麼用…）。小幫手答不出來的會轉給管理員，回覆後直接顯示在同一個視窗，只有你和管理員看得到。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.chat-widget:not(.help-widget) .chat-toggle',
      title: '心情便利貼',
      body: '這顆 💬 是公開留言板，大家都看得到你的留言，想說說心情或給建議可以在這裡留言。要問系統操作的問題，請用上面的客服小幫手。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.event-list a[href^="/events/"]',
      title: '活動卡片',
      body: '這是本次的年度盛會。點進活動卡片可以看到場次、地點、票種與開賣時間。我們現在就進去看看。',
    },
    {
      kind: 'real',
      route: '/events',
      selector: '.sponsor-box',
      title: '小額贊助',
      body: '想支持行政組，可以在活動列表下方選金額（或自訂），按「我要贊助」會拿到一組 6 位數對帳碼和轉帳資訊。請自行轉帳，備註務必填對帳碼，再回到這裡輸入對帳碼、按「我已轉帳，送出」。系統本身不會扣款。',
    },
    {
      kind: 'center',
      route: '/events',
      title: '更新日誌',
      body: '首頁最下方的「更新日誌」會列出最近 3 天新增的功能；有新功能時，進首頁也會跳出提示視窗，不會錯過。',
    },
    {
      kind: 'real',
      route: eventRoute,
      selector: '.countdown-block',
      title: '開賣倒數計時',
      body: '尚未開賣時，頁面上方會顯示距離開搶的倒數時鐘（時、分、秒）。時間一到就能開始搶票。',
    },
    {
      kind: 'real',
      route: eventRoute,
      selector: '.session-block h2',
      title: '場次與用餐地點',
      body: '登入後即可看到活動的場地與時間；點下方的地圖連結還能直接開啟 Google 地圖導航。',
    },
    {
      kind: 'real',
      route: eventRoute,
      selector: '.batch-block',
      title: '售票波次',
      body: '售票分為多個波次：早鳥票、一般票、最後席次票。每個波次有各自的開賣時間與價格，越早搶越優惠。',
    },
    {
      kind: 'real',
      route: eventRoute,
      selector: '.ticket-type-row',
      title: '票種資訊',
      body: '每一列是一種票：顯示名稱、價格，團體票還會標示「每次限購張數」。早鳥票分為單人票與團體套票。',
    },
    {
      kind: 'real',
      route: eventRoute,
      selector: '.ticket-type-action button',
      title: '搶票按鈕',
      body: '開賣後這顆按鈕會變成「搶票」，點下去就開始購票。團體早鳥票需要先輸入通行碼才能進入。接下來，我們模擬點下搶票之後的流程。',
    },
    {
      kind: 'sim',
      screen: 'registration',
      highlight: '[data-tour="reg-family"]',
      title: '① 報名資料 — 代訂親友',
      body: '每個帳號只能有一張「本人」的票。若你本人已經有票（例如是別人團體票的成員），只是幫親友代訂，請勾選這裡；勾選後系統會隱藏你自己的購票欄位，只填親友本人的姓名，不能填你自己的名字，也不能重複。',
    },
    {
      kind: 'sim',
      screen: 'registration',
      highlight: '[data-tour="reg-personal"]',
      title: '① 報名資料 — 個人資料',
      body: '填寫真實的姓名（僅限中文）、所屬系統/團隊、LINE ID、聯絡電話與用餐需求。這些會作為入場核對與餐點準備的依據。',
    },
    {
      kind: 'sim',
      screen: 'registration',
      highlight: '[data-tour="reg-quantity"]',
      title: '① 報名資料 — 購買張數',
      body: '單人票可一次購買多張（含自己）。選好張數後，下方會自動出現對應數量的親友資料欄位。',
    },
    {
      kind: 'sim',
      screen: 'registration',
      highlight: '[data-tour="reg-companion"]',
      title: '① 報名資料 — 親友資料',
      body: '為每一位同行親友填寫姓名（僅限中文）、與訂購人的關係、用餐需求，並在備註欄註明夥伴身份、所屬體系與聯絡方式，方便行政組查核。第 1 張就是上方你本人的資料，不需重複填。',
    },
    {
      kind: 'sim',
      screen: 'registration',
      highlight: '[data-tour="reg-childseat"]',
      title: '① 報名資料 — 兒童座椅',
      body: '如需兒童座椅，在這個下拉選單選擇數量（僅供調查，不另外收費）；沒有需求就保持「無需求」。',
    },
    {
      kind: 'sim',
      screen: 'registration',
      highlight: '[data-tour="reg-submit"]',
      title: '① 報名資料 — 進入排隊室',
      body: '資料填妥後，點「下一步：進入排隊室」。系統會帶你進入虛擬排隊室依序放行。',
    },
    {
      kind: 'sim',
      screen: 'group',
      highlight: '[data-tour="group-members"]',
      title: '① 團體票 — 成員名單',
      body: '買團體票時，由「主揪」一次填寫其餘成員的姓名、聯絡方式與用餐需求（主揪就是上面填的個人資料，不用重複填）。每位成員都要標示身分：「夥伴」，或「夥伴的親友」。',
    },
    {
      kind: 'sim',
      screen: 'group',
      highlight: '[data-tour="group-relative"]',
      title: '① 團體票 — 夥伴的親友',
      body: '選「夥伴的親友」時，還要選是哪一位夥伴（或主揪）的親友。票券上會顯示「○○的親友」，入場核對時一目了然。',
    },
    {
      kind: 'sim',
      screen: 'queue',
      highlight: '[data-tour="queue-seal"]',
      title: '② 排隊室 — 候位中',
      body: '這裡顯示你目前的排隊順位，系統會依先後順序自動放行。請耐心等待，切勿關閉或重新整理此頁面，否則會重新排隊。',
    },
    {
      kind: 'sim',
      screen: 'order',
      highlight: '[data-tour="order-summary"]',
      title: '③ 確認訂單 — 訂單摘要',
      body: '被放行後進入下單頁。這裡顯示你選的票種、單價與總金額，請再次確認。',
    },
    {
      kind: 'sim',
      screen: 'order',
      highlight: '[data-tour="order-review"]',
      title: '③ 確認訂單 — 報名資料確認',
      body: '送出前會列出你剛才填的所有報名資料，方便最後檢查是否正確。',
    },
    {
      kind: 'sim',
      screen: 'order',
      highlight: '[data-tour="order-submit"]',
      title: '③ 確認訂單 — 送出',
      body: '確認無誤後點「確認送出訂單」。送出即完成購票，訂單隨即成立（本系統無須線上付款）。',
    },
    {
      kind: 'sim',
      screen: 'mytickets',
      highlight: '[data-tour="ticket-card"]',
      title: '④ 我的票券 — 票券卡片',
      body: '完成後回到「我的票券」，每一筆訂單都會列在這裡，顯示票種、數量與金額。',
    },
    {
      kind: 'sim',
      screen: 'mytickets',
      highlight: '[data-tour="ticket-status"]',
      title: '④ 我的票券 — 訂單狀態',
      body: '狀態欄顯示訂單目前的情形（PAID 代表訂單已成立）。團體票還可在卡片內補填或修改團員名單，報名資料也能在截止前修改。',
    },
    {
      kind: 'sim',
      screen: 'mytickets',
      highlight: '[data-tour="ticket-refund"]',
      title: '④ 我的票券 — 退票',
      body: '活動前 7 天、且該波次還沒結束前，可自行點「退票」取消訂單；釋出的票會自動回到票池供他人搶購。過了期限就無法自行退票。',
    },
    {
      kind: 'sim',
      screen: 'mytickets',
      highlight: '[data-tour="ticket-transfer"]',
      title: '④ 我的票券 — 轉讓票券',
      body: '無法出席嗎？點「轉讓給朋友」並輸入對方已註冊的 Email，對方會在「我的票券」收到轉讓邀請，接受後票券才改為對方持有（原本的入場 QR Code 也會換新）；對方確認前，你都可以隨時取消轉讓。注意：第一波（早鳥）票券不開放轉讓，其餘波次也有轉讓截止時間。',
    },
    {
      kind: 'center',
      title: '導覽完成 🎉',
      body: '以上就是完整的購票流程！操作上有任何疑問，隨時點右下角的 ❓ 問客服小幫手。開賣時間一到，就能實際操作，祝你搶票順利，我們盛會見！',
    },
  ];
}
