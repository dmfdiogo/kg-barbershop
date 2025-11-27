import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import MembershipCard from '../../components/MembershipCard';
import { DESIGN } from '../../theme/design';

import PageHeader from '../../components/PageHeader';

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

    const isSubscribed = subscription && subscription.status !== 'canceled';
    const isCanceledAtPeriodEnd = subscription?.status === 'canceled_at_period_end' || (subscription?.status === 'active' && subscription?.cancel_at_period_end);

    return (
        <div className={DESIGN.layout.pageContainer}>
            <PageHeader title="Membership Plans" showBack />

            <main className="p-4 md:p-6 max-w-4xl mx-auto">
                <div className={`${DESIGN.card.base} overflow-hidden`}>
                    <div className="p-8 text-center">

                        {!isSubscribed ? (
                            <>
                                <h3 className="text-2xl font-bold text-primary mb-4">Plano Mensal</h3>
                                <p className={`${DESIGN.text.body} mb-6`}>
                                    Get premium access with our exclusive monthly membership.
                                </p>
                                <div className="text-4xl font-bold text-white mb-6">
                                    R$ 70.00 <span className={`text-lg ${DESIGN.text.muted} font-normal`}>/ month</span>
                                </div>

                                <ul className={`text-left max-w-xs mx-auto space-y-3 mb-8 ${DESIGN.text.body}`}>
                                    <li className="flex items-center">
                                        <i className="ri-check-line text-primary mr-2 text-xl"></i>
                                        2 Haircuts per month
                                    </li>
                                    <li className="flex items-center">
                                        <i className="ri-check-line text-primary mr-2 text-xl"></i>
                                        1 Beard Trim per month
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
                            </>
                        ) : (
                            <div className="space-y-6">
                                <h3 className="text-2xl font-bold text-white mb-6">Your Membership</h3>

                                {subscription.status === 'active' || subscription.status === 'canceled_at_period_end' ? (
                                    <MembershipCard
                                        status={subscription.status}
                                        creditsHaircut={subscription.credits_haircut || 0}
                                        creditsBeard={subscription.credits_beard || 0}
                                        currentPeriodEnd={subscription.currentPeriodEnd}
                                    />
                                ) : (
                                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                                        <p className="text-white font-medium text-lg mb-2">Status: <span className="uppercase text-yellow-500">{subscription.status.replace(/_/g, ' ')}</span></p>
                                        <p className="text-gray-400">Your subscription is currently in a non-active state.</p>
                                    </div>
                                )}

                                {!isCanceledAtPeriodEnd && subscription.status !== 'canceled' && (
                                    <div className="text-center pt-4">
                                        <button
                                            onClick={handleCancel}
                                            disabled={loading}
                                            className="text-red-500 hover:text-red-400 text-sm font-medium underline transition-colors"
                                        >
                                            {loading ? 'Processing...' : 'Cancel Subscription'}
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2">
                                            Cancellation takes effect at the end of the current billing period.
                                        </p>
                                    </div>
                                )}

                                {isCanceledAtPeriodEnd && (
                                    <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-lg">
                                        <p className="text-yellow-500 text-sm">
                                            Your subscription is set to cancel on {new Date(subscription.currentPeriodEnd).toLocaleDateString()}.
                                            You will retain access to your benefits until then.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default PlansPage;
