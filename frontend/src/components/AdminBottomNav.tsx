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

        // If in shop context, services and staff are local tabs
        if (isShopContext && (view === 'services' || view === 'staff')) {
            if (onViewChange) onViewChange(view);
            return;
        }

        // If we have an onViewChange handler and we are NOT in shop context (e.g. AdminDashboard), use it
        if (onViewChange && !isShopContext) {
            onViewChange(view);
        } else {
            // Otherwise navigate to Admin Dashboard with the view (e.g. from Profile or from Shop for global items)
            navigate('/admin', { state: { view } });
        }
    };

    const navItems = [
        { id: 'shops', icon: 'ri-store-2-line', label: 'Barbearias', enabled: true },
        { id: 'analytics', icon: 'ri-bar-chart-box-line', label: 'Análises', enabled: true },
        { id: 'profile', icon: 'ri-user-settings-line', label: 'Perfil', enabled: true },
        { id: 'services', icon: 'ri-scissors-line', label: 'Serviços', enabled: true },
        { id: 'staff', icon: 'ri-group-line', label: 'Equipe', enabled: true },
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
