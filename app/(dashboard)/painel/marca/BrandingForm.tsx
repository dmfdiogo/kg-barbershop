'use client';

import { useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { resolveTheme, themeCssVariables } from '@/lib/theme/resolve';
import type { ThemePreset } from '@/lib/theme/presets';
import { LOGO_ACCEPT, LOGO_MAX_BYTES } from './logo';
import { assessContrast, parseBrandingColors, type BrandingDraft } from './validation';
import { saveBrandingAction, type BrandingActionResult } from './actions';

/**
 * Editor de marca com preview ao vivo (tarefa F2.3).
 *
 * O preview é montado com as MESMAS funções do portal (`resolveTheme` +
 * `themeCssVariables`): o que aparece aqui é o tema que o SSR vai injetar. As
 * variáveis entram por `style` inline no contêiner do preview — é dado
 * calculado, não cor literal; nenhum componente usa hex cravado.
 *
 * O aviso de contraste aparece ANTES de salvar. Ao clicar em salvar com
 * problema, o cliente pede confirmação e só então reenvia com
 * `confirmLowContrast`; a server action recalcula e recusa sem esse campo.
 */

const COLOR_FIELDS = [
  { name: 'primary', label: 'Primária', hint: 'Botões de ação e destaques.' },
  { name: 'secondary', label: 'Secundária', hint: 'Badges, detalhes e apoio.' },
  { name: 'background', label: 'Fundo', hint: 'Define modo claro ou escuro.' },
] as const satisfies readonly { name: keyof BrandingDraft; label: string; hint: string }[];

const maxKb = Math.floor(LOGO_MAX_BYTES / 1024);

interface BrandingFormProps {
  tenantName: string;
  initial: BrandingDraft;
  initialPresetId: string | null;
  hasLogo: boolean;
  logoUrl: string | null;
  presets: readonly ThemePreset[];
}

export function BrandingForm({
  tenantName,
  initial,
  initialPresetId,
  hasLogo,
  logoUrl,
  presets,
}: BrandingFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<BrandingDraft>(initial);
  const [presetId, setPresetId] = useState<string | null>(initialPresetId);
  const [errors, setErrors] = useState<Partial<Record<keyof BrandingDraft, string>>>({});
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [localLogo, setLocalLogo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const issues = useMemo(() => assessContrast(draft), [draft]);
  const previewTheme = useMemo(
    () => resolveTheme({ colorPrimary: draft.primary, colorSecondary: draft.secondary, colorBackground: draft.background }),
    [draft],
  );
  const previewStyle = useMemo(
    () => themeCssVariables(previewTheme) as unknown as CSSProperties,
    [previewTheme],
  );

  const currentLogo = removeLogo ? null : (localLogo ?? (hasLogo ? logoUrl : null));

  function updateColor(field: keyof BrandingDraft, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setPresetId(null);
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setNeedsConfirm(false);
    setFeedback(null);
  }

  function applyPreset(preset: ThemePreset) {
    setDraft({ ...preset.colors });
    setPresetId(preset.id);
    setErrors({});
    setNeedsConfirm(false);
    setFeedback(null);
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRemoveLogo(false);
    setLocalLogo(URL.createObjectURL(file));
    setFeedback(null);
  }

  function handleRemoveLogo() {
    setRemoveLogo(true);
    setLocalLogo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFeedback(null);
  }

  function handleResult(result: BrandingActionResult) {
    if (result.ok) {
      setErrors({});
      setNeedsConfirm(false);
      setPendingConfirm(false);
      setRemoveLogo(false);
      setLocalLogo(null);
      setPresetId(result.presetId);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFeedback(
        result.issues.length > 0
          ? { tone: 'warn', text: 'Marca salva, mas há avisos de contraste no tema.' }
          : { tone: 'ok', text: 'Marca atualizada. O portal já reflete as novas cores.' },
      );
      router.refresh();
      return;
    }

    if (result.code === 'LOW_CONTRAST') {
      setNeedsConfirm(true);
      setFeedback({ tone: 'warn', text: result.message });
      return;
    }
    if (result.code === 'INVALID_COLORS') {
      setErrors(result.errors);
      setFeedback({ tone: 'error', text: result.message });
      return;
    }
    setFeedback({ tone: 'error', text: result.message });
  }

  function submit(confirmLowContrast: boolean) {
    const form = formRef.current;
    if (!form) return;

    const parsed = parseBrandingColors(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setFeedback({ tone: 'error', text: 'Revise as cores destacadas.' });
      return;
    }

    setPendingConfirm(confirmLowContrast);
    startTransition(async () => {
      const data = new FormData();
      data.set('colorPrimary', draft.primary);
      data.set('colorSecondary', draft.secondary);
      data.set('colorBackground', draft.background);
      if (confirmLowContrast) data.set('confirmLowContrast', 'on');
      if (removeLogo) data.set('removeLogo', 'on');

      const file = fileInputRef.current?.files?.[0];
      if (file && !removeLogo) data.set('logo', file);

      const result = await saveBrandingAction(data);
      handleResult(result);
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (issues.length > 0 && !pendingConfirm) {
      setNeedsConfirm(true);
      setFeedback({
        tone: 'warn',
        text: 'O contraste do tema está baixo. Confirme para salvar mesmo assim.',
      });
      return;
    }
    submit(pendingConfirm);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Logo do estabelecimento</h2>
        <p className="text-sm text-[var(--color-secondary)]">
          PNG, JPG ou SVG, até {maxKb} KB. O tipo é validado pelo conteúdo do arquivo, não pela
          extensão.
        </p>
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-muted)]">
            {currentLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview de data URL/objeto local do próprio dono.
              <img src={currentLogo} alt="Pré-visualização do logo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-[var(--color-secondary)]">Sem logo</span>
            )}
          </span>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              name="logo"
              accept={LOGO_ACCEPT}
              onChange={handleFile}
              className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-muted)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--color-foreground)]"
            />
            {hasLogo || localLogo ? (
              <button
                type="button"
                onClick={handleRemoveLogo}
                className="self-start text-sm text-[var(--color-danger)] underline-offset-2 hover:underline"
              >
                Remover logo
              </button>
            ) : null}
          </div>
        </div>
        {removeLogo ? (
          <p className="text-xs text-[var(--color-secondary)]">
            O logo será removido ao salvar; o portal volta a exibir a inicial do nome.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Presets prontos</h2>
        <p className="text-sm text-[var(--color-secondary)]">
          Um preset grava as três cores. Depois de aplicado, você pode ajustar cada cor.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {presets.map((preset) => {
            const active = presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-pressed={active}
                className={[
                  'flex flex-col gap-2 rounded-xl border p-3 text-left text-sm transition-colors',
                  active
                    ? 'border-[var(--color-primary)] font-semibold'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)]',
                ].join(' ')}
              >
                <span className="flex gap-1" aria-hidden>
                  {([preset.colors.primary, preset.colors.secondary, preset.colors.background] as const).map(
                    (color) => (
                      <span
                        key={color}
                        className="h-4 w-4 rounded-full border border-[var(--color-border)]"
                        style={{ backgroundColor: color }}
                      />
                    ),
                  )}
                </span>
                <span>{preset.name}</span>
                <span className="text-xs font-normal text-[var(--color-secondary)]">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Cores da marca</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {COLOR_FIELDS.map((field) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label htmlFor={`color-${field.name}`} className="text-sm font-medium">
                {field.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${field.label} (seletor)`}
                  value={/^#[0-9a-f]{6}$/i.test(draft[field.name]) ? draft[field.name] : '#000000'}
                  onChange={(event) => updateColor(field.name, event.target.value)}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]"
                />
                <input
                  id={`color-${field.name}`}
                  type="text"
                  inputMode="text"
                  spellCheck={false}
                  value={draft[field.name]}
                  onChange={(event) => updateColor(field.name, event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <p className="text-xs text-[var(--color-secondary)]">{field.hint}</p>
              {errors[field.name] ? (
                <p className="text-xs text-[var(--color-danger)]">{errors[field.name]}</p>
              ) : null}
            </div>
          ))}
        </div>

        {issues.length > 0 ? (
          <div
            role="status"
            className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-sm"
          >
            <p className="font-semibold text-[var(--color-warning)]">Aviso de contraste</p>
            <ul className="mt-1 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue.label}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-success)]">Contraste adequado nas combinações principais.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Pré-visualização</h2>
        <p className="text-sm text-[var(--color-secondary)]">
          Exatamente o tema que o portal público vai receber no HTML.
        </p>
        <BrandingPreview style={previewStyle} name={tenantName} hasLogo={Boolean(currentLogo)} logo={currentLogo} />
      </section>

      {feedback ? (
        <p
          role="alert"
          className={[
            'rounded-lg px-3 py-2 text-sm',
            feedback.tone === 'ok'
              ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
              : feedback.tone === 'warn'
                ? 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
                : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
          ].join(' ')}
        >
          {feedback.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {needsConfirm ? (
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={pending}
            className="rounded-lg bg-[var(--color-warning)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] disabled:opacity-60"
          >
            {pending ? 'Salvando…' : 'Salvar mesmo assim'}
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
          >
            {pending ? 'Salvando…' : 'Salvar marca'}
          </button>
        )}
        {needsConfirm ? (
          <button
            type="button"
            onClick={() => {
              setNeedsConfirm(false);
              setFeedback(null);
            }}
            className="text-sm text-[var(--color-secondary)] underline-offset-2 hover:underline"
          >
            Revisar cores
          </button>
        ) : null}
      </div>
    </form>
  );
}

function BrandingPreview({
  style,
  name,
  hasLogo,
  logo,
}: {
  style: CSSProperties;
  name: string;
  hasLogo: boolean;
  logo: string | null;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      style={style}
      className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)]"
    >
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-4">
        {hasLogo && logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview do logo do próprio tenant.
          <img src={logo} alt="" className="h-10 w-10 rounded-full border border-[var(--color-border)] object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-primary)] text-base font-semibold text-[var(--color-primary-foreground)]"
          >
            {initial}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{name}</span>
          <span className="block text-xs text-[var(--color-secondary)]">Agendamento online</span>
        </span>
      </div>

      <div className="flex flex-col gap-4 px-4 py-5">
        <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
          <span className="flex flex-col">
            <span className="text-sm font-medium">Corte masculino</span>
            <span className="text-xs text-[var(--color-secondary)]">30 min · R$ 50,00</span>
          </span>
          <span className="rounded-full bg-[var(--color-muted)] px-3 py-1 text-xs text-[var(--color-secondary)]">
            Disponível
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)]">
            Agendar horário
          </span>
          <span className="rounded-full border border-[var(--color-secondary)] px-3 py-1 text-xs text-[var(--color-secondary)]">
            Destaque
          </span>
        </div>

        <p className="text-sm text-[var(--color-secondary)]">
          Assim o portal do seu estabelecimento aparece para o cliente.
        </p>
      </div>
    </div>
  );
}
