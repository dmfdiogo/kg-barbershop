// Placeholder do portal público do tenant. A resolução de tenant é a tarefa
// F1.0 e o portal em si é a F3.0.
//
// ATENÇÃO (achado da F0.1): esta rota dinâmica convive com segmentos estáticos
// como /painel e /plataforma. O Next resolve o estático primeiro, então
// funciona — mas um tenant com slug "painel" ficaria inacessível. A validação
// de slug precisa recusar uma lista de palavras reservadas (F1.0 / F2.5).
export default async function PortalPlaceholder({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">Portal do estabelecimento</h1>
      <p className="mt-2 text-[var(--color-secondary)]">
        slug: <code>{slug}</code> — fase 3.
      </p>
    </main>
  );
}
