import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { HelpQuestionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { HelpBotBrain } from './help-bot.brain';

/** Per-account cap on questions per day — the LLM call costs real money. */
export const MAX_QUESTIONS_PER_DAY = 30;

/**
 * Escalation emails per hour, across ALL users. Each one is a real email from
 * the same Resend account that sends registration and password-reset codes, so
 * a flood of "unsure" questions (from many throwaway accounts) must not be able
 * to use up that quota. Over the cap the question is still saved and listed on
 * /admin/help — only the notification is skipped.
 */
export const MAX_ESCALATION_EMAILS_PER_HOUR = 20;

@Injectable()
export class HelpBotService {
  private readonly logger = new Logger(HelpBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brain: HelpBotBrain,
    private readonly email: EmailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Counts this question against the account's daily allowance *before* the
   * model is called (atomic INCR). Counting rows afterwards let a burst of
   * simultaneous requests all see "0 asked" and each cost a model call.
   */
  private async withinDailyAllowance(userId: string): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `help-asked:${userId}:${day}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 26 * 60 * 60);
    return n <= MAX_QUESTIONS_PER_DAY;
  }

  /** True while the hourly escalation-email budget (shared by everyone) has room. */
  private async escalationEmailAllowed(): Promise<boolean> {
    const hour = new Date().toISOString().slice(0, 13);
    const key = `help-escalation-mails:${hour}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 2 * 60 * 60);
    return n <= MAX_ESCALATION_EMAILS_PER_HOUR;
  }

  async ask(userId: string, question: string) {
    const text = question.trim();

    if (!(await this.withinDailyAllowance(userId))) {
      return { tooMany: true as const };
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const askerName = user?.name?.trim() || user?.email || '使用者';

    const { answer } = await this.brain.answer(text);

    const record = await this.prisma.helpQuestion.create({
      data: {
        userId,
        askerName,
        question: text,
        botAnswer: answer,
        status: answer
          ? HelpQuestionStatus.BOT_ANSWERED
          : HelpQuestionStatus.ESCALATED,
      },
    });

    if (!answer && !(await this.escalationEmailAllowed().catch(() => true))) {
      this.logger.warn(
        'Escalation email budget for this hour is used up — the question is saved on /admin/help but no email was sent',
      );
    } else if (!answer) {
      // Best-effort: the question is saved and visible in the admin list
      // either way, so a mail failure must not fail the asker's request.
      await this.email
        .sendHelpEscalationNotice({
          askerName,
          askerEmail: user?.email ?? '',
          question: text,
        })
        .catch(() => {});
    }

    return { tooMany: false as const, item: this.toUserView(record) };
  }

  async listMine(userId: string) {
    // Newest 100, shown oldest-first. (Taking the oldest 100 would hide every
    // new question and reply once an account had asked more than 100.)
    const rows = await this.prisma.helpQuestion.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.reverse().map((r) => this.toUserView(r));
  }

  // ---- admin ----

  listForAdmin(status?: HelpQuestionStatus) {
    return this.prisma.helpQuestion.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { user: { select: { email: true } } },
    });
  }

  async reply(id: string, reply: string) {
    const existing = await this.prisma.helpQuestion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('找不到這個問題');
    return this.prisma.helpQuestion.update({
      where: { id },
      data: {
        adminReply: reply.trim(),
        repliedAt: new Date(),
        status: HelpQuestionStatus.ADMIN_ANSWERED,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.helpQuestion.deleteMany({ where: { id } });
    return { deleted: true };
  }

  private toUserView(r: {
    id: string;
    question: string;
    botAnswer: string | null;
    adminReply: string | null;
    status: HelpQuestionStatus;
    createdAt: Date;
    repliedAt: Date | null;
  }) {
    return {
      id: r.id,
      question: r.question,
      status: r.status,
      // The asker sees the admin's reply if there is one, else the bot's.
      answer: r.adminReply ?? r.botAnswer ?? null,
      answeredBy:
        r.status === HelpQuestionStatus.ADMIN_ANSWERED
          ? ('ADMIN' as const)
          : r.status === HelpQuestionStatus.BOT_ANSWERED
            ? ('BOT' as const)
            : null,
      createdAt: r.createdAt,
      repliedAt: r.repliedAt,
    };
  }
}
