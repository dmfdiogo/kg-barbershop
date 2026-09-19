import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireSuperAdmin, type SuperAdminContext } from '@/lib/auth/rbac';
import { PlatformShell } from './_components/PlatformShell';

/**
 * Portão do painel da plataforma (tarefa F1.4).
 *
 * POR QUE O PORTÃO MORA NO SEGMENTO `plataforma`, E NÃO EM
 * `app/(platform)/layout.tsx`: o boundary de `not-found.tsx` fica POR DENTRO
 * do layout do próprio segmento (mesma regra documentada em `app/not-found.tsx`
 * na F1.0). Um `notFound()` chamado no layout do grupo subiria para o 404 da
 * raiz e mostraria "Estabelecimento não encontrado" — mentira, não há
 * estabelecimento nenhum no painel. Daqui o `notFound()` é capturado por
 * `app/(platform)/not-found.tsx`, e o painel tem o 404 dele. A renderização da
 * página é ABORTADA junto — verificado no HTML do 404: uma página que lê a
 * sessão (como as telas da F7.3) não deixa conteúdo no payload da resposta.
 *
 * CONSEQUÊNCIA DE ESTRUTURA: as telas do painel vivem sob `/plataforma` — o
 * slug reservado em `lib/tenant/slugs.ts`. Um segmento irmão em `(platform)`
 * ficaria fora deste portão; a F7.3 soma telas em `plataforma/**`.
 *
 * Toda rota sob `/plataforma` passa por aqui, então o `isSuperAdmin` é
 * conferido uma vez, no servidor — esconder link no menu não é controle de
 * acesso. O papel vem de `User.isSuperAdmin` lido do banco a cada requisição.
 *
 * Negativa:
 *   - sem sessão → `redirect('/')`: o painel não tem tela de login própria (a
 *     F1.2 entra na raiz); a F1.2 troca o destino por `/entrar?next=/plataforma`;
 *   - sessão sem `isSuperAdmin` → `notFound()` → 404 do segmento.
 *
 * Este layout só decide se a rota renderiza; telas e shell são a F7.3. Ele NÃO
 * dá acesso a dado de tenant: quem lê dado de negócio usa `withPlatformAudit()`
 * (`lib/audit`), que revalida este mesmo portão e grava o `AuditLog`.
 *
 * A F7.3 ESTENDE este layout com a casca (`PlatformShell`), sem tocar na
 * decisão de acesso: o `requireSuperAdmin()` continua sendo a única porta, e
 * nada é renderizado antes de ele passar. A casca recebe o nome do Super Admin
 * já autenticado.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  let admin: SuperAdminContext;
  try {
    admin = await requireSuperAdmin();
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === 'UNAUTHENTICATED') redirect('/entrar?next=/plataforma');
      notFound();
    }
    throw error;
  }

  return <PlatformShell userName={admin.user.name}>{children}</PlatformShell>;
}
