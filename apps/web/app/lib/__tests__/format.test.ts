import { formatPrice, formatDate, formatDuration } from '../mappers/format';

describe('formatPrice', () => {
  it('formats single price', () => {
    expect(formatPrice(3500)).toBe('3 500 ₽');
  });

  it('formats price range', () => {
    expect(formatPrice(2000, 3500)).toBe('2 000 – 3 500 ₽');
  });

  it('formats large numbers with spaces', () => {
    expect(formatPrice(10000)).toBe('10 000 ₽');
  });
});

describe('formatDate', () => {
  it('formats ISO date to readable form', () => {
    expect(formatDate('2026-05-20')).toBe('20 мая');
  });

  it('formats date with time', () => {
    expect(formatDate('2026-05-20T14:00:00')).toBe('20 мая');
  });
});

describe('formatDuration', () => {
  it('formats minutes to hours and minutes', () => {
    expect(formatDuration(90)).toBe('1 ч 30 мин');
  });

  it('formats exact hours', () => {
    expect(formatDuration(120)).toBe('2 ч');
  });

  it('formats under an hour', () => {
    expect(formatDuration(45)).toBe('45 мин');
  });
});
