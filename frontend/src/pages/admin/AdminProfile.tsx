import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { DESIGN } from '../../theme/design';
import PageLayout from '../../components/PageLayout';
import AdminBottomNav from '../../components/AdminBottomNav';

const AdminProfile: React.FC = () => {
    const { user, logout } = useAuth();

    return (
        <PageLayout title="My Profile" className="p-6 pb-24">
            <div className={`${DESIGN.card.base} p-6 space-y-6`}>
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold">
                        {user?.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">{user?.name}</h2>
                        <p className="text-text-muted">{user?.email}</p>
                        <span className="inline-block mt-2 px-2 py-0.5 bg-primary/10 text-primary text-xs font-bold rounded uppercase">
                            {user?.role}
                        </span>
                    </div>
                </div>

                <div className="border-t border-amber-400/10 pt-6">
                    <button
                        onClick={logout}
                        className="w-full py-3 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
                    >
                        <i className="ri-logout-box-r-line"></i>
                        Logout
                    </button>
                </div>
            </div>
            <AdminBottomNav activeView="profile" />
        </PageLayout>
    );
};

export default AdminProfile;
