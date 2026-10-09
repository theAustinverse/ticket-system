import { HelpQuestionStatus } from '../../generated/prisma/client';
import { HelpBotBrain, parseVerdict } from './help-bot.brain';
import { LOVE_REPLY, isLoveQuestion } from './faq';
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

  it('knows how small sponsorship works (the FAQ covers it, with the real amounts)', () => {
    const a = brain.matchKeywords('小額贊助要怎麼使用？').answer;
    expect(a).toContain('對帳碼');
    expect(a).toContain('NT$50');
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

describe('HelpBotBrain with Claude', () => {
  function brainWith(create: jest.Mock) {
    const brain = new HelpBotBrain() as any;
    brain.claude = { messages: { create } };
    return brain as HelpBotBrain;
  }
  const reply = (text: string, stop_reason = 'end_turn') => ({
    stop_reason,
    content: [{ type: 'text', text }],
  });

  it('returns the answer when Claude is confident', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(reply('{"confident":true,"answer":"點退票"}'));
    const res = await brainWith(create).answer('怎麼退票');
    expect(res.answer).toBe('點退票');
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe('claude-haiku-5-5');
    expect(arg.system).toContain('知識庫');
    expect(arg.messages).toEqual([{ role: 'user', content: '怎麼退票' }]);
  });

  it('escalates when Claude is unsure, refuses, or is truncated', async () => {
    for (const r of [
      reply('{"confident":false,"answer":""}'),
      reply('{"confident":true,"answer":"x"}', 'refusal'),
      reply('{"confident":true,"answer":"x"}', 'max_tokens'),
    ]) {
      expect((await brainWith(jest.fn().mockResolvedValue(r)).answer('q')).answer).toBeNull();
    }
  });

  it('falls back to keyword matching when the API call throws', async () => {
    const res = await brainWith(jest.fn().mockRejectedValue(new Error('down'))).answer('怎麼退票');
    expect(res.answer).toContain('退票');
    const none = await brainWith(jest.fn().mockRejectedValue(new Error('down'))).answer('今天天氣');
    expect(none.answer).toBeNull();
  });
});

describe('relationship questions', () => {
  it('get the fixed reply without calling any model', async () => {
    const create = jest.fn();
    const brain = new HelpBotBrain() as any;
    brain.claude = { messages: { create } };
    const res = await (brain as HelpBotBrain).answer('我暗戀一個人，要怎麼告白？');
    expect(res.answer).toBe('去問月老，別煩我好嘛！？');
    expect(res.answer).toBe(LOVE_REPLY);
    expect(create).not.toHaveBeenCalled();
  });

  it('are recognised, but ordinary ticket questions mentioning a partner are not', () => {
    expect(isLoveQuestion('感情問題可以問嗎')).toBe(true);
    expect(isLoveQuestion('我想幫男友買票')).toBe(false);
    expect(isLoveQuestion('另一半可以轉讓票券嗎')).toBe(false);
    expect(isLoveQuestion('怎麼退票')).toBe(false);
  });

  it('is stored as answered by the bot, so the admin is NOT emailed', async () => {
    const prisma: any = {
      helpQuestion: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'q', adminReply: null, repliedAt: null, createdAt: new Date(), ...data })),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ name: '小明', email: 'a@b.c' }) },
    };
    const email = { sendHelpEscalationNotice: jest.fn() };
    const svc = new HelpBotService(prisma, new HelpBotBrain(), email as any);
    const res: any = await svc.ask('u1', '請問我的感情什麼時候有結果');
    expect(res.item.answer).toBe(LOVE_REPLY);
    expect(res.item.status).toBe('BOT_ANSWERED');
    expect(email.sendHelpEscalationNotice).not.toHaveBeenCalled();
  });
});
