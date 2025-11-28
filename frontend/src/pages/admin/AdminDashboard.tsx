import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import ConfirmationModal from '../../components/ConfirmationModal';
import { DESIGN } from '../../theme/design';
import AdminBottomNav from '../../components/AdminBottomNav';

const AdminDashboard: React.FC = () => {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [shops, setShops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Initialize view from state if available (e.g. navigated from ManageShop)
    const [activeView, setActiveView] = useState<'shops' | 'analytics'>(
        (location.state as any)?.view || 'shops'
    );

    const [popularBarbers, setPopularBarbers] = useState<any[]>([]);
    const [peakHours, setPeakHours] = useState<any[]>([]);
    const [peakDays, setPeakDays] = useState<any[]>([]);
    const navigate = useNavigate();

    const [editingShop, setEditingShop] = useState<any>(null);
    const [deleteShopId, setDeleteShopId] = useState<number | null>(null);

    const fetchShops = async () => {
        try {
            const response = await api.get('/shops');
            setShops(response.data);
        } catch (error) {
            console.error('Failed to fetch shops');
        }
    };

    const fetchAnalytics = async () => {
        try {
            const [barbersRes, hoursRes, daysRes] = await Promise.all([
                api.get('/analytics/popular-barbers'),
                api.get('/analytics/peak-hours'),
                api.get('/analytics/peak-days')
            ]);
            setPopularBarbers(barbersRes.data);
            setPeakHours(hoursRes.data);
            setPeakDays(daysRes.data);
        } catch (error) {
            console.error('Failed to fetch analytics');
        }
    };

    useEffect(() => {
        fetchShops();
    }, []);

    useEffect(() => {
        if (activeView === 'analytics') {
            fetchAnalytics();
        }
    }, [activeView]);

    const handleCreateOrUpdateShop = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            if (editingShop) {
                await api.put(`/shops/${editingShop.id}`, values);
            } else {
                await api.post('/shops', values);
            }
            setIsModalVisible(false);
            setEditingShop(null);
            fetchShops();
        } catch (error) {
            console.error('Failed to save shop');
        } finally {
            setLoading(false);
        }
    };

    const confirmDeleteShop = async () => {
        if (deleteShopId) {
            try {
                await api.delete(`/shops/${deleteShopId}`);
                fetchShops();
            } catch (error) {
                console.error('Failed to delete shop');
            }
            setDeleteShopId(null);
        }
    };

    const openCreateModal = () => {
        setEditingShop(null);
        setIsModalVisible(true);
    };

    const openEditModal = (shop: any) => {
        setEditingShop(shop);
        setIsModalVisible(true);
    };

    return (
        <div className={`${DESIGN.layout.pageContainer} flex flex-col md:flex-row`}>
            {/* Sidebar */}
            <div className="w-64 bg-dark-card border-r border-amber-400/10 flex flex-col hidden md:flex">
                <div className="h-16 flex items-center justify-center border-b border-amber-400/10">
                    <h1 className="text-xl font-bold text-primary">Painel Admin</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveView('shops')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeView === 'shops' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-store-2-line mr-3 text-lg"></i> Minhas Barbearias
                    </button>
                    <button
                        onClick={() => setActiveView('analytics')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeView === 'analytics' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-bar-chart-box-line mr-3 text-lg"></i> Análises
                    </button>
                </nav>
                <div className="p-4 border-t border-amber-400/10">
                    <button onClick={logout} className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-red-400 transition-colors">
                        <i className="ri-logout-box-r-line mr-3 text-lg"></i> Sair
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-transparent shadow-md border-b border-amber-400/10 h-16 flex items-center justify-between px-6 flex-none z-10">
                    <h2 className={DESIGN.text.subHeader}>Bem-vindo, {user?.name}</h2>
                </header>

                <main className="flex-1 overflow-y-auto mask-fade p-6 pb-24 scrollbar-hide">
                    {activeView === 'shops' ? (
                        <>
                            <h3 className={`${DESIGN.text.subHeader} text-lg mb-4`}>Suas Barbearias</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {shops.map(shop => (
                                    <div key={shop.id} className={`${DESIGN.card.base} p-5 flex flex-col gap-4 group hover:border-primary transition-all duration-300`}>
                                        {/* Header: Name & Actions */}
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="text-lg font-bold text-white leading-tight">{shop.name}</h4>
                                                <p className="text-[10px] text-text-muted font-mono mt-1">/{shop.slug}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => navigate(`/manage/${shop.slug}`)}
                                                    className="p-2 text-text-muted hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                                                    title="Manage Shop"
                                                >
                                                    <i className="ri-settings-3-line text-lg"></i>
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); openEditModal(shop); }}
                                                    className="p-2 text-text-muted hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                                                    title="Edit"
                                                >
                                                    <i className="ri-pencil-line text-lg"></i>
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setDeleteShopId(shop.id); }}
                                                    className="p-2 text-text-muted hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                                                    title="Delete"
                                                >
                                                    <i className="ri-delete-bin-line text-lg"></i>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Stats */}
                                        <div className="flex items-center gap-4 py-3 border-t border-b border-amber-400/10">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                                    <i className="ri-scissors-cut-line"></i>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">{shop._count?.services || 0}</p>
                                                    <p className="text-[10px] text-text-muted uppercase">Serviços</p>
                                                </div>
                                            </div>
                                            <div className="w-px h-8 bg-gray-800"></div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                                                    <i className="ri-user-line"></i>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">{shop._count?.staff || 0}</p>
                                                    <p className="text-[10px] text-text-muted uppercase">Equipe</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Create New Shop Card */}
                                <button
                                    onClick={openCreateModal}
                                    className={`${DESIGN.card.base} min-h-[180px] flex flex-col items-center justify-center p-4 border-2 border-dashed border-amber-400/10 hover:border-primary hover:bg-primary/5 transition-all duration-300 group cursor-pointer`}
                                >
                                    <div className="w-12 h-12 rounded-full bg-dark-input group-hover:bg-primary group-hover:text-black flex items-center justify-center mb-3 transition-all duration-300 shadow-lg">
                                        <i className="ri-add-line text-2xl text-gray-500 group-hover:text-black transition-colors"></i>
                                    </div>
                                    <h4 className="text-sm font-bold text-gray-400 group-hover:text-white transition-colors">Criar Nova Barbearia</h4>
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-8">
                            <h3 className={`${DESIGN.text.subHeader} text-lg mb-4`}>Painel de Análises</h3>

                            <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
                                {/* Popular Barbers Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding} lg:col-span-2`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Barbeiros Mais Populares</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={popularBarbers}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                                <XAxis dataKey="name" stroke="#9CA3AF" />
                                                <YAxis allowDecimals={false} stroke="#9CA3AF" />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                                    itemStyle={{ color: '#F3F4F6' }}
                                                />
                                                <Legend />
                                                <Bar dataKey="count" fill="#F7B500" name="Agendamentos" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Peak Hours Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding} lg:col-span-2`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Horários de Pico</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={peakHours}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                                <XAxis dataKey="hour" stroke="#9CA3AF" />
                                                <YAxis allowDecimals={false} stroke="#9CA3AF" />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                                    itemStyle={{ color: '#F3F4F6' }}
                                                />
                                                <Legend />
                                                <Line type="monotone" dataKey="count" stroke="#F7B500" strokeWidth={2} name="Agendamentos" dot={{ fill: '#F7B500' }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Peak Days Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding} lg:col-span-2`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Dias de Pico</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={peakDays}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                                <XAxis dataKey="day" stroke="#9CA3AF" />
                                                <YAxis allowDecimals={false} stroke="#9CA3AF" />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                                    itemStyle={{ color: '#F3F4F6' }}
                                                />
                                                <Legend />
                                                <Bar dataKey="count" fill="#3B82F6" name="Agendamentos" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* Modal */}
            {isModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>{editingShop ? 'Editar Barbearia' : 'Criar Nova Barbearia'}</h3>
                        <form onSubmit={handleCreateOrUpdateShop} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Nome da Barbearia</label>
                                <input
                                    name="name"
                                    required
                                    defaultValue={editingShop?.name}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Slug da URL</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l border border-r-0 border-amber-500 bg-gray-800 text-text-muted text-sm">
                                        app.com/
                                    </span>
                                    <input
                                        name="slug"
                                        required
                                        defaultValue={editingShop?.slug}
                                        className={`${DESIGN.input.base} rounded-l-none`}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsModalVisible(false)}
                                    className={DESIGN.button.secondary}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className={DESIGN.button.primary}
                                >
                                    {loading ? (editingShop ? 'Salvando...' : 'Criando...') : (editingShop ? 'Salvar Alterações' : 'Criar')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <AdminBottomNav
                activeView={activeView}
                onViewChange={(view) => {
                    if (view === 'shops' || view === 'analytics') {
                        setActiveView(view);
                    }
                }}
            />

            <ConfirmationModal
                isOpen={!!deleteShopId}
                onClose={() => setDeleteShopId(null)}
                onConfirm={confirmDeleteShop}
                title="Excluir Barbearia"
                message="Tem certeza que deseja excluir esta barbearia? Esta ação não pode ser desfeita e excluirá todos os serviços e equipe associados."
                confirmText="Excluir Barbearia"
                isDangerous={true}
            />
        </div>
    );
};

export default AdminDashboard;
