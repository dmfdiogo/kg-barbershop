import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DESIGN } from '../theme/design';

interface PageHeaderProps {
    title: string;
    showBack?: boolean;
    rightAction?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, showBack = false, rightAction }) => {
    const navigate = useNavigate();

    return (
        <header className="px-6 py-4 flex items-center justify-between sticky top-0 z-40 bg-transparent">
            <div className="flex items-center w-12 h-9">
                {showBack && (
                    <button
                        onClick={() => navigate(-1)}
                        className={DESIGN.button.icon}
                        aria-label="Go back"
                    >
                        <i className="ri-arrow-left-line text-xl"></i>
                    </button>
                )}
            </div>

            <h1 className={`text-xl font-bold text-primary absolute left-1/2 -translate-x-1/2`}>{title}</h1>

            <div className="flex items-center justify-end w-12 h-9">
                {rightAction}
            </div>
        </header>
    );
};

export default PageHeader;
