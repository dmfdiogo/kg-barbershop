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
        <header className="bg-dark-card border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-md">
            <div className="flex items-center gap-4">
                {showBack && (
                    <button
                        onClick={() => navigate(-1)}
                        className={DESIGN.button.icon}
                        aria-label="Go back"
                    >
                        <i className="ri-arrow-left-line text-xl"></i>
                    </button>
                )}
                <h1 className={DESIGN.text.subHeader}>{title}</h1>
            </div>
            {rightAction && (
                <div>{rightAction}</div>
            )}
        </header>
    );
};

export default PageHeader;
