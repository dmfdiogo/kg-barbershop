'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { validateLogoUpload } from './logo';
import { persistBranding } from './service';
import {
  assessContrast,
  parseBrandingColors,
  type BrandingColorField,
  type BrandingDraft,
  type ContrastIssue,
} from './validation';

/**
 * Server actions da tela de marca (tarefa F2.3).
 *
 * O tenant NUNCA vem do formulário: sai de `requireRole('OWNER')`, que lê o
 * membro do tenant ativo da sessão. Um dono do salão A não tem como escrever no
 * salão B nem forjando o `tenantId` no `FormData` — ele nem é lido.
 *
 * A validação de contraste é feita AQUI também, não só no cliente. O cliente
 * mostra o aviso e pede confirmação; sem `confirmLowContrast`, a action recusa
 * a gravação e devolve os problemas. É a garantia de que "avisar antes de
 * salvar" não depende do JavaScript do navegador.
 */

export type BrandingActionResult =
  | {
      ok: true;
      colors: BrandingDraft;
      presetId: string | null;
      hasLogo: boolean;
      issues: ContrastIssue[];
    }
  | { ok: false; code: 'FORBIDDEN'; message: string }
  | {
      ok: false;
      code: 'INVALID_COLORS';
      message: string;
      errors: Partial<Record<BrandingColorField, string>>;
    }
  | { ok: false; code: 'INVALID_LOGO'; message: string }
  | { ok: false; code: 'LOW_CONTRAST'; message: string; issues: ContrastIssue[] };

function isChecked(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true';
}

/**
 * Lê os bytes do arquivo. No runtime do Next o `File` é do undici e tem
 * `arrayBuffer()`; o fallback via `FileReader` existe para o ambiente de teste
 * (jsdom), que não implementa `Blob.arrayBuffer`.
 */
async function readFileBytes(file: File): Promise<Uint8Array | null> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  if (typeof FileReader === 'undefined') return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result instanceof ArrayBuffer ? new Uint8Array(result) : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

export async function saveBrandingAction(formData: FormData): Promise<BrandingActionResult> {
  let context;
  try {
    context = await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono pode editar a marca.' };
    }
    throw error;
  }

  const parsed = parseBrandingColors({
    primary: formData.get('colorPrimary'),
    secondary: formData.get('colorSecondary'),
    background: formData.get('colorBackground'),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'INVALID_COLORS',
      message: 'Revise as cores destacadas.',
      errors: parsed.errors,
    };
  }

  // Tri-estado do logo: ausente mantém, `removeLogo` limpa, arquivo substitui.
  let logoUrl: string | null | undefined;
  if (isChecked(formData.get('removeLogo'))) {
    logoUrl = null;
  }

  const logoEntry = formData.get('logo');
  if (logoEntry instanceof File && logoEntry.size > 0) {
    const bytes = await readFileBytes(logoEntry);
    if (!bytes) {
      return { ok: false, code: 'INVALID_LOGO', message: 'Não foi possível ler o arquivo enviado.' };
    }
    const validation = validateLogoUpload({ bytes, declaredMime: logoEntry.type });
    if (!validation.ok) {
      return { ok: false, code: 'INVALID_LOGO', message: validation.message };
    }
    logoUrl = validation.dataUrl;
  }

  const issues = assessContrast(parsed.value);
  if (issues.length > 0 && !isChecked(formData.get('confirmLowContrast'))) {
    return {
      ok: false,
      code: 'LOW_CONTRAST',
      message: 'O contraste do tema está baixo. Confirme para salvar mesmo assim.',
      issues,
    };
  }

  await context.forTenant((tx) =>
    persistBranding(tx, context.tenant.id, context.user.id, {
      colors: parsed.value,
      preset: parsed.preset,
      logoUrl,
    }),
  );

  // O portal é dinâmico (lê o tenant por requisição), mas revalidar mantém o
  // caminho correto mesmo se a rota ganhar cache numa fase futura.
  revalidatePath(`/${context.tenant.slug}`, 'layout');
  revalidatePath('/painel/marca');

  return {
    ok: true,
    colors: parsed.value,
    presetId: parsed.preset?.id ?? null,
    hasLogo: logoUrl !== undefined ? logoUrl !== null : Boolean(context.tenant.logoUrl),
    issues,
  };
}
