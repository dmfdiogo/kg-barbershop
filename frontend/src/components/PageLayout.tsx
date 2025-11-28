import React from 'react';
import PageHeader from './PageHeader';

interface PageLayoutProps {
    title?: string;
    showBack?: boolean;
    rightAction?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}

const PageLayout: React.FC<PageLayoutProps> = ({
    title,
    showBack,
    rightAction,
    children,
    className = ""
}) => {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header - Fixed at top */}
            <div className="flex-none z-40">
                <PageHeader
                    title={title || ''}
                    showBack={showBack}
                    rightAction={rightAction}
                />
            </div>

            {/* Scrollable Content - Fills remaining space */}
            <div className={`flex-1 overflow-y-auto mask-fade scrollbar-hide ${className}`}>
                {children}
            </div>
        </div>
    );
};

export default PageLayout;
