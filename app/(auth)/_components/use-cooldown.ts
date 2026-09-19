'use client';

import { useEffect, useState } from 'react';

/**
 * Contador de cooldown de reenvio (F1.2). O valor é reiniciado a partir do
 * `retryAfterSeconds` que a server action devolve — nunca é o cliente que
 * decide quando pode reenviar, só quem mostra o tempo.
 */
export function useCooldown(initialSeconds: number) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => {
      setSeconds((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  return { seconds, setSeconds };
}

export function formatCooldown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
