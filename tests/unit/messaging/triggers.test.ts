// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import {
  D1_OFFSET_MS,
  DEFAULT_QUIET_HOURS,
  H2_OFFSET_MS,
  adjustForQuietHours,
  endOfQuietHours,
  isWithinQuietHours,
  reminderScheduledFor,
  resolveTriggerPolicy,
  type QuietHours,
} from '@/lib/messaging/triggers';

/**
 * Regras puras dos gatilhos (tarefa F6.1): silêncio noturno no fuso do tenant,
 * antecedência mínima de D-1/H-2 e a configuração da janela.
 */

const TZ = 'America/Sao_Paulo';
const QUIET: QuietHours = DEFAULT_QUIET_HOURS; // 21h–8h

function local(date: Date): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd HH:mm');
}

describe('silêncio noturno no fuso do tenant', () => {
  it('reconhece a madrugada e a noite local, não a hora UTC', () => {
    // 04:00 e 22:00 locais são silêncio; 09:00 e 20:00 não.
    expect(isWithinQuietHours(new Date('2026-01-15T07:00:00Z'), TZ, QUIET)).toBe(true);
    expect(isWithinQuietHours(new Date('2026-01-16T01:00:00Z'), TZ, QUIET)).toBe(true);
    expect(isWithinQuietHours(new Date('2026-01-15T12:00:00Z'), TZ, QUIET)).toBe(false);
    expect(isWithinQuietHours(new Date('2026-01-15T23:00:00Z'), TZ, QUIET)).toBe(false);
  });

  it('calcula o fim do silêncio a partir da data local, virando o dia quando precisa', () => {
    // 22:00 local do dia 14 → libera 08:00 local do dia 15.
    expect(local(endOfQuietHours(new Date('2026-01-15T01:00:00Z'), TZ, QUIET))).toBe(
      '2026-01-15 08:00',
    );
    // 04:00 local do dia 15 → libera 08:00 local do mesmo dia.
    expect(local(endOfQuietHours(new Date('2026-01-15T07:00:00Z'), TZ, QUIET))).toBe(
      '2026-01-15 08:00',
    );
  });

  it('deixa passar o que não cai no silêncio', () => {
    const noon = new Date('2026-01-15T15:00:00Z'); // 12:00 local
    expect(adjustForQuietHours(noon, new Date('2026-01-16T15:00:00Z'), TZ, QUIET)).toEqual(noon);
  });

  it('empurra para o fim do silêncio quando ainda há tempo antes do atendimento', () => {
    // H-2 seria 07:00 local para um atendimento às 09:00: sai às 08:00.
    const appointment = new Date('2026-01-15T12:00:00Z'); // 09:00 local
    const scheduled = new Date('2026-01-15T10:00:00Z'); // 07:00 local
    const adjusted = adjustForQuietHours(scheduled, appointment, TZ, QUIET);
    expect(adjusted).not.toBeNull();
    expect(local(adjusted!)).toBe('2026-01-15 08:00');
  });

  it('descarta quando o fim do silêncio já é depois do atendimento (4h para as 6h)', () => {
    const appointment = new Date('2026-01-15T09:00:00Z'); // 06:00 local
    const scheduled = new Date('2026-01-15T07:00:00Z'); // 04:00 local
    expect(adjustForQuietHours(scheduled, appointment, TZ, QUIET)).toBeNull();
  });

  it('desligar a política não altera nada', () => {
    const scheduled = new Date('2026-01-15T07:00:00Z');
    expect(adjustForQuietHours(scheduled, new Date('2026-01-15T09:00:00Z'), TZ, null)).toEqual(
      scheduled,
    );
  });
});

describe('instante dos lembretes', () => {
  const startsAt = new Date('2026-11-03T13:00:00Z'); // 10:00 local

  it('24h e 2h antes são instantes absolutos, exibidos no horário local do tenant', () => {
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);
    const d1 = reminderScheduledFor(D1_OFFSET_MS, startsAt, now, TZ, null);
    const h2 = reminderScheduledFor(H2_OFFSET_MS, startsAt, now, TZ, null);

    expect(d1?.getTime()).toBe(startsAt.getTime() - D1_OFFSET_MS);
    expect(h2?.getTime()).toBe(startsAt.getTime() - H2_OFFSET_MS);
    expect(local(d1!)).toBe('2026-11-02 10:00');
    expect(local(h2!)).toBe('2026-11-03 08:00');
  });

  it('agendamento criado com menos de 24h não gera D-1', () => {
    const now = new Date(startsAt.getTime() - 3 * 3_600_000);
    expect(reminderScheduledFor(D1_OFFSET_MS, startsAt, now, TZ, null)).toBeNull();
    expect(reminderScheduledFor(H2_OFFSET_MS, startsAt, now, TZ, null)).not.toBeNull();
  });

  it('agendamento criado com menos de 2h não gera H-2', () => {
    const now = new Date(startsAt.getTime() - 1 * 3_600_000);
    expect(reminderScheduledFor(H2_OFFSET_MS, startsAt, now, TZ, null)).toBeNull();
    expect(reminderScheduledFor(D1_OFFSET_MS, startsAt, now, TZ, null)).toBeNull();
  });

  it('H-2 da madrugada é descartado quando o silêncio termina depois do atendimento', () => {
    const early = new Date('2026-11-03T09:00:00Z'); // 06:00 local
    const now = new Date(early.getTime() - 48 * 3_600_000);
    expect(reminderScheduledFor(H2_OFFSET_MS, early, now, TZ, QUIET)).toBeNull();
  });

  it('D-1 às 22h locais é empurrado para as 08h do dia anterior', () => {
    const late = new Date('2026-11-04T01:00:00Z'); // 22:00 local do dia 3
    const now = new Date(late.getTime() - 72 * 3_600_000);
    const d1 = reminderScheduledFor(D1_OFFSET_MS, late, now, TZ, QUIET);
    expect(d1).not.toBeNull();
    // 22:00 local do dia 2 cai no silêncio; sai às 08:00 locais do dia 2? Não:
    // o silêncio começa às 21h do dia 2 e termina às 08h do dia 3.
    expect(local(d1!)).toBe('2026-11-03 08:00');
  });
});

describe('configuração do silêncio', () => {
  it('sem variáveis usa o padrão 21h–8h', () => {
    expect(resolveTriggerPolicy({})).toEqual({ quietHours: DEFAULT_QUIET_HOURS });
  });

  it('respeita a janela das variáveis', () => {
    expect(
      resolveTriggerPolicy({
        NOTIFICATION_QUIET_START_HOUR: '22',
        NOTIFICATION_QUIET_END_HOUR: '7',
      }),
    ).toEqual({ quietHours: { startHour: 22, endHour: 7 } });
  });

  it('janela vazia (start === end) desliga o silêncio', () => {
    expect(
      resolveTriggerPolicy({
        NOTIFICATION_QUIET_START_HOUR: '0',
        NOTIFICATION_QUIET_END_HOUR: '0',
      }),
    ).toEqual({ quietHours: null });
  });

  it('configuração ambígua ou inválida cai no padrão (falha para o lado silencioso)', () => {
    expect(resolveTriggerPolicy({ NOTIFICATION_QUIET_START_HOUR: '22' })).toEqual({
      quietHours: DEFAULT_QUIET_HOURS,
    });
    expect(
      resolveTriggerPolicy({
        NOTIFICATION_QUIET_START_HOUR: '25',
        NOTIFICATION_QUIET_END_HOUR: '7',
      }),
    ).toEqual({ quietHours: DEFAULT_QUIET_HOURS });
  });
});
