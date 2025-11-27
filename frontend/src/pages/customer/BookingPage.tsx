import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import dayjs from 'dayjs';
import { DESIGN } from '../../theme/design';
import { formatTime } from '../../utils/date';

import PageHeader from '../../components/PageHeader';

const BookingPage: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [shop, setShop] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [availableSlots, setAvailableSlots] = useState<string[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
    const [error, setError] = useState('');

    // Form values
    const [selectedService, setSelectedService] = useState<number | null>(null);
    const [selectedBarber, setSelectedBarber] = useState<number | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>('');

    const [paymentMethod, setPaymentMethod] = useState<'STRIPE' | 'CASH'>('STRIPE');
    const [subscription, setSubscription] = useState<any>(null);
    const isSubscribed = subscription && (subscription.status === 'active' || subscription.status === 'canceled_at_period_end');

    // Check if selected service is covered by subscription
    const isServiceCovered = () => {
        if (!isSubscribed || !selectedService || !shop) return false;
        const service = shop.services.find((s: any) => s.id === selectedService);
        if (!service) return false;

        if (service.type === 'HAIRCUT') {
            return (subscription.credits_haircut || 0) > 0;
        }
        if (service.type === 'BEARD') {
            return (subscription.credits_beard || 0) > 0;
        }
        return false;
    };

    const coveredByPlan = isServiceCovered();

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

    useEffect(() => {
        const fetchShop = async () => {
            try {
                const response = await api.get(`/shops/${slug}`);
                setShop(response.data);
            } catch (error) {
                console.error('Failed to load shop details');
                navigate('/');
            } finally {
                setLoading(false);
            }
        };
        fetchShop();
    }, [slug, navigate]);

    useEffect(() => {
        const fetchAvailability = async () => {
            if (selectedService && selectedBarber && selectedDate) {
                try {
                    const response = await api.get('/appointments/availability', {
                        params: {
                            barberId: selectedBarber,
                            serviceId: selectedService,
                            date: selectedDate
                        }
                    });
                    setAvailableSlots(response.data);
                    setSelectedSlot(null);
                } catch (error) {
                    console.error('Failed to fetch availability');
                }
            }
        };
        fetchAvailability();
    }, [selectedService, selectedBarber, selectedDate]);

    const onFinish = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedSlot) {
            setError('Please select a time slot');
            return;
        }
        if (!shop || !selectedBarber || !selectedService) {
            setError('Please select a shop, barber, and service.');
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            // If covered by plan, force STRIPE method (backend handles credit deduction)
            // or we could use a specific 'SUBSCRIPTION' method if backend supported it explicitly
            const finalPaymentMethod = coveredByPlan ? 'STRIPE' : paymentMethod;

            // Create appointment
            const response = await api.post('/appointments', {
                shopId: shop.id,
                barberId: selectedBarber,
                serviceId: selectedService,
                startTime: selectedSlot,
                paymentMethod: finalPaymentMethod,
            });

            const appointmentId = response.data.id;

            if (coveredByPlan) {
                alert('Appointment booked with your membership!');
                navigate('/history');
                return;
            }

            if (finalPaymentMethod === 'STRIPE') {
                // Initiate payment
                try {
                    const paymentResponse = await api.post('/payment/create-checkout-session', {
                        appointmentId
                    });

                    // Redirect to Stripe
                    window.location.href = paymentResponse.data.url;
                } catch (paymentError: any) {
                    console.error('Payment initiation failed', paymentError);
                    const errorMessage = paymentError.response?.data?.error || 'Payment failed';
                    alert(`Appointment created but payment failed: ${errorMessage}. Please check your appointments.`);
                    navigate('/history');
                }
            } else {
                // Cash payment - just redirect to history
                alert('Appointment booked successfully!');
                navigate('/history');
            }
        } catch (error: any) {
            console.error('Booking failed', error);
            setError(error.response?.data?.error || 'Booking failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center items-center h-screen">Loading...</div>;

    return (
        <div className={DESIGN.layout.pageContainer}>
            <PageHeader title={`Book at ${shop?.name}`} showBack />

            <main className="p-4 md:p-6 max-w-2xl mx-auto">
                <div className={`${DESIGN.card.base} ${DESIGN.card.padding}`}>
                    {error && (
                        <div className={`${DESIGN.badge.error} px-4 py-3 rounded mb-6`}>
                            {error}
                        </div>
                    )}

                    <form onSubmit={onFinish} className="space-y-8">
                        <div>
                            <label className={DESIGN.text.label}>Select Service</label>
                            <div className="grid grid-cols-1 gap-4">
                                {shop?.services.map((s: any) => {
                                    const isCovered = isSubscribed && (
                                        (s.type === 'HAIRCUT' && (subscription.credits_haircut || 0) > 0) ||
                                        (s.type === 'BEARD' && (subscription.credits_beard || 0) > 0)
                                    );

                                    return (<div
                                        key={s.id}
                                        onClick={() => setSelectedService(s.id)}
                                        className={`${DESIGN.selectionCard.base} ${selectedService === s.id ? DESIGN.selectionCard.selected : DESIGN.selectionCard.unselected}`}
                                    >
                                        {s.imageUrl && (
                                            <img
                                                src={s.imageUrl}
                                                alt={s.name}
                                                className="w-24 h-24 object-cover rounded-lg"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                }}
                                            />
                                        )}
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className="font-semibold text-lg text-white">{s.name}</h3>
                                                <div className="text-right">
                                                    {isCovered ? (
                                                        <div>
                                                            <span className="block text-primary font-bold">Free with Plan</span>
                                                            <span className="text-xs text-text-muted line-through">${s.price}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="font-bold text-lg text-white">${s.price}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <p className={`text-sm ${DESIGN.text.body} mt-1`}>{s.duration} mins</p>
                                            {s.description && (
                                                <p className={`text-sm ${DESIGN.text.muted} mt-2`}>{s.description}</p>
                                            )}
                                        </div>
                                    </div>
                                    )
                                })}
                            </div>
                        </div>

                        <div>
                            <label className={DESIGN.text.label}>Select Barber</label>
                            <select
                                required
                                className={DESIGN.input.select}
                                onChange={(e) => setSelectedBarber(Number(e.target.value))}
                                value={selectedBarber || ''}
                            >
                                <option value="">Choose a barber</option>
                                {shop?.staff.map((s: any) => (
                                    <option key={s.id} value={s.id}>{s.user.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className={DESIGN.text.label}>Select Date</label>
                            <input
                                type="date"
                                required
                                min={dayjs().format('YYYY-MM-DD')}
                                className={DESIGN.input.base}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                value={selectedDate}
                            />
                        </div>

                        {selectedService && selectedBarber && selectedDate && (
                            <div className="pt-4">
                                <h4 className={`${DESIGN.text.subHeader} text-lg mb-3`}>Available Slots</h4>
                                {availableSlots.length === 0 ? (
                                    <p className={`${DESIGN.text.muted} italic`}>No slots available for this date.</p>
                                ) : (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                        {availableSlots.map(slot => (
                                            <button
                                                key={slot}
                                                type="button"
                                                onClick={() => setSelectedSlot(slot)}
                                                className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${selectedSlot === slot
                                                    ? 'bg-primary text-black font-bold'
                                                    : 'bg-dark-input text-text-secondary hover:bg-gray-700'
                                                    }`}
                                            >
                                                {formatTime(slot)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <label className={DESIGN.text.label}>Payment Method</label>
                            {coveredByPlan ? (
                                <div className={`${DESIGN.card.base} bg-primary/10 border-primary border p-4 flex items-center`}>
                                    <i className="ri-vip-crown-fill text-2xl text-primary mr-4"></i>
                                    <div>
                                        <h4 className="font-bold text-white">Covered by Membership</h4>
                                        <p className="text-sm text-gray-400">1 credit will be deducted from your balance.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-4">
                                    <div
                                        onClick={() => setPaymentMethod('STRIPE')}
                                        className={`${DESIGN.selectionCard.base} flex-col text-center justify-center ${paymentMethod === 'STRIPE' ? DESIGN.selectionCard.selected : DESIGN.selectionCard.unselected}`}
                                    >
                                        <span className="font-bold block text-white">Pay Online</span>
                                        <span className={`text-xs ${DESIGN.text.muted}`}>Credit/Debit Card</span>
                                    </div>
                                    <div
                                        onClick={() => setPaymentMethod('CASH')}
                                        className={`${DESIGN.selectionCard.base} flex-col text-center justify-center ${paymentMethod === 'CASH' ? DESIGN.selectionCard.selected : DESIGN.selectionCard.unselected}`}
                                    >
                                        <span className="font-bold block text-white">Pay in Cash</span>
                                        <span className={`text-xs ${DESIGN.text.muted}`}>Pay at the shop</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !selectedSlot}
                            className={`w-full ${DESIGN.button.primary} text-lg mt-8`}
                        >
                            {submitting ? 'Booking...' : (coveredByPlan ? 'Book with Membership' : (paymentMethod === 'STRIPE' ? 'Proceed to Payment' : 'Confirm Booking'))}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
};

export default BookingPage;
