import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import dayjs from 'dayjs';

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
    const isSubscribed = subscription && subscription.status === 'active';

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
            // isSubscribed is already defined in component scope
            const finalPaymentMethod = isSubscribed ? 'STRIPE' : paymentMethod; // Backend will handle subscription status for 'STRIPE' if applicable

            // Create appointment
            const response = await api.post('/appointments', {
                shopId: shop.id,
                barberId: selectedBarber,
                serviceId: selectedService,
                startTime: selectedSlot,
                paymentMethod: finalPaymentMethod,
            });

            const appointmentId = response.data.id;

            if (isSubscribed) {
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
        <div className="min-h-screen bg-dark-bg text-text-primary">
            <header className="bg-dark-card border-b border-gray-800 px-6 py-4 flex items-center sticky top-0 z-10">
                <button
                    onClick={() => navigate('/')}
                    className="mr-4 p-2 hover:bg-gray-800 rounded-full transition-colors text-white"
                >
                    <i className="ri-arrow-left-line text-xl"></i>
                </button>
                <h2 className="text-xl font-bold text-white">Book at {shop?.name}</h2>
            </header>

            <main className="p-4 md:p-6 max-w-2xl mx-auto">
                <div className="bg-dark-card rounded-xl shadow-lg p-6 md:p-8 border border-gray-800">
                    {error && (
                        <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded mb-6">
                            {error}
                        </div>
                    )}

                    <form onSubmit={onFinish} className="space-y-8">
                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-3">Select Service</label>
                            <div className="grid grid-cols-1 gap-4">
                                {shop?.services.map((s: any) => (
                                    <div
                                        key={s.id}
                                        onClick={() => setSelectedService(s.id)}
                                        className={`border rounded-xl p-4 cursor-pointer transition-all flex ${selectedService === s.id ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-500 bg-dark-input'}`}
                                    >
                                        {s.imageUrl && (
                                            <img
                                                src={s.imageUrl}
                                                alt={s.name}
                                                className="w-24 h-24 object-cover rounded-lg mr-4"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                }}
                                            />
                                        )}
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className="font-semibold text-lg text-white">{s.name}</h3>
                                                <div className="text-right">
                                                    {isSubscribed && (
                                                        (s.name.toLowerCase().includes('hair') && subscription.credits_haircut > 0) ||
                                                        (s.name.toLowerCase().includes('beard') && subscription.credits_beard > 0)
                                                    ) ? (
                                                        <div>
                                                            <span className="block text-primary font-bold">Free with Plan</span>
                                                            <span className="text-xs text-text-muted line-through">${s.price}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="font-bold text-lg text-white">${s.price}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-sm text-text-secondary mt-1">{s.duration} mins</p>
                                            {s.description && (
                                                <p className="text-sm text-text-muted mt-2">{s.description}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1">Select Barber</label>
                            <select
                                required
                                className="w-full px-4 py-3 border border-gray-700 rounded-lg focus:ring-primary focus:border-primary outline-none bg-dark-input text-white"
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
                            <label className="block text-sm font-medium text-text-secondary mb-1">Select Date</label>
                            <input
                                type="date"
                                required
                                min={dayjs().format('YYYY-MM-DD')}
                                className="w-full px-4 py-3 border border-gray-700 rounded-lg focus:ring-primary focus:border-primary outline-none bg-dark-input text-white"
                                onChange={(e) => setSelectedDate(e.target.value)}
                                value={selectedDate}
                            />
                        </div>

                        {selectedService && selectedBarber && selectedDate && (
                            <div className="pt-4">
                                <h4 className="text-lg font-medium text-white mb-3">Available Slots</h4>
                                {availableSlots.length === 0 ? (
                                    <p className="text-text-muted italic">No slots available for this date.</p>
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
                                                {dayjs(slot).format('HH:mm')}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-3">Payment Method</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div
                                    onClick={() => setPaymentMethod('STRIPE')}
                                    className={`border rounded-xl p-4 cursor-pointer text-center transition-all ${paymentMethod === 'STRIPE' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-500 bg-dark-input'}`}
                                >
                                    <span className="font-bold block text-white">Pay Online</span>
                                    <span className="text-xs text-text-muted">Credit/Debit Card</span>
                                </div>
                                <div
                                    onClick={() => setPaymentMethod('CASH')}
                                    className={`border rounded-xl p-4 cursor-pointer text-center transition-all ${paymentMethod === 'CASH' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-500 bg-dark-input'}`}
                                >
                                    <span className="font-bold block text-white">Pay in Cash</span>
                                    <span className="text-xs text-text-muted">Pay at the shop</span>
                                </div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !selectedSlot}
                            className="w-full bg-primary text-black py-4 px-4 rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg mt-8 shadow-lg"
                        >
                            {submitting ? 'Booking...' : (paymentMethod === 'STRIPE' ? 'Proceed to Payment' : 'Confirm Booking')}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
};

export default BookingPage;
