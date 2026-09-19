import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { requireRole } from '@/lib/auth/rbac';
import { listServices, listTenantStaff } from '@/lib/catalog/services';
import {
  agendaRange,
  isDateKey,
  loadAgendaBookings,
  resolveAgendaScope,
  todayInTimezone,
} from './_lib/agenda';
import type { AgendaViewMode, AgendaServiceOption, AgendaStaffOption } from './_lib/types';
import { AgendaBoard } from './_components/AgendaBoard';
import { WalkInForm } from './_components/WalkInForm';

/**
 * Agenda do painel (tarefa F3.5, spec §2.3).
 *
 * O `?staff=` da URL NÃO é confiado: quem decide o que pode ser visto é
 * `resolveAgendaScope`, no servidor. Para o STAFF, qualquer id que não seja o
 * dele vira `null` e a página chama `notFound()` — não existe caminho, nem por
 * URL, para a agenda de um colega. O OWNER pode filtrar por qualquer
 * profissional do tenant, ou ver todos.
 *
 * Negar LANÇANDO, nunca renderizando a negação com o conteúdo montado atrás:
 * é a mesma armadilha de payload RSC documentada no layout do painel.
 */

const DEFAULT_VIEW: AgendaViewMode = 'day';

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function agendaHref(params: {
  staff?: string | null;
  date: string;
  view: AgendaViewMode;
}): Route {
  const search = new URLSearchParams();
  if (params.staff) search.set('staff', params.staff);
  search.set('date', params.date);
  search.set('view', params.view);
  return `/painel/agenda?${search.toString()}` as Route;
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireRole('STAFF');
  const timezone = context.tenant.timezone;

  const today = todayInTimezone(timezone);
  const requestedDate = readParam(params.date);
  const date = isDateKey(requestedDate) ? requestedDate : today;
  const view: AgendaViewMode = readParam(params.view) === 'week' ? 'week' : DEFAULT_VIEW;
  const requestedStaff = readParam(params.staff);

  const data = await context.forTenant(async (tx) => {
    const scope = await resolveAgendaScope(
      tx,
      context.tenant.id,
      context.role,
      context.member.id,
      requestedStaff,
    );
    if (!scope) return null;

    const range = agendaRange(view, date, timezone);
    const bookings = await loadAgendaBookings(tx, context.tenant.id, {
      staffId: scope.filterStaffId,
      start: range.start,
      end: range.end,
    });

    // Sequencial de propósito (adapter-pg): uma leitura de cada vez.
    const staffOptions: AgendaStaffOption[] =
      context.role === 'OWNER' ? await listTenantStaff(tx, context.tenant.id) : [];
    const services: AgendaServiceOption[] = (await listServices(tx, context.tenant.id))
      .filter((service) => service.active)
      .map((service) => ({
        id: service.id,
        name: service.name,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
        active: service.active,
      }));

    return { scope, bookings, staffOptions, services };
  });

  if (!data) notFound();

  const { scope, bookings, staffOptions, services } = data;
  const activeStaff = staffOptions.filter((staff) => staff.active);
  const defaultStaffId = scope.filterStaffId ?? activeStaff[0]?.id ?? '';
  const step = view === 'week' ? 7 : 1;
  const dateLabel = format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Agenda</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)] capitalize">{dateLabel}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
          <Link
            href={agendaHref({ staff: requestedStaff, date, view: 'day' })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              view === 'day'
                ? 'bg-[var(--color-primary)] text-[var(--color-background)]'
                : 'text-[var(--color-secondary)]'
            }`}
          >
            Dia
          </Link>
          <Link
            href={agendaHref({ staff: requestedStaff, date, view: 'week' })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              view === 'week'
                ? 'bg-[var(--color-primary)] text-[var(--color-background)]'
                : 'text-[var(--color-secondary)]'
            }`}
          >
            Semana
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={agendaHref({
              staff: requestedStaff,
              date: format(addDays(parseISO(date), -step), 'yyyy-MM-dd'),
              view,
            })}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium"
          >
            Anterior
          </Link>
          <Link
            href={agendaHref({ staff: requestedStaff, date: today, view })}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium"
          >
            Hoje
          </Link>
          <Link
            href={agendaHref({
              staff: requestedStaff,
              date: format(addDays(parseISO(date), step), 'yyyy-MM-dd'),
              view,
            })}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium"
          >
            Próximo
          </Link>
        </div>
      </div>

      {context.role === 'OWNER' ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={agendaHref({ staff: null, date, view })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              scope.filterStaffId === null
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-secondary)]'
            }`}
          >
            Todos
          </Link>
          {activeStaff.map((staff) => (
            <Link
              key={staff.id}
              href={agendaHref({ staff: staff.id, date, view })}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                scope.filterStaffId === staff.id
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-secondary)]'
              }`}
            >
              {staff.name}
            </Link>
          ))}
        </div>
      ) : null}

      <AgendaBoard bookings={bookings} timezone={timezone} date={date} view={view} />

      <WalkInForm
        staffOptions={activeStaff}
        services={services}
        defaultStaffId={defaultStaffId}
        canChooseStaff={context.role === 'OWNER'}
      />
    </section>
  );
}
