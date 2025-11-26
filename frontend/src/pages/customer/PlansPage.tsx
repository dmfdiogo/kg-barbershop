import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import MembershipCard from '../../components/MembershipCard';

const PlansPage: React.FC = () => {
    const navigate = useNavigate();
    const { } = useAuth();
    const [loading, setLoading] = useState(false);
    const [subscription, setSubscription] = useState<any>(null);

    useEffect(() => {
        const fetchSubscription = async () => {
            try {
                const response = await api.get('/payment/subscription-status');
                setSubscription(response.data);
            } catch (error) {
                console.error('Failed to fetch subscription status', error);
            }
        };
        fetchSubscription();
    }, []);

    const handleSubscribe = async () => {
        setLoading(true);
        try {
            const response = await api.post('/payment/create-subscription-session');
            window.location.href = response.data.url;
        } catch (error: any) {
            console.error('Subscription error:', error);
            alert(error.response?.data?.error || 'Failed to start subscription');
            setLoading(false);
        }
    };

    const handleCancel = async () => {
        if (!window.confirm('Are you sure you want to cancel your subscription? You will lose access at the end of the billing period.')) return;

        setLoading(true);
        try {
            await api.post('/payment/cancel-subscription');
            alert('Subscription canceled. It will remain active until the end of the period.');
            // Refresh status
            const response = await api.get('/payment/subscription-status');
            setSubscription(response.data);
        } catch (error: any) {
            console.error('Cancellation error:', error);
            alert(error.response?.data?.error || 'Failed to cancel subscription');
        } finally {
            setLoading(false);
        }
    };

    const isSubscribed = subscription && subscription.status === 'active';

    return (
        <div className="min-h-screen bg-dark-bg text-text-primary">
            <header className="bg-dark-card border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center">
                    <button
                        onClick={() => navigate('/')}
                        className="mr-4 p-2 hover:bg-gray-800 rounded-full transition-colors text-white"
                    >
                        <i className="ri-arrow-left-line text-xl"></i>
                    </button>
                    <h2 className="text-xl font-bold text-white">Membership Plans</h2>
                </div>
            </header>

            <main className="p-4 md:p-6 max-w-4xl mx-auto">
                <div className="bg-dark-card rounded-xl shadow-lg overflow-hidden border border-gray-800">
                    <div className="p-8 text-center">
                        <h3 className="text-2xl font-bold text-primary mb-4">Plano Mensal</h3>
                        <p className="text-text-secondary mb-6">
                            Get unlimited haircuts and priority booking with our exclusive monthly membership.
                        </p>
                        <div className="text-4xl font-bold text-white mb-6">
                            R$ 70.00 <span className="text-lg text-text-muted font-normal">/ month</span>
                        </div>

                        <ul className="text-left max-w-xs mx-auto space-y-3 mb-8 text-text-secondary">
                            <li className="flex items-center">
                                <i className="ri-check-line text-primary mr-2 text-xl"></i>
                                Unlimited Haircuts
                            </li>
                            <li className="flex items-center">
                                <i className="ri-check-line text-primary mr-2 text-xl"></i>
                                Priority Booking
                            </li>
                            <li className="flex items-center">
                                <i className="ri-check-line text-primary mr-2 text-xl"></i>
                                Cancel Anytime
                            </li>
                        </ul>

                        {isSubscribed ? (
                            <div className="space-y-6">
                                <MembershipCard
                                    status={subscription.status}
                                    creditsHaircut={subscription.credits_haircut || 0}
                                    creditsBeard={subscription.credits_beard || 0}
                                    currentPeriodEnd={subscription.currentPeriodEnd}
                                />

                                {subscription.status === 'active' && (
                                    <div className="text-center">
                                        <button
                                            onClick={handleCancel}
                                            disabled={loading}
                                            className="text-red-500 hover:text-red-400 text-sm font-medium underline transition-colors"
                                        >
                                            {loading ? 'Processing...' : 'Cancel Subscription'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={handleSubscribe}
                                disabled={loading}
                                className={`w-full md:w-auto px-8 py-3 rounded-lg font-bold text-black transition-colors ${loading
                                    ? 'bg-gray-600 cursor-not-allowed'
                                    : 'bg-primary hover:bg-yellow-400 shadow-lg hover:shadow-primary/20'
                                    }`}
                            >
                                {loading ? 'Processing...' : 'Subscribe Now'}
                            </button>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default PlansPage;
