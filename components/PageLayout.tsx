import type { ReactNode } from 'react';
import PageHeader from '@/components/PageHeader';

interface PageLayoutProps {
  title?: string;
  showBack?: boolean;
  rightAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function PageLayout({
  title,
  showBack,
  rightAction,
  children,
  className = '',
}: PageLayoutProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="z-40 flex-none">
        <PageHeader title={title ?? ''} showBack={showBack} rightAction={rightAction} />
      </div>

      <div className={`flex-1 overflow-y-auto ${className}`}>{children}</div>
    </div>
  );
}
