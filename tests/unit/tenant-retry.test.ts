import { describe, expect, it, vi } from 'vitest';
import { runWithRetry } from '@/lib/tenant/retry';

describe('runWithRetry', () => {
  it('tem limite: tenta no máximo maxAttempts vezes e propaga o último erro', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('P2034'));

    await expect(
      runWithRetry(operation, { maxAttempts: 4, baseDelayMs: 0, isRetryable: () => true }),
    ).rejects.toThrow('P2034');

    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('não repete erro não retryable', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('nope'));

    await expect(
      runWithRetry(operation, { maxAttempts: 4, baseDelayMs: 0, isRetryable: () => false }),
    ).rejects.toThrow('nope');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retorna assim que a operação tem sucesso', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('P2034'))
      .mockResolvedValueOnce('ok');

    await expect(
      runWithRetry(operation, { maxAttempts: 4, baseDelayMs: 0, isRetryable: () => true }),
    ).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('recusa maxAttempts menor que 1', async () => {
    await expect(
      runWithRetry(() => Promise.resolve('ok'), { maxAttempts: 0, isRetryable: () => true }),
    ).rejects.toThrow('maxAttempts >= 1');
  });
});
