import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { DESIGN } from '../../theme/design';
import PageHeader from '../../components/PageHeader';

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
            <PageHeader title="Find a Barber Shop" />

            <div className="px-4 md:px-0">
                <p className={`mb-6 ${DESIGN.text.body}`}>Book your next haircut with top-rated barbers.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {shops.map(shop => (
                        <div key={shop.id} className={`${DESIGN.card.base} ${DESIGN.card.hover} overflow-hidden`}>
                            <div className={DESIGN.card.padding}>
                                <h3 className={`${DESIGN.text.subHeader} mb-2`}>{shop.name}</h3>
                                <div className="space-y-2 mb-6">
                                    <p className={`flex items-center text-sm ${DESIGN.text.body}`}>
                                        <span className={`${DESIGN.text.muted} w-20`}>Owner:</span>
                                        {shop.owner?.name}
                                    </p>
                                    <p className={`flex items-center text-sm ${DESIGN.text.body}`}>
                                        <span className={`${DESIGN.text.muted} w-20`}>Services:</span>
                                        {shop._count?.services || 0} available
                                    </p>
                                </div>
                                <button
                                    onClick={() => navigate(`/book/${shop.slug}`)}
                                    className={`w-full ${DESIGN.button.primary}`}
                                >
                                    Book Now
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CustomerDashboard;
