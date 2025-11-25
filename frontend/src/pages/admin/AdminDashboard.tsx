import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import ConfirmationModal from '../../components/ConfirmationModal';

const AdminDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [shops, setShops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeView, setActiveView] = useState('shops'); // 'shops' | 'analytics'
    const [popularBarbers, setPopularBarbers] = useState<any[]>([]);
    const [peakHours, setPeakHours] = useState<any[]>([]);
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
            const [barbersRes, hoursRes] = await Promise.all([
                api.get('/analytics/popular-barbers'),
                api.get('/analytics/peak-hours')
            ]);
            setPopularBarbers(barbersRes.data);
            setPeakHours(hoursRes.data);
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
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-gray-900 text-white flex flex-col">
                <div className="h-16 flex items-center justify-center border-b border-gray-800">
                    <h1 className="text-xl font-bold">Admin Panel</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveView('shops')}
                        className={`w-full flex items-center px-4 py-2 rounded text-left ${activeView === 'shops' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                    >
                        <span className="mr-3">🏠</span> My Shops
                    </button>
                    <button
                        onClick={() => setActiveView('analytics')}
                        className={`w-full flex items-center px-4 py-2 rounded text-left ${activeView === 'analytics' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                    >
                        <span className="mr-3">📊</span> Analytics
                    </button>
                </nav>
                <div className="p-4 border-t border-gray-800">
                    <button onClick={logout} className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-red-400">
                        <span className="mr-3">🚪</span> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <header className="bg-white shadow h-16 flex items-center justify-between px-6">
                    <h2 className="text-xl font-semibold text-gray-800">Welcome, {user?.name}</h2>
                    {activeView === 'shops' && (
                        <button
                            onClick={openCreateModal}
                            className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition-colors"
                        >
                            + Create Shop
                        </button>
                    )}
                </header>

                <main className="p-6">
                    {activeView === 'shops' ? (
                        <>
                            <h3 className="text-lg font-medium text-gray-700 mb-4">Your Shops</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {shops.map(shop => (
                                    <div key={shop.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                                        <div className="flex justify-between items-start mb-4">
                                            <h4 className="text-xl font-bold text-gray-900">{shop.name}</h4>
                                            <div className="flex space-x-2">
                                                <button
                                                    onClick={() => navigate(`/manage/${shop.slug}`)}
                                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                                >
                                                    Manage
                                                </button>
                                                <button
                                                    onClick={() => openEditModal(shop)}
                                                    className="text-gray-600 hover:text-gray-800 font-medium"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => setDeleteShopId(shop.id)}
                                                    className="text-red-600 hover:text-red-800 font-medium"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        <div className="space-y-2 text-gray-600">
                                            <p><span className="font-medium">URL:</span> {shop.slug}</p>
                                            <p><span className="font-medium">Services:</span> {shop._count?.services || 0}</p>
                                            <p><span className="font-medium">Staff:</span> {shop._count?.staff || 0}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-8">
                            <h3 className="text-lg font-medium text-gray-700 mb-4">Analytics Dashboard</h3>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Popular Barbers Chart */}
                                <div className="bg-white p-6 rounded-lg shadow">
                                    <h4 className="text-lg font-bold mb-4">Most Popular Barbers</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={popularBarbers}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="name" />
                                                <YAxis allowDecimals={false} />
                                                <Tooltip />
                                                <Legend />
                                                <Bar dataKey="count" fill="#000000" name="Appointments" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Peak Hours Chart */}
                                <div className="bg-white p-6 rounded-lg shadow">
                                    <h4 className="text-lg font-bold mb-4">Peak Hours</h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={peakHours}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="hour" />
                                                <YAxis allowDecimals={false} />
                                                <Tooltip />
                                                <Legend />
                                                <Line type="monotone" dataKey="count" stroke="#000000" strokeWidth={2} name="Appointments" />
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
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4">{editingShop ? 'Edit Shop' : 'Create New Shop'}</h3>
                        <form onSubmit={handleCreateOrUpdateShop} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Shop Name</label>
                                <input
                                    name="name"
                                    required
                                    defaultValue={editingShop?.name}
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-black focus:border-black outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">URL Slug</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                                        app.com/
                                    </span>
                                    <input
                                        name="slug"
                                        required
                                        defaultValue={editingShop?.slug}
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-r focus:ring-black focus:border-black outline-none"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsModalVisible(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
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
