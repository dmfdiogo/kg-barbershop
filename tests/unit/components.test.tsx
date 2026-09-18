import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CalendarView from '@/components/CalendarView';
import ConfirmationModal from '@/components/ConfirmationModal';
import DatePickerModal from '@/components/DatePickerModal';
import TimePickerModal from '@/components/TimePickerModal';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConfirmationModal', () => {
  it('não renderiza nada quando fechado', () => {
    render(
      <ConfirmationModal isOpen={false} onClose={() => {}} onConfirm={() => {}} title="X" message="Y" />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirma e fecha', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ConfirmationModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Excluir serviço"
        message="Não pode ser desfeito."
        confirmText="Excluir"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancelar fecha sem confirmar', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ConfirmationModal isOpen onClose={onClose} onConfirm={onConfirm} title="X" message="Y" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('TimePickerModal', () => {
  it('apresenta o slot no fuso do tenant, não no do navegador', () => {
    render(
      <TimePickerModal
        isOpen
        onClose={() => {}}
        onSelect={() => {}}
        slots={['2026-09-19T01:00:00.000Z']} // 22:00 em Brasília
        selectedSlot={null}
        timezone="America/Sao_Paulo"
      />,
    );

    expect(screen.getByRole('button', { name: '22:00' })).toBeInTheDocument();
  });

  it('devolve o slot selecionado em ISO UTC', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const slot = '2026-09-19T01:00:00.000Z';

    render(
      <TimePickerModal
        isOpen
        onClose={onClose}
        onSelect={onSelect}
        slots={[slot]}
        selectedSlot={null}
        timezone="America/Sao_Paulo"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '22:00' }));

    expect(onSelect).toHaveBeenCalledWith(slot);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mostra estado vazio sem slots', () => {
    render(
      <TimePickerModal
        isOpen
        onClose={() => {}}
        onSelect={() => {}}
        slots={[]}
        selectedSlot={null}
        timezone="America/Sao_Paulo"
      />,
    );

    expect(screen.getByText('Nenhum horário disponível para esta data.')).toBeInTheDocument();
  });
});

describe('DatePickerModal', () => {
  it('seleciona o dia no formato YYYY-MM-DD e desabilita o passado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 12, 0, 0)); // 18/09/2026, horário local

    const onSelect = vi.fn();
    render(<DatePickerModal isOpen onClose={() => {}} onSelect={onSelect} />);

    expect(screen.getByText(/setembro 2026/i)).toBeInTheDocument();

    const pastDay = screen.getByRole('button', { name: /17 de setembro de 2026/i });
    expect(pastDay).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /18 de setembro de 2026/i }));

    expect(onSelect).toHaveBeenCalledWith('2026-09-18');
  });

  it('navega para o mês seguinte', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 12, 0, 0));

    render(<DatePickerModal isOpen onClose={() => {}} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));

    expect(screen.getByText(/outubro 2026/i)).toBeInTheDocument();
  });
});

describe('CalendarView', () => {
  it('agrupa o agendamento das 22h de Brasília no dia local, não no dia UTC', () => {
    const onSelectEvent = vi.fn();

    render(
      <CalendarView
        appointments={[
          {
            id: 'booking-1',
            status: 'CONFIRMED',
            startsAt: '2026-09-19T01:00:00.000Z', // 18/09 22:00 em Brasília
            customer: { name: 'Ana' },
            service: { name: 'Corte', durationMin: 30 },
          },
        ]}
        onSelectEvent={onSelectEvent}
        timezone="America/Sao_Paulo"
        referenceDate={new Date(2026, 8, 18, 12, 0, 0)}
      />
    );

    const fridayColumn = screen.getByText('18/09').closest('div')?.parentElement;
    const saturdayColumn = screen.getByText('19/09').closest('div')?.parentElement;
    expect(fridayColumn).toBeTruthy();
    expect(saturdayColumn).toBeTruthy();

    const eventButton = within(fridayColumn as HTMLElement).getByText('22:00');
    expect(within(saturdayColumn as HTMLElement).queryByText('22:00')).not.toBeInTheDocument();

    fireEvent.click(eventButton);
    expect(onSelectEvent).toHaveBeenCalledTimes(1);
  });
});
