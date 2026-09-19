import { describe, expect, it } from 'vitest';
import {
  validateInviteForm,
  validateStaffServices,
  validateTimeOffForm,
  validateWeeklySchedule,
} from '@/lib/staffing/validation';

/**
 * Validação da equipe (tarefa F2.2). O servidor não confia no cliente: a tela
 * valida, mas é aqui que se decide o que vai ao banco.
 */
const TZ = 'America/Sao_Paulo';

describe('convite', () => {
  it('aceita nome opcional e WhatsApp E.164', () => {
    const result = validateInviteForm({ name: 'Bruna Alencar', phone: '+5548999999999' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Bruna Alencar', phone: '+5548999999999' });
  });

  it('aceita convite apenas com telefone', () => {
    const result = validateInviteForm({ phone: '+5548999999999' });
    expect(result.ok).toBe(true);
  });

  it('recusa telefone sem DDI', () => {
    const result = validateInviteForm({ phone: '48999999999' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.phone).toBeDefined();
  });

  it('recusa nome de um caractere', () => {
    const result = validateInviteForm({ name: 'B', phone: '+5548999999999' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.name).toBeDefined();
  });
});

describe('jornada semanal', () => {
  it('aceita duas faixas no mesmo dia (almoço) e dia ausente (folga)', () => {
    const result = validateWeeklySchedule({
      schedule: [
        {
          weekday: 2,
          ranges: [
            { start: '10:00', end: '12:00' },
            { start: '13:00', end: '19:00' },
          ],
        },
        { weekday: 3, ranges: [] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { weekday: 2, ranges: [{ startMin: 600, endMin: 720 }, { startMin: 780, endMin: 1140 }] },
        { weekday: 3, ranges: [] },
      ]);
    }
  });

  it('recusa faixas sobrepostas no mesmo dia', () => {
    const result = validateWeeklySchedule({
      schedule: [{ weekday: 1, ranges: [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '18:00' }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('recusa fim antes do início', () => {
    const result = validateWeeklySchedule({
      schedule: [{ weekday: 1, ranges: [{ start: '18:00', end: '09:00' }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('recusa horário fora do formato', () => {
    const result = validateWeeklySchedule({
      schedule: [{ weekday: 1, ranges: [{ start: '9h', end: '18:00' }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('recusa weekday duplicado', () => {
    const result = validateWeeklySchedule({
      schedule: [
        { weekday: 1, ranges: [{ start: '09:00', end: '12:00' }] },
        { weekday: 1, ranges: [{ start: '13:00', end: '18:00' }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('recusa mais de quatro faixas no mesmo dia', () => {
    const result = validateWeeklySchedule({
      schedule: [{ weekday: 1, ranges: [{ start: '08:00', end: '09:00' }, { start: '10:00', end: '11:00' }, { start: '12:00', end: '13:00' }, { start: '14:00', end: '15:00' }, { start: '16:00', end: '17:00' }] }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('bloqueio pontual', () => {
  it('converte o relógio do tenant para instante UTC', () => {
    const result = validateTimeOffForm(
      { startsAtLocal: '2026-11-03T12:00', endsAtLocal: '2026-11-03T13:00', reason: 'Almoço' },
      TZ,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsAt.toISOString()).toBe('2026-11-03T15:00:00.000Z');
      expect(result.value.endsAt.toISOString()).toBe('2026-11-03T16:00:00.000Z');
    }
  });

  it('recusa fim antes do início', () => {
    const result = validateTimeOffForm(
      { startsAtLocal: '2026-11-03T13:00', endsAtLocal: '2026-11-03T12:00', reason: 'Almoço' },
      TZ,
    );
    expect(result.ok).toBe(false);
  });

  it('exige motivo', () => {
    const result = validateTimeOffForm(
      { startsAtLocal: '2026-11-03T12:00', endsAtLocal: '2026-11-03T13:00', reason: '' },
      TZ,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.reason).toBeDefined();
  });
});

describe('serviços do profissional', () => {
  it('normaliza ids e descarta vazios', () => {
    const result = validateStaffServices({ serviceIds: ['a', 'a', '', 'b'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.serviceIds).toEqual(['a', 'b']);
  });

  it('recusa valor que não é lista', () => {
    const result = validateStaffServices({ serviceIds: 'a' });
    expect(result.ok).toBe(false);
  });
});
