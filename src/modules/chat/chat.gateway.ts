import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from './chat.service';
import { corsOrigin } from '../../common/cors-origin';

const MAX_MESSAGES_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 10;

@Injectable()
@WebSocketGateway({ cors: { origin: corsOrigin } })
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Auth happens once at connection time (a socket.io handshake, not a
   * per-message HTTP request) — the client passes its existing JWT via
   * `auth.token`. An admin token (sub: 'admin', no real User row) can't
   * post here since there's no real identity to attribute the message to.
   */
  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify(token);
      if (!payload?.sub || payload.sub === 'admin') {
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub as string;
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { content?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.disconnect(true);
      return;
    }

    const content = (data?.content ?? '').trim();
    if (!content || content.length > 500) {
      client.emit('chat:error', '留言長度需為 1 到 500 字');
      return;
    }

    // Rate limit per connected user — not per-IP, since many users can
    // share a NAT/proxy IP and shouldn't be throttled together.
    const rateLimitKey = `chat-rate-limit:${userId}`;
    const count = await this.redis.incr(rateLimitKey);
    if (count === 1) {
      await this.redis.expire(rateLimitKey, RATE_WINDOW_SECONDS);
    }
    if (count > MAX_MESSAGES_PER_WINDOW) {
      client.emit('chat:error', '發言太頻繁了，請稍等一下再試');
      return;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      client.disconnect(true);
      return;
    }

    const authorName = user.name || user.email;
    const message = await this.chatService.createMessage(userId, authorName, content);
    this.server.emit('chat:new', message);
  }

  /** Called by AdminService after moderating a message, so every connected client removes it live. */
  broadcastDeletion(id: string) {
    if (!this.server) {
      this.logger.warn('Chat server not initialized yet — skipping broadcast');
      return;
    }
    this.server.emit('chat:deleted', { id });
  }
}
