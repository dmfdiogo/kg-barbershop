import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * Smoke da infraestrutura de testes (tarefa F0.1): prova que Vitest, jsdom e
 * Testing Library estão de pé para as fases seguintes. Não testa produto.
 */
describe('infraestrutura de testes', () => {
  it('roda TypeScript', () => {
    const soma = (a: number, b: number) => a + b;
    expect(soma(2, 2)).toBe(4);
  });

  it('renderiza componente React no jsdom', () => {
    render(<button type="button">Agendar</button>);
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeInTheDocument();
  });
});
