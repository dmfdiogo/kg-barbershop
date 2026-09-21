import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Escolhe o primeiro horário livre, percorrendo os dias até achar um.
 *
 * POR QUE NÃO CLICAR NO DIA CORRENTE. O seed dá jornada de segunda a sábado; no
 * domingo a grade do dia nasce vazia e o teste falhava por calendário — a suíte
 * ficava vermelha um dia a cada sete, que é o jeito mais rápido de ensinar todo
 * mundo a ignorar o e2e. O mesmo vale para um profissional que folga numa
 * segunda: o dia existe, a grade não.
 *
 * Percorrer os dias também testa mais do que fixar um índice: o seletor de
 * datas passa a ser exercitado de verdade.
 */
export async function pickSlot(
  page: Page,
  which: 'first' | 'last' = 'first',
): Promise<Locator> {
  const days = page.locator('button[aria-pressed]');
  await expect(days.first()).toBeVisible();

  const total = await days.count();
  for (let i = 0; i < total; i += 1) {
    await days.nth(i).click();

    const slots = page.locator('ul.grid button');
    // Espera curta de propósito: a grade recarrega por dia, e um dia fechado
    // legitimamente não tem nada — esperar o timeout inteiro em cada um
    // deixaria o teste lento sem aumentar a confiança.
    try {
      await expect(slots.first()).toBeVisible({ timeout: 4000 });
    } catch {
      continue;
    }

    const slot = which === 'first' ? slots.first() : slots.last();
    await slot.click();
    return slot;
  }

  throw new Error(
    `Nenhum dia da grade tem horário livre (${total} dias verificados). ` +
      'Se isto falhar sempre, o problema é a jornada do seed, não o teste.',
  );
}
