import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DESIGN } from '../theme/design';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const { user, logout } = useAuth();
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    const getNavItems = () => {
        const items = [
            { path: '/', label: 'Home', icon: 'ri-home-4-line' },
        ];

        if (user?.role === 'CUSTOMER') {
            items.push(
                { path: '/history', label: 'Appointments', icon: 'ri-calendar-event-line' },
                { path: '/plans', label: 'Membership', icon: 'ri-vip-crown-line' }
            );
        }

        return items;
    };

    const navItems = getNavItems();

    if (!user) return <>{children}</>;

    return (
        <div className={DESIGN.layout.pageContainer}>
            {/* Desktop Header */}
            <header className="hidden md:flex items-center justify-between px-6 py-4 bg-dark-card border-b border-gray-800 sticky top-0 z-50">
                <div className="flex items-center gap-8">
                    <h1 className="text-xl font-bold text-primary flex items-center gap-2">
                        <i className="ri-scissors-cut-fill"></i> Barber Shop
                    </h1>
                    <nav className="flex gap-6">
                        {navItems.map(item => (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`text-sm font-medium transition-colors flex items-center gap-2 ${isActive(item.path) ? 'text-primary' : 'text-text-secondary hover:text-white'}`}
                            >
                                <i className={item.icon}></i>
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>
                <div className="flex items-center gap-4">
                    <span className={`text-sm ${DESIGN.text.muted}`}>Welcome, {user.name}</span>
                    <button
                        onClick={logout}
                        className="text-sm text-text-secondary hover:text-red-500 transition-colors flex items-center gap-1"
                    >
                        <i className="ri-logout-box-r-line"></i> Logout
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 pb-24 md:pb-8 max-w-7xl mx-auto w-full">
                {children}
            </main>

            {/* Mobile Bottom Navigation - Always Visible */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-card border-t border-gray-800 px-6 py-3 flex justify-between items-center z-50 safe-area-bottom shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)]">
                {navItems.map(item => (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={`flex flex-col items-center gap-1 ${isActive(item.path) ? 'text-primary' : 'text-text-secondary'}`}
                    >
                        <i className={`${item.icon} text-xl`}></i>
                        <span className="text-[10px] font-medium">{item.label}</span>
                    </Link>
                ))}
                <button
                    onClick={logout}
                    className="flex flex-col items-center gap-1 text-text-secondary"
                >
                    <i className="ri-logout-box-r-line text-xl"></i>
                    <span className="text-[10px] font-medium">Logout</span>
                </button>
            </nav>
        </div>
    );
};

export default Layout;
