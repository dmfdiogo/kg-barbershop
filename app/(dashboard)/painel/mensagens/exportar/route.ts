import { withRole } from '@/lib/auth/rbac';
import { exportCustomerData } from '@/lib/privacy';

/**
 * Exportação dos dados do titular (direito de acesso, LGPD — tarefa F6.2).
 *
 * Rota autenticada de OWNER, escopada ao tenant ativo. O JSON sai como anexo;
 * é o formato portátil que atende ao pedido do titular sem depender de tela.
 * Se o membro for de outro salão, `exportCustomerData` devolve `null` (a RLS e
 * o filtro por tenantId garantem) e a resposta é 404 — nunca vaza.
 */

export const dynamic = 'force-dynamic';

export const GET = withRole(['OWNER'], async (context, request) => {
  const memberId = new URL(request.url).searchParams.get('membro');
  if (!memberId) {
    return Response.json(
      { error: 'BAD_REQUEST', message: 'Informe o cliente a exportar.' },
      { status: 400 },
    );
  }

  const data = await context.forTenant((tx) =>
    exportCustomerData(tx, context.tenant.id, memberId),
  );
  if (!data) {
    return Response.json(
      { error: 'NOT_FOUND', message: 'Cliente não encontrado neste estabelecimento.' },
      { status: 404 },
    );
  }

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="dados-cliente-${memberId}.json"`,
    },
  });
});
