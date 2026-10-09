import { readFileSync } from 'fs';
import { join } from 'path';
import { TEAM_OPTIONS } from './team-options';

describe('TEAM_OPTIONS', () => {
  it('matches the frontend list exactly (same teams, same order)', () => {
    const src = readFileSync(
      join(__dirname, '../../frontend/src/constants.ts'),
      'utf8',
    );
    // Only the TEAM_OPTIONS array: the file also holds other constants
    // (e.g. OFFICIAL_LINE_URL) that must not be mistaken for teams.
    const list = src.match(/TEAM_OPTIONS[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const frontend = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...TEAM_OPTIONS]).toEqual(frontend);
  });
});
