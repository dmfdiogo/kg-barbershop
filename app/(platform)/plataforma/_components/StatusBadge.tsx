import { TONE_CLASS, type StatusLabel } from '../_lib/presentation';

/** Selo de status do painel (tarefa F7.3): só token de tema, sem cor literal. */
export function StatusBadge({ status }: { status: StatusLabel }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[status.tone]}`}
    >
      {status.label}
    </span>
  );
}
