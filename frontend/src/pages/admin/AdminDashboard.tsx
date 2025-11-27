import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import ConfirmationModal from '../../components/ConfirmationModal';
import { DESIGN } from '../../theme/design';

const AdminDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [shops, setShops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeView, setActiveView] = useState('shops'); // 'shops' | 'analytics'
    const [popularBarbers, setPopularBarbers] = useState<any[]>([]);
    const [peakHours, setPeakHours] = useState<any[]>([]);
    const [revenueData, setRevenueData] = useState<any[]>([]);
    const [statusStats, setStatusStats] = useState<any[]>([]);
    const [retentionStats, setRetentionStats] = useState<any[]>([]);
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
            const [barbersRes, hoursRes, revenueRes, statusRes, retentionRes] = await Promise.all([
                api.get('/analytics/popular-barbers'),
                api.get('/analytics/peak-hours'),
                api.get('/analytics/revenue'),
                api.get('/analytics/status'),
                api.get('/analytics/retention')
            ]);
            setPopularBarbers(barbersRes.data);
            setPeakHours(hoursRes.data);
            setRevenueData(revenueRes.data);
            setStatusStats(statusRes.data);
            setRetentionStats(retentionRes.data);
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
        <div className={DESIGN.layout.pageContainer}>
            {/* Sidebar */}
            <div className="w-64 bg-dark-card border-r border-gray-800 flex flex-col hidden md:flex">
                <div className="h-16 flex items-center justify-center border-b border-gray-800">
                    <h1 className="text-xl font-bold text-primary">Admin Panel</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveView('shops')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeView === 'shops' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-store-2-line mr-3 text-lg"></i> My Shops
                    </button>
                    <button
                        onClick={() => setActiveView('analytics')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeView === 'analytics' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-bar-chart-box-line mr-3 text-lg"></i> Analytics
                    </button>
                </nav>
                <div className="p-4 border-t border-gray-800">
                    <button onClick={logout} className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-red-400 transition-colors">
                        <i className="ri-logout-box-r-line mr-3 text-lg"></i> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <header className="bg-dark-card shadow-md border-b border-gray-800 h-16 flex items-center justify-between px-6 sticky top-0 z-10">
                    <h2 className={DESIGN.text.subHeader}>Welcome, {user?.name}</h2>
                    {activeView === 'shops' && (
                        <button
                            onClick={openCreateModal}
                            className={DESIGN.button.primary}
                        >
                            + Create Shop
                        </button>
                    )}
                </header>

                <main className="p-6">
                    {activeView === 'shops' ? (
                        <>
                            <h3 className={`${DESIGN.text.subHeader} text-lg mb-4`}>Your Shops</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {shops.map(shop => (
                                    <div key={shop.id} className={`${DESIGN.card.base} ${DESIGN.card.padding} ${DESIGN.card.hover}`}>
                                        <div className="flex justify-between items-start mb-4">
                                            <h4 className="text-xl font-bold text-white">{shop.name}</h4>
                                            <div className="flex space-x-2">
                                                <button
                                                    onClick={() => navigate(`/manage/${shop.slug}`)}
                                                    className="text-primary hover:text-yellow-300 font-medium transition-colors"
                                                >
                                                    Manage
                                                </button>
                                                <button
                                                    onClick={() => openEditModal(shop)}
                                                    className="text-text-secondary hover:text-white font-medium transition-colors"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => setDeleteShopId(shop.id)}
                                                    className="text-red-500 hover:text-red-400 font-medium transition-colors"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        <div className={`space-y-2 ${DESIGN.text.body}`}>
                                            <p><span className={`font-medium ${DESIGN.text.muted}`}>URL:</span> {shop.slug}</p>
                                            <p><span className={`font-medium ${DESIGN.text.muted}`}>Services:</span> {shop._count?.services || 0}</p>
                                            <p><span className={`font-medium ${DESIGN.text.muted}`}>Staff:</span> {shop._count?.staff || 0}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-8">
                            <h3 className={`${DESIGN.text.subHeader} text-lg mb-4`}>Analytics Dashboard</h3>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Revenue Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding} lg:col-span-2`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Revenue Over Time</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={revenueData}>
                                                <defs>
                                                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#F7B500" stopOpacity={0.8} />
                                                        <stop offset="95%" stopColor="#F7B500" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                                <XAxis dataKey="date" stroke="#9CA3AF" />
                                                <YAxis stroke="#9CA3AF" />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                                    itemStyle={{ color: '#F3F4F6' }}
                                                />
                                                <Area type="monotone" dataKey="amount" stroke="#F7B500" fillOpacity={1} fill="url(#colorRevenue)" name="Revenue ($)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Popular Barbers Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding}`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Most Popular Barbers</h4>
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
                                                <Bar dataKey="count" fill="#F7B500" name="Appointments" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Appointment Status Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding}`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Appointment Status</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={statusStats}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={80}
                                                    fill="#8884d8"
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                >
                                                    {statusStats.map((_: any, index: number) => (
                                                        <Cell key={`cell-${index}`} fill={['#10B981', '#EF4444', '#F59E0B'][index % 3]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                                    itemStyle={{ color: '#F3F4F6' }}
                                                />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Customer Retention Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding}`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Customer Retention</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={retentionStats}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={80}
                                                    fill="#8884d8"
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                >
                                                    {retentionStats.map((_: any, index: number) => (
                                                        <Cell key={`cell-${index}`} fill={['#3B82F6', '#F7B500'][index % 2]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                                    itemStyle={{ color: '#F3F4F6' }}
                                                />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Peak Hours Chart */}
                                <div className={`${DESIGN.card.base} ${DESIGN.card.padding} lg:col-span-2`}>
                                    <h4 className="text-lg font-bold mb-4 text-white">Peak Hours</h4>
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
                                                <Line type="monotone" dataKey="count" stroke="#F7B500" strokeWidth={2} name="Appointments" dot={{ fill: '#F7B500' }} />
                                            </LineChart>
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
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>{editingShop ? 'Edit Shop' : 'Create New Shop'}</h3>
                        <form onSubmit={handleCreateOrUpdateShop} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Shop Name</label>
                                <input
                                    name="name"
                                    required
                                    defaultValue={editingShop?.name}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>URL Slug</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l border border-r-0 border-gray-700 bg-gray-800 text-text-muted text-sm">
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
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className={DESIGN.button.primary}
                                >
                                    {loading ? (editingShop ? 'Saving...' : 'Creating...') : (editingShop ? 'Save Changes' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={!!deleteShopId}
                onClose={() => setDeleteShopId(null)}
                onConfirm={confirmDeleteShop}
                title="Delete Shop"
                message="Are you sure you want to delete this shop? This action cannot be undone and will delete all associated services and staff."
                confirmText="Delete Shop"
                isDangerous={true}
            />
        </div>
    );
};

export default AdminDashboard;
