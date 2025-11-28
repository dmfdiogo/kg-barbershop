import React from 'react';
import { useNavigate } from 'react-router-dom';
// import { useAuth } from '../context/AuthContext';

interface AdminBottomNavProps {
    activeView: string; // 'shops' | 'analytics' | 'profile' | 'services' | 'staff'
    isShopContext?: boolean;
    onViewChange?: (view: string) => void;
}

const AdminBottomNav: React.FC<AdminBottomNavProps> = ({ activeView, isShopContext = false, onViewChange }) => {
    const navigate = useNavigate();
    // const { logout } = useAuth();

    const handleNav = (view: string) => {
        if (view === 'profile') {
            navigate('/admin/profile');
            return;
        }

        if (view === 'shops' || view === 'analytics') {
            navigate('/admin', { state: { view } });
            return;
        }

        if (onViewChange) {
            onViewChange(view);
        }
    };

    const navItems = [
        { id: 'shops', icon: 'ri-store-2-line', label: 'Shops', enabled: true },
        { id: 'analytics', icon: 'ri-bar-chart-box-line', label: 'Analytics', enabled: true },
        { id: 'profile', icon: 'ri-user-settings-line', label: 'Profile', enabled: true },
        { id: 'services', icon: 'ri-scissors-line', label: 'Services', enabled: isShopContext },
        { id: 'staff', icon: 'ri-group-line', label: 'Staff', enabled: isShopContext },
    ];

    return (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-card border-t border-amber-400/10 flex justify-around items-center p-2 z-40 pb-safe">
            {navItems.map((item) => (
                <button
                    key={item.id}
                    onClick={() => item.enabled && handleNav(item.id)}
                    disabled={!item.enabled}
                    className={`flex flex-col items-center justify-center w-full py-2 transition-colors ${!item.enabled
                        ? 'text-gray-700 cursor-not-allowed opacity-50'
                        : activeView === item.id
                            ? 'text-primary'
                            : 'text-text-secondary hover:text-white'
                        }`}
                >
                    <i className={`${item.icon} text-xl mb-1 ${activeView === item.id ? 'font-bold' : ''}`}></i>
                    <span className="text-[10px] uppercase tracking-wider font-medium">{item.label}</span>
                </button>
            ))}
        </div>
    );
};

export default AdminBottomNav;
