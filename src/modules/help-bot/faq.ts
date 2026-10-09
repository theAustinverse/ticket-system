import { REFUND_CUTOFF_DAYS } from '../order/order.constants';
import {
  MAX_PENDING_PER_USER,
  SPONSOR_MAX_AMOUNT,
  SPONSOR_MIN_AMOUNT,
  SPONSOR_PRESETS,
} from '../sponsorship/sponsorship.constants';

/**
 * What the help bot is allowed to know. Every answer here is a statement about
 * how the *system* works (the same material as the guided tour), never about a
 * particular user's order — the bot has no access to anyone's data, by design,
 * so there is nothing it can leak and nothing it can promise on the system's
 * behalf. Anything not covered goes to the admin.
 *
 * Keep entries factual and in step with the product: a wrong FAQ answer is
 * worse than an escalation. `keywords` drive the no-AI fallback matcher.
 */
export interface FaqEntry {
  q: string;
  a: string;
  keywords: string[];
}

export const FAQ: FaqEntry[] = [
  {
    q: '怎麼搶票？購票流程是什麼？',
    a: '開賣時間一到，到活動頁點票種旁的「搶票」按鈕 → 填報名資料 → 進入排隊室依序放行 → 被放行後確認訂單並送出，訂單即成立。想先熟悉流程，可以在首頁開啟導覽。',
    keywords: ['搶票', '購票', '買票', '怎麼買', '流程', '報名'],
  },
  {
    q: '排隊室可以重新整理或關掉頁面嗎？',
    a: '請不要關閉或重新整理排隊頁面，否則會重新排隊。系統會依先後順序自動放行，耐心等待即可。',
    keywords: ['排隊', '重新整理', '順位', '放行', '卡住'],
  },
  {
    q: '需要線上付款嗎？票款怎麼繳？',
    a: '系統本身不需要線上付款，送出訂單即成立。票款統一繳交給領導人；任何人以任何其他形式收費都是詐騙，請小心。',
    keywords: ['付款', '繳費', '票款', '收費', '匯款', '轉帳', '詐騙', '付錢'],
  },
  {
    q: '在哪裡看我買的票？',
    a: '登入後點上方的「我的票券」，所有訂單、狀態、入場 QR Code 都在那裡。',
    keywords: ['我的票券', '看票', '票在哪', '訂單', 'QR', 'qr', '入場'],
  },
  {
    q: '怎麼退票？',
    a: `在「我的票券」點該訂單的「退票」。自助退票的截止時間是活動開始前 ${REFUND_CUTOFF_DAYS} 天，之後無法自行退票。釋出的票會回到票池供他人搶購。`,
    keywords: ['退票', '取消', '退費', '不去了'],
  },
  {
    q: '無法出席，可以把票轉讓給朋友嗎？',
    a: '可以。在「我的票券」點「轉讓給朋友」並輸入對方的 Email，對方會在自己的「我的票券」收到邀請，接受後票券才會改由對方持有。對方確認前，你可以隨時取消轉讓。轉讓後原本的入場 QR Code 會失效，對方會拿到新的。',
    keywords: ['轉讓', '轉給', '送給', '讓給', '給朋友', '換人'],
  },
  {
    q: '我只能買一張嗎？幫親友代訂怎麼買？',
    a: '每個帳號只能有一個「本人」的座位。若要多買，請在購買時勾選「代訂親友」，並填入親友本人的姓名（不能填自己的名字、也不能重複）。單人票可一次買多張，下方會出現對應數量的親友資料欄位。',
    keywords: ['一張', '多張', '代訂', '親友', '幫朋友買', '買兩張', '限購', '一人一張'],
  },
  {
    q: '團體票怎麼買？團員名單可以改嗎？',
    a: '團體早鳥票需要先輸入通行碼才能進入購買。購買後可在「我的票券」的訂單卡片內補填或修改團員名單，每位團員要標示為「夥伴」或「親友」；親友需選擇是哪位夥伴（或領導人）的親友。',
    keywords: ['團體', '團員', '通行碼', '領導人', '主揪', '夥伴', '名單'],
  },
  {
    q: '兒童座椅要收費嗎？',
    a: '兒童座椅只是需求調查，不另外收費。需要的話在報名資料的下拉選單選數量，沒有需求就保持「無需求」。',
    keywords: ['兒童', '座椅', '小孩', '小朋友', '嬰兒'],
  },
  {
    q: '個人資料（姓名、體系、LINE ID、電話）在哪改？',
    a: '登入後點上方的「個人設定」維護姓名、所屬體系、LINE ID 與聯絡電話，購票時會自動帶入。要進排隊室前這幾項都必須填好。',
    keywords: ['個人設定', '修改資料', '改名', '體系', 'LINE ID', '電話', '個資'],
  },
  {
    q: '訂單送出後可以修改資料嗎？',
    a: '可以在「我的票券」修改部分報名資料（例如團員名單、親友資料），但有各自的修改截止時間；若系統已不讓你修改，請把需求告訴我，我會轉給管理員處理。',
    keywords: ['修改', '更改', '改資料', '改名字', '填錯', '打錯', '錯字'],
  },
  {
    q: '忘記密碼怎麼辦？',
    a: '在登入頁選「忘記密碼」，輸入註冊用的 Email，系統會寄 6 位數驗證碼給你，輸入驗證碼後即可設定新密碼。',
    keywords: ['忘記密碼', '密碼', '登入不了', '重設'],
  },
  {
    q: '收不到驗證碼信怎麼辦？',
    a: '請先檢查垃圾信件匣，並確認 Email 沒有打錯。等待一兩分鐘後可以重新請求驗證碼。仍然收不到的話，請告訴我你的 Email，我會轉給管理員。',
    keywords: ['驗證碼', '收不到', '沒收到', '信件', 'email', 'Email'],
  },
  {
    q: '怎麼聯絡主辦單位／窗口？',
    a: '點上方的「聯絡我們」，有公開的聯絡窗口與官方 LINE。',
    keywords: ['聯絡', '窗口', '客服', 'LINE', '官方'],
  },
  {
    q: '小額贊助怎麼用？要怎麼付款？',
    a: `在首頁活動列表下方的「小額贊助」區塊操作（需先登入）：① 選金額（${SPONSOR_PRESETS.map((n) => `NT$${n}`).join('、')}，或自訂 NT$${SPONSOR_MIN_AMOUNT}–${SPONSOR_MAX_AMOUNT.toLocaleString()} 的整數）→ 點「我要贊助」；② 系統會給你一組 6 位數「對帳碼」和轉帳資訊，請照資訊自行轉帳，並且「轉帳備註一定要填這組對帳碼」，行政組才知道是你轉的；③ 轉完後在同一個畫面輸入對帳碼，點「我已轉帳，送出」，行政組就會收到通知，核對後確認。系統本身不會扣款，錢是你自己轉帳過去。`,
    keywords: ['贊助', '小額', '對帳碼', '贊助金額', '捐款', '支持'],
  },
  {
    q: '贊助選了金額但還沒轉帳／離開頁面了怎麼辦？',
    a: `不用擔心：回到首頁的「小額贊助」區塊，系統會把你尚未送出的那一筆和對帳碼顯示回來，直接繼續轉帳即可。每個帳號最多同時有 ${MAX_PENDING_PER_USER} 筆尚未完成的贊助，請先完成或等行政組核對後再新增。`,
    keywords: ['贊助', '對帳碼', '離開', '忘了', '找不到對帳碼', '還沒轉'],
  },
];
