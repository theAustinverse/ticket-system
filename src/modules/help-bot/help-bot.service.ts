import { Injectable, NotFoundException } from '@nestjs/common';
import { HelpQuestionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { HelpBotBrain } from './help-bot.brain';

/** Per-account cap on questions per day — the LLM call costs real money. */
export const MAX_QUESTIONS_PER_DAY = 30;

@Injectable()
export class HelpBotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brain: HelpBotBrain,
    private readonly email: EmailService,
  ) {}

  async ask(userId: string, question: string) {
    const text = question.trim();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const asked = await this.prisma.helpQuestion.count({
      where: { userId, createdAt: { gte: since } },
    });
    if (asked >= MAX_QUESTIONS_PER_DAY) {
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

    if (!answer) {
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
    const rows = await this.prisma.helpQuestion.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((r) => this.toUserView(r));
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
