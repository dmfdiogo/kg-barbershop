import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const CustomerDashboard: React.FC = () => {
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
        <div className="space-y-8">
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-white">Find a Barber Shop</h2>
                <p className="mt-1 text-text-secondary">Book your next haircut with top-rated barbers.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {shops.map(shop => (
                    <div key={shop.id} className="bg-dark-card rounded-xl shadow-lg overflow-hidden border border-gray-800 hover:border-primary transition-colors">
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-white mb-2">{shop.name}</h3>
                            <div className="space-y-2 text-text-secondary mb-6">
                                <p className="flex items-center text-sm">
                                    <span className="text-text-muted w-20">Owner:</span>
                                    {shop.owner?.name}
                                </p>
                                <p className="flex items-center text-sm">
                                    <span className="text-text-muted w-20">Services:</span>
                                    {shop._count?.services || 0} available
                                </p>
                            </div>
                            <button
                                onClick={() => navigate(`/book/${shop.slug}`)}
                                className="w-full bg-primary text-black py-3 px-4 rounded-lg hover:bg-yellow-400 transition-colors font-bold"
                            >
                                Book Now
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CustomerDashboard;
