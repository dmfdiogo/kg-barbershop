import { describe, expect, it } from 'vitest';
import { formatCents, formatDuration } from '@/components/portal/format';

describe('formatação do catálogo', () => {
  it('formata centavos como moeda brasileira', () => {
    const normalize = (value: string) => value.replace(/\u00a0/g, ' ');
    expect(normalize(formatCents(5000))).toBe('R$ 50,00');
    expect(normalize(formatCents(4321))).toBe('R$ 43,21');
    expect(normalize(formatCents(0))).toBe('R$ 0,00');
  });

  it('formata duração em minutos e horas', () => {
    expect(formatDuration(15)).toBe('15 min');
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(125)).toBe('2 h 5 min');
  });
});
