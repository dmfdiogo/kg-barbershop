import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const CustomerDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [shops, setShops] = useState<any[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchShops = async () => {
            try {
                const response = await api.get('/shops');
                setShops(response.data);
            } catch (error) {
                console.error('Failed to fetch shops');
            }
        };
        fetchShops();
    }, []);

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white shadow-sm sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">
                    <div className="flex items-center">
                        <h1 className="text-xl font-bold text-gray-900">Barber Shop App</h1>
                    </div>
                    <div className="flex items-center space-x-4">
                        <span className="text-gray-700">Welcome, {user?.name}</span>
                        <button
                            onClick={() => navigate('/history')}
                            className="text-gray-500 hover:text-black transition-colors"
                        >
                            My Appointments
                        </button>
                        <button
                            onClick={logout}
                            className="text-gray-500 hover:text-red-600 transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900">Find a Barber Shop</h2>
                    <p className="mt-1 text-gray-500">Book your next haircut with top-rated barbers.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {shops.map(shop => (
                        <div key={shop.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-gray-900 mb-2">{shop.name}</h3>
                                <div className="space-y-2 text-gray-600 mb-6">
                                    <p className="flex items-center">
                                        <span className="text-sm font-medium text-gray-500 w-20">Owner:</span>
                                        {shop.owner?.name}
                                    </p>
                                    <p className="flex items-center">
                                        <span className="text-sm font-medium text-gray-500 w-20">Services:</span>
                                        {shop._count?.services || 0} available
                                    </p>
                                </div>
                                <button
                                    onClick={() => navigate(`/book/${shop.slug}`)}
                                    className="w-full bg-black text-white py-2 px-4 rounded hover:bg-gray-800 transition-colors font-medium"
                                >
                                    Book Now
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
};

export default CustomerDashboard;
