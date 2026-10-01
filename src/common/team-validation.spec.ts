import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from '../modules/user/dto/update-profile.dto';
import { UpdateRegistrantInfoDto } from '../modules/order/dto/update-registrant-info.dto';

const profile = (team: string) =>
  plainToInstance(UpdateProfileDto, { name: '王小明', team, lineId: 'x', phone: '0900' });

describe('team validation', () => {
  it('accepts a listed team', async () => {
    expect(await validate(profile('爾森'))).toHaveLength(0);
  });

  it.each(['米克', 'Cindy -靖禹先生', '', '其他 '])(
    'refuses %j on the profile',
    async (team) => {
      const errors = await validate(profile(team));
      expect(errors.map((e) => e.property)).toContain('team');
    },
  );

  it('refuses an unlisted team when editing an order', async () => {
    const dto = plainToInstance(UpdateRegistrantInfoDto, {
      registrantName: '王小明',
      registrantTeam: '米克',
      registrantLineId: 'x',
      registrantPhone: '0900',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('registrantTeam');
  });
});
