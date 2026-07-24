import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const HISTORY_LIMIT = 50;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Oldest-first, capped at the last HISTORY_LIMIT posts — enough for the sticky-note wall's initial view. */
  async listRecent() {
    const messages = await this.prisma.chatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    return messages.reverse();
  }

  async createMessage(userId: string, authorName: string, content: string) {
    return this.prisma.chatMessage.create({
      data: { userId, authorName, content },
    });
  }

  async deleteMessage(id: string) {
    const existing = await this.prisma.chatMessage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Message ${id} not found`);
    await this.prisma.chatMessage.delete({ where: { id } });
  }
}
