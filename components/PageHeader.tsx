'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@/components/icons';

interface PageHeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: ReactNode;
}

export default function PageHeader({ title, showBack = false, rightAction }: PageHeaderProps) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 grid grid-cols-[3rem_1fr_3rem] items-center gap-2 px-4 py-4 sm:px-6">
      <div className="flex h-9 items-center">
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full p-2 text-foreground transition-colors hover:bg-muted"
            aria-label="Voltar"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      <h1 className="truncate text-center text-lg font-bold text-primary sm:text-xl">{title}</h1>

      <div className="flex h-9 items-center justify-end">{rightAction}</div>
    </header>
  );
}
