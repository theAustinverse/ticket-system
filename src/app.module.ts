import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EventModule } from './modules/event/event.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { QueueRoomModule } from './modules/queue-room/queue-room.module';
import { OrderModule } from './modules/order/order.module';
import { AuthModule } from './modules/auth/auth.module';
import { AntiBotModule } from './modules/anti-bot/anti-bot.module';
import { UserModule } from './modules/user/user.module';
import { AdminModule } from './modules/admin/admin.module';
import { ChatModule } from './modules/chat/chat.module';
import { AiImageModule } from './modules/ai-image/ai-image.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    EventModule,
    InventoryModule,
    QueueRoomModule,
    OrderModule,
    AuthModule,
    AntiBotModule,
    UserModule,
    AdminModule,
    ChatModule,
    AiImageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
