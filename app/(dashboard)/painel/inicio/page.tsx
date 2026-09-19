import { requireRole } from '@/lib/auth/rbac';
import { formatCentsToBRL } from '@/lib/catalog/money';
import type { TrialStatus } from '@/lib/billing/trial';
import { loadDashboard, type AgendaEntry, type DashboardOverview } from './data';

/**
 * Painel operacional (tarefa F2.4): faturamento do dia/mês, ocupação por
 * profissional e agenda do dia.
 *
 * O layout do segmento já exige STAFF (dono e equipe); o profissional precisa
 * ver o próprio dia. Os números vêm do client escopado (`forTenant`) e todo
 * cálculo de dia/mês/ocupação acontece em `data.ts`.
 */
export default async function InicioPage() {
  const context = await requireRole('STAFF');
  const overview = await context.forTenant((tx) =>
    loadDashboard(tx, context.tenant.id, context.tenant.timezone),
  );

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Início</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Como está o dia de {formatLongDate(overview.date)}.
        </p>
      </header>

      <TrialBanner trial={overview.trial} />
      <RevenueCards overview={overview} />
      <OccupancyCard occupancy={overview.occupancy} />
      <AgendaCard agenda={overview.agenda} timezone={context.tenant.timezone} />
    </section>
  );
}

/**
 * Aviso da trial por valor (F7.1): a partir do 8º agendamento o dono é
 * convidado a escolher um plano; no 11º o tom muda para explicar que só os
 * agendamentos NOVOS estão bloqueados — os existentes seguem disponíveis.
 * Some quando não há nada a avisar (trial no começo ou já convertido).
 */
function TrialBanner({ trial }: { trial: TrialStatus }) {
  if (!trial.message) return null;

  const exhausted = trial.phase === 'EXHAUSTED';
  const palette = exhausted
    ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
    : 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]';

  return (
    <aside role="status" className={`rounded-xl px-4 py-3 text-sm ${palette}`}>
      <p className="font-medium">{trial.message}</p>
      {trial.upgrade ? (
        <p className="mt-1 text-xs opacity-90">
          Plano {trial.upgrade.name} — {formatCentsToBRL(trial.upgrade.priceCents)}/mês.
        </p>
      ) : null}
    </aside>
  );
}

function formatLongDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function formatTime(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(instant);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] p-5">
      <h2 className="text-sm font-semibold text-[var(--color-secondary)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function RevenueCards({ overview }: { overview: DashboardOverview }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Faturamento do dia">
        <p className="text-2xl font-semibold">{formatCentsToBRL(overview.revenue.dayCents)}</p>
      </Card>
      <Card title="Faturamento do mês">
        <p className="text-2xl font-semibold">{formatCentsToBRL(overview.revenue.monthCents)}</p>
      </Card>
    </div>
  );
}

function OccupancyCard({ occupancy }: { occupancy: DashboardOverview['occupancy'] }) {
  return (
    <Card title="Ocupação de hoje por profissional">
      {occupancy.length === 0 ? (
        <p className="text-sm text-[var(--color-secondary)]">Nenhum profissional ativo.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {occupancy.map((entry) => (
            <li key={entry.staffId} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{entry.name}</span>
                <span className="text-[var(--color-secondary)]">
                  {entry.rate === null ? 'Sem jornada hoje' : `${Math.round(entry.rate * 100)}%`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${entry.rate === null ? 0 : Math.round(entry.rate * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATUS_LABEL: Record<AgendaEntry['status'], string> = {
  HOLD: 'Reservado',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Faltou',
};

function AgendaCard({ agenda, timezone }: { agenda: AgendaEntry[]; timezone: string }) {
  return (
    <Card title="Agenda de hoje">
      {agenda.length === 0 ? (
        <p className="text-sm text-[var(--color-secondary)]">Nenhum atendimento agendado para hoje.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)]">
          {agenda.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {formatTime(entry.startsAt, timezone)} · {entry.customerName}
                </p>
                <p className="truncate text-xs text-[var(--color-secondary)]">
                  {entry.serviceName} · {entry.staffName}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatCentsToBRL(entry.priceCents)}</p>
                <p className="text-xs text-[var(--color-secondary)]">
                  {STATUS_LABEL[entry.status]}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
