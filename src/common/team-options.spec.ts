import { readFileSync } from 'fs';
import { join } from 'path';
import { TEAM_OPTIONS } from './team-options';

describe('TEAM_OPTIONS', () => {
  it('matches the frontend list exactly (same teams, same order)', () => {
    const src = readFileSync(
      join(__dirname, '../../frontend/src/constants.ts'),
      'utf8',
    );
    const frontend = [...src.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...TEAM_OPTIONS]).toEqual(frontend);
  });
});
