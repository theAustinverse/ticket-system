import { HelpQuestionStatus } from '../../generated/prisma/client';
import { HelpBotBrain, parseVerdict } from './help-bot.brain';
import {
  HelpBotService,
  MAX_QUESTIONS_PER_DAY,
} from './help-bot.service';

describe('HelpBotService', () => {
  let prisma: any;
  let brain: { answer: jest.Mock };
  let email: { sendHelpEscalationNotice: jest.Mock };
  let service: HelpBotService;

  beforeEach(() => {
    prisma = {
      helpQuestion: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'q1',
          adminReply: null,
          repliedAt: null,
          createdAt: new Date(),
          ...data,
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'q1', ...data })),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ name: '小明', email: 'a@b.c' }),
      },
    };
    brain = { answer: jest.fn() };
    email = { sendHelpEscalationNotice: jest.fn().mockResolvedValue(undefined) };
    service = new HelpBotService(prisma, brain as any, email as any);
  });

  it('stores a confident bot answer and does NOT email the admin', async () => {
    brain.answer.mockResolvedValue({ answer: '點退票即可' });
    const res: any = await service.ask('u1', ' 怎麼退票 ');
    expect(prisma.helpQuestion.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        askerName: '小明',
        question: '怎麼退票',
        botAnswer: '點退票即可',
        status: HelpQuestionStatus.BOT_ANSWERED,
      },
    });
    expect(email.sendHelpEscalationNotice).not.toHaveBeenCalled();
    expect(res.item.answer).toBe('點退票即可');
    expect(res.item.answeredBy).toBe('BOT');
  });

  it('escalates when unsure: saves ESCALATED and emails the admin the question', async () => {
    brain.answer.mockResolvedValue({ answer: null });
    const res: any = await service.ask('u1', '我的訂單為什麼不見了');
    expect(prisma.helpQuestion.create.mock.calls[0][0].data).toMatchObject({
      status: HelpQuestionStatus.ESCALATED,
      botAnswer: null,
    });
    expect(email.sendHelpEscalationNotice).toHaveBeenCalledWith({
      askerName: '小明',
      askerEmail: 'a@b.c',
      question: '我的訂單為什麼不見了',
    });
    expect(res.item.answer).toBeNull();
    expect(res.item.status).toBe(HelpQuestionStatus.ESCALATED);
  });

  it('still succeeds when the escalation email throws', async () => {
    brain.answer.mockResolvedValue({ answer: null });
    email.sendHelpEscalationNotice.mockRejectedValue(new Error('smtp down'));
    const res: any = await service.ask('u1', '一個奇怪的問題');
    expect(res.item.status).toBe(HelpQuestionStatus.ESCALATED);
  });

  it('refuses past the daily cap without calling the bot', async () => {
    prisma.helpQuestion.count.mockResolvedValue(MAX_QUESTIONS_PER_DAY);
    const res: any = await service.ask('u1', '再問一個');
    expect(res.tooMany).toBe(true);
    expect(brain.answer).not.toHaveBeenCalled();
    expect(prisma.helpQuestion.create).not.toHaveBeenCalled();
  });

  it("shows the admin's reply over the bot's, and marks who answered", async () => {
    prisma.helpQuestion.findMany.mockResolvedValue([
      {
        id: 'q1',
        question: 'x',
        botAnswer: null,
        adminReply: '已幫你處理',
        status: HelpQuestionStatus.ADMIN_ANSWERED,
        createdAt: new Date(),
        repliedAt: new Date(),
      },
    ]);
    const [item] = await service.listMine('u1');
    expect(item.answer).toBe('已幫你處理');
    expect(item.answeredBy).toBe('ADMIN');
    expect(prisma.helpQuestion.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('reply marks ADMIN_ANSWERED; unknown id is a 404', async () => {
    prisma.helpQuestion.findUnique.mockResolvedValue({ id: 'q1' });
    await service.reply('q1', ' 好了 ');
    expect(prisma.helpQuestion.update.mock.calls[0][0].data).toMatchObject({
      adminReply: '好了',
      status: HelpQuestionStatus.ADMIN_ANSWERED,
    });
    prisma.helpQuestion.findUnique.mockResolvedValue(null);
    await expect(service.reply('nope', 'x')).rejects.toThrow();
  });
});

describe('HelpBotBrain keyword fallback', () => {
  const brain = new HelpBotBrain();

  it('answers a clear FAQ question', () => {
    expect(brain.matchKeywords('請問怎麼退票？').answer).toContain('退票');
  });

  it('escalates when nothing matches', () => {
    expect(brain.matchKeywords('今天天氣如何').answer).toBeNull();
  });

  it('escalates on a tie between two topics', () => {
    expect(brain.matchKeywords('退票和轉讓').answer).toBeNull();
  });
});

describe('parseVerdict', () => {
  it('accepts a confident JSON answer, including fenced output', () => {
    expect(parseVerdict('{"confident":true,"answer":"好"}').answer).toBe('好');
    expect(parseVerdict('```json\n{"confident":true,"answer":"好"}\n```').answer).toBe('好');
  });
  it('treats unsure, empty, or garbage as escalate', () => {
    expect(parseVerdict('{"confident":false,"answer":""}').answer).toBeNull();
    expect(parseVerdict('{"confident":true,"answer":"  "}').answer).toBeNull();
    expect(parseVerdict('not json').answer).toBeNull();
  });
});
