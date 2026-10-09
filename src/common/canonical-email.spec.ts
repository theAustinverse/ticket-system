import { canonicalEmail } from './canonical-email';

describe('canonicalEmail', () => {
  it('collapses every spelling of one Gmail inbox to the same key', () => {
    const same = [
      'john.smith@gmail.com',
      'johnsmith@gmail.com',
      'j.o.h.n.s.m.i.t.h@gmail.com',
      'johnsmith+tickets@gmail.com',
      'john.smith+a+b@gmail.com',
      'JohnSmith@GMAIL.com',
      '  johnsmith@gmail.com ',
      'johnsmith@googlemail.com',
    ].map(canonicalEmail);
    expect(new Set(same)).toEqual(new Set(['johnsmith@gmail.com']));
  });

  it('keeps different inboxes different', () => {
    expect(canonicalEmail('john.smith@gmail.com')).not.toBe(canonicalEmail('john.smyth@gmail.com'));
    expect(canonicalEmail('a@gmail.com')).not.toBe(canonicalEmail('b@gmail.com'));
  });

  it('only trims and lowercases other domains (their alias rules are not universal)', () => {
    expect(canonicalEmail('First.Last+x@Example.com')).toBe('first.last+x@example.com');
  });

  it('does not collapse a degenerate local part to an empty one', () => {
    expect(canonicalEmail('+tag@gmail.com')).toBe('+tag@gmail.com');
    expect(canonicalEmail('...@gmail.com')).toBe('...@gmail.com');
  });
});
