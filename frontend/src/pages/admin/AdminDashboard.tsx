import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const AdminDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [shops, setShops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const fetchShops = async () => {
        try {
            const response = await api.get('/shops');
            setShops(response.data);
        } catch (error) {
            console.error('Failed to fetch shops');
        }
    };

    useEffect(() => {
        fetchShops();
    }, []);

    const handleCreateShop = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/shops', values);
            setIsModalVisible(false);
            fetchShops();
        } catch (error) {
            console.error('Failed to create shop');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-gray-900 text-white flex flex-col">
                <div className="h-16 flex items-center justify-center border-b border-gray-800">
                    <h1 className="text-xl font-bold">Admin Panel</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button className="w-full flex items-center px-4 py-2 bg-gray-800 rounded text-left">
                        <span className="mr-3">🏠</span> My Shops
                    </button>
                    <button className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-gray-400">
                        <span className="mr-3">👥</span> Staff
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
                    <button
                        onClick={() => setIsModalVisible(true)}
                        className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition-colors"
                    >
                        + Create Shop
                    </button>
                </header>

                <main className="p-6">
                    <h3 className="text-lg font-medium text-gray-700 mb-4">Your Shops</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {shops.map(shop => (
                            <div key={shop.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                                <div className="flex justify-between items-start mb-4">
                                    <h4 className="text-xl font-bold text-gray-900">{shop.name}</h4>
                                    <button
                                        onClick={() => navigate(`/manage/${shop.slug}`)}
                                        className="text-blue-600 hover:text-blue-800 font-medium"
                                    >
                                        Manage
                                    </button>
                                </div>
                                <div className="space-y-2 text-gray-600">
                                    <p><span className="font-medium">URL:</span> {shop.slug}</p>
                                    <p><span className="font-medium">Services:</span> {shop._count?.services || 0}</p>
                                    <p><span className="font-medium">Staff:</span> {shop._count?.staff || 0}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </main>
            </div>

            {/* Modal */}
            {isModalVisible && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4">Create New Shop</h3>
                        <form onSubmit={handleCreateShop} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Shop Name</label>
                                <input
                                    name="name"
                                    required
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
                                    {loading ? 'Creating...' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
