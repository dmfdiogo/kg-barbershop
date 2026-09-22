'use client';

import { useState, useTransition } from 'react';
import { saveTenantAddressAction } from '../actions';

/**
 * Endereço físico do estabelecimento.
 *
 * POR QUE UM CAMPO SÓ, E LIVRE. Endereço brasileiro é irregular: "Rua X, s/n",
 * "ao lado do mercado", zona rural sem CEP. Seis campos estruturados afugentam
 * quem preenche no celular, e o onboarding tem meta de dez minutos. O que o
 * produto faz com o dado é montar uma busca no Google Maps, e o Maps entende
 * texto livre melhor do que qualquer formulário nosso entenderia.
 *
 * POR QUE ISSO IMPORTA. Sem endereço, a mensagem de confirmação mandava o NOME
 * do salão no lugar dele — o cliente lia "Endereço: Barbearia do Carlos" — e o
 * portal pedia um compromisso sem dizer onde.
 */
export function TenantAddressForm({ initial }: { initial: string }) {
  const [address, setAddress] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = address.trim() !== initial.trim();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(null);
    setError(null);
    startTransition(async () => {
      const result = await saveTenantAddressAction(address);
      if (result.ok) {
        setSaved(
          result.address
            ? 'Endereço salvo. Ele aparece no portal e na confirmação por WhatsApp.'
            : 'Endereço removido do portal.',
        );
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4"
    >
      <div>
        <h2 className="text-base font-semibold">Endereço do estabelecimento</h2>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Aparece no seu portal e na mensagem de confirmação, com link para o mapa.
        </p>
      </div>

      <label htmlFor="endereco" className="text-sm font-medium">
        Endereço
      </label>
      <input
        id="endereco"
        name="address"
        value={address}
        maxLength={200}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Rua das Flores, 123 — Centro, Florianópolis"
        className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
      />
      <p className="text-xs text-[var(--color-secondary)]">
        Escreva como você explicaria a um cliente. Deixe em branco para não exibir.
      </p>

      {saved ? (
        <p role="status" className="text-sm text-[var(--color-success)]">
          {saved}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending || !dirty}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] disabled:opacity-50"
        >
          {pending ? 'Salvando…' : 'Salvar endereço'}
        </button>
      </div>
    </form>
  );
}
