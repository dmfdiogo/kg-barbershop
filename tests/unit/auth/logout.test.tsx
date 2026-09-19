import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LogoutButton } from '@/components/auth/LogoutButton';

const logoutAction = vi.fn(async () => {});
const replace = vi.fn();
const refresh = vi.fn();

vi.mock('@/lib/auth/actions', () => ({ logoutAction: () => logoutAction() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

/**
 * Encerrar a sessão.
 *
 * O produto passou sete fases com `logoutAction` escrita e nunca chamada: dava
 * para entrar e não dava para sair. Este teste existe para que a ação não volte
 * a ficar órfã — se alguém remover o botão da casca, alguma coisa quebra.
 */
describe('botão de sair', () => {
  it('encerra a sessão e leva para o destino, sem deixar a tela no histórico', async () => {
    render(<LogoutButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sair/i }));
    });

    expect(logoutAction).toHaveBeenCalledOnce();
    // `replace`, não `push`: voltar no navegador não pode reencenar a tela
    // autenticada a partir do cache do roteador.
    expect(replace).toHaveBeenCalledWith('/');
    expect(refresh).toHaveBeenCalled();
  });
});
