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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
