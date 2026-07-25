import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import type { GroupMember } from '../order/types/group-member';
import type { Companion } from '../order/types/companion';
import { TRANSFER_ADMIN_NOTICE } from '../order/order.constants';

const FROM_ADDRESS =
  process.env.EMAIL_FROM ?? 'verify@mail.ts-annual-event.com';
/**
 * Where every ticket-transfer admin notice goes. The early-bird batch has
 * already closed and been manually reconciled into a spreadsheet — any
 * transfer after that point needs a human to fold it into that
 * reconciliation, so the admin team asked to be emailed on every transfer
 * rather than having to keep re-checking the app for new ones.
 */
const TRANSFER_ADMIN_EMAIL =
  process.env.TRANSFER_ADMIN_EMAIL ?? 'lucy98112226424@gmail.com';

/**
 * Every field below (name, LINE ID, meal preference, etc.) is user-supplied
 * and gets interpolated straight into an HTML email — escape it first so a
 * name like `<img src=x onerror=...>` can't inject markup into the
 * recipient's own inbox.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface OrderConfirmationDetails {
  orderId: string;
  ticketTypeName: string;
  quantity: number;
  totalAmount: number;
  registrantName: string;
  registrantTeam: string;
  registrantLineId: string;
  registrantPhone: string;
  mealPreference: string;
  groupLeaderName: string | null;
  groupLeaderLineId: string | null;
  groupLeaderPhone: string | null;
  groupMembers: GroupMember[] | null;
  companions: Companion[] | null;
  buyingForFamily: boolean;
  /** Survey only: 0 means no child seat needed. */
  childSeatCount: number;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  async sendVerificationCode(email: string, code: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — skipping send, verification code for ${email} is ${code}`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: '【TS年度盛會】註冊驗證碼',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #222;">
          <h2>歡迎註冊 TS年度盛會 搶票系統</h2>
          <p>您的註冊驗證碼是：</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>
          <p>驗證碼將於 10 分鐘後失效。若非您本人操作，請忽略此信。</p>
        </div>
      `,
    });

    if (error) {
      this.logger.error(
        `Failed to send verification email to ${email}: ${error.message}`,
      );
      throw new Error('Failed to send verification email');
    }
  }

  async sendOrderConfirmation(
    email: string,
    d: OrderConfirmationDetails,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — skipping order confirmation email for ${email} (order ${d.orderId})`,
      );
      return;
    }

    const groupSection = d.groupMembers
      ? `
        <h3>團體票資訊</h3>
        <p>主揪：${escapeHtml(d.groupLeaderName ?? '')}（LINE：${escapeHtml(d.groupLeaderLineId ?? '')}，電話：${escapeHtml(d.groupLeaderPhone ?? '')}）</p>
        <p>其餘成員名單：</p>
        <ul>
          ${d.groupMembers
            .map(
              (m, i) =>
                `<li>${i + 1}. ${escapeHtml(m.name) || '（未填寫）'} — 聯絡方式：${escapeHtml(m.contact) || '（未填寫）'}，用餐需求：${escapeHtml(m.mealPreference) || '（未填寫）'}</li>`,
            )
            .join('')}
        </ul>
      `
      : '';

    const companionsSection = d.companions
      ? `
        <h3>${d.buyingForFamily ? '代訂親友資訊' : '同行親友資訊'}</h3>
        <ul>
          ${d.companions
            .map(
              (c, i) =>
                `<li>第 ${i + (d.buyingForFamily ? 1 : 2)} 張 — ${escapeHtml(c.name) || '（未填寫）'}（${escapeHtml(c.relationship)}）用餐需求：${escapeHtml(c.mealPreference) || '（未填寫）'}，備註：${escapeHtml(c.note) || '（未填寫）'}</li>`,
            )
            .join('')}
        </ul>
      `
      : '';

    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: '【TS年度盛會】訂票成功確認',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #222;">
          <h2>訂票成功！</h2>
          <p>您的付款已確認，以下是訂單詳情：</p>
          <table style="border-collapse: collapse;">
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">訂單編號</td><td>${escapeHtml(d.orderId)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">票種</td><td>${escapeHtml(d.ticketTypeName)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">張數</td><td>${d.quantity}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">總金額</td><td>NT$ ${d.totalAmount.toLocaleString()}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">姓名</td><td>${escapeHtml(d.registrantName)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">所屬系統/團隊</td><td>${escapeHtml(d.registrantTeam)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">LINE ID</td><td>${escapeHtml(d.registrantLineId)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">電話</td><td>${escapeHtml(d.registrantPhone)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">用餐需求</td><td>${escapeHtml(d.mealPreference)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">兒童座椅需求</td><td>${d.childSeatCount > 0 ? `${d.childSeatCount} 張` : '無需求'}</td></tr>
          </table>
          ${groupSection}
          ${companionsSection}
          <p style="margin-top: 24px; color: #666;">請妥善保留此信作為訂票證明。</p>
        </div>
      `,
    });

    if (error) {
      this.logger.error(
        `Failed to send order confirmation to ${email} for order ${d.orderId}: ${error.message}`,
      );
    }
  }

  async sendTransferInvite(
    email: string,
    d: { ticketTypeName: string; fromEmail: string },
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — skipping transfer invite email for ${email}`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: '【TS年度盛會】您收到一筆票券轉讓邀請',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #222;">
          <h2>票券轉讓邀請</h2>
          <p>${escapeHtml(d.fromEmail)} 想將一張「${escapeHtml(d.ticketTypeName)}」轉讓給您。</p>
          <p>請登入系統，至「我的票卷」頁面查看並選擇接受或拒絕此邀請。</p>
          <p style="margin-top: 16px; padding: 12px; background: #fff8e1; border-left: 4px solid #f5a623; color: #7a5c00;">${escapeHtml(TRANSFER_ADMIN_NOTICE)}</p>
        </div>
      `,
    });

    if (error) {
      this.logger.error(
        `Failed to send transfer invite email to ${email}: ${error.message}`,
      );
    }
  }

  async sendTransferSentNotice(
    email: string,
    d: { ticketTypeName: string; toEmail: string },
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — skipping transfer sent notice email for ${email}`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: '【TS年度盛會】您已送出一筆票券轉讓邀請',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #222;">
          <h2>轉讓邀請已送出</h2>
          <p>您將一張「${escapeHtml(d.ticketTypeName)}」轉讓給 ${escapeHtml(d.toEmail)} 的邀請已送出，等待對方確認。</p>
          <p style="margin-top: 16px; padding: 12px; background: #fff8e1; border-left: 4px solid #f5a623; color: #7a5c00;">${escapeHtml(TRANSFER_ADMIN_NOTICE)}</p>
        </div>
      `,
    });

    if (error) {
      this.logger.error(
        `Failed to send transfer sent notice email to ${email}: ${error.message}`,
      );
    }
  }

  /**
   * Notifies the admin team every time a transfer is actually completed
   * (the recipient accepted, so Order.userId changed) — the early-bird
   * batch has already closed and been manually reconciled into a
   * spreadsheet, so any transfer after that point needs a human to fold it
   * in, and the admin team asked to be emailed rather than having to keep
   * re-checking the app for new ones.
   */
  async sendTransferAdminNotice(d: {
    fromName: string;
    toName: string;
    mealPreference: string;
    buyingForFamily: boolean;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        'RESEND_API_KEY not set — skipping transfer admin notice email',
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to: TRANSFER_ADMIN_EMAIL,
      subject: '【TS年度盛會】票券轉讓通知',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #222;">
          <h2>📝轉讓表格📝</h2>
          <p>・轉讓者姓名：${escapeHtml(d.fromName)}</p>
          <p>・受讓者姓名：${escapeHtml(d.toName)}</p>
          <p>・葷／素：${escapeHtml(d.mealPreference)}</p>
          <p>・夥伴／親友：${d.buyingForFamily ? '親友' : '夥伴'}</p>
        </div>
      `,
    });

    if (error) {
      this.logger.error(
        `Failed to send transfer admin notice email: ${error.message}`,
      );
    }
  }
}
