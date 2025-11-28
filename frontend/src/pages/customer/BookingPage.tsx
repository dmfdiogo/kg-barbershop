import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import dayjs from 'dayjs';
import { DESIGN } from '../../theme/design';
import { formatTime } from '../../utils/date';

import PageLayout from '../../components/PageLayout';
import SelectionModal from '../../components/SelectionModal';
import DatePickerModal from '../../components/DatePickerModal';
import TimePickerModal from '../../components/TimePickerModal';

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
    const [selectedService, setSelectedService] = useState<any | null>(null);
    const [selectedBarber, setSelectedBarber] = useState<any | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>('');

    // Modals
    const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
    const [isBarberModalOpen, setIsBarberModalOpen] = useState(false);
    const [isDateModalOpen, setIsDateModalOpen] = useState(false);
    const [isTimeModalOpen, setIsTimeModalOpen] = useState(false);

    const [paymentMethod, setPaymentMethod] = useState<'STRIPE' | 'CASH'>('STRIPE');
    const [subscription, setSubscription] = useState<any>(null);
    const isSubscribed = subscription && (subscription.status === 'active' || subscription.status === 'canceled_at_period_end');

    // Check if selected service is covered by subscription
    const isServiceCovered = (service: any) => {
        if (!isSubscribed || !service || !shop) return false;

        if (service.type === 'HAIRCUT') {
            return (subscription.credits_haircut || 0) > 0;
        }
        if (service.type === 'BEARD') {
            return (subscription.credits_beard || 0) > 0;
        }
        return false;
    };

    const coveredByPlan = isServiceCovered(selectedService);

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
                            barberId: selectedBarber.id,
                            serviceId: selectedService.id,
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
            // If covered by plan, force SUBSCRIPTION method (backend handles credit deduction)
            const finalPaymentMethod = coveredByPlan ? 'SUBSCRIPTION' : paymentMethod;

            // Create appointment
            const response = await api.post('/appointments', {
                shopId: shop.id,
                barberId: selectedBarber.id,
                serviceId: selectedService.id,
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
        <PageLayout
            title={`Book at ${shop?.name}`}
            showBack
            className="p-4 md:p-6 max-w-2xl mx-auto pb-24"
        >
            <div className={`${DESIGN.card.base} ${DESIGN.card.padding}`}>
                {error && (
                    <div className={`${DESIGN.badge.error} px-4 py-3 rounded mb-6`}>
                        {error}
                    </div>
                )}

                <form onSubmit={onFinish} className="space-y-8">
                    {/* Service Selection */}
                    <div>
                        <label className={DESIGN.text.label}>Service</label>
                        <div
                            onClick={() => setIsServiceModalOpen(true)}
                            className={`${DESIGN.input.base} cursor-pointer flex justify-between items-center`}
                        >
                            {selectedService ? (
                                <span className="text-white">{selectedService.name} - ${selectedService.price}</span>
                            ) : (
                                <span className="text-text-muted">Select a service</span>
                            )}
                            <i className="ri-arrow-down-s-line text-text-muted"></i>
                        </div>
                    </div>

                    {/* Barber Selection */}
                    <div>
                        <label className={DESIGN.text.label}>Barber</label>
                        <div
                            onClick={() => setIsBarberModalOpen(true)}
                            className={`${DESIGN.input.base} cursor-pointer flex justify-between items-center`}
                        >
                            {selectedBarber ? (
                                <span className="text-white">{selectedBarber.user.name}</span>
                            ) : (
                                <span className="text-text-muted">Select a barber</span>
                            )}
                            <i className="ri-arrow-down-s-line text-text-muted"></i>
                        </div>
                    </div>

                    {/* Date Selection */}
                    <div>
                        <label className={DESIGN.text.label}>Date</label>
                        <div
                            onClick={() => setIsDateModalOpen(true)}
                            className={`${DESIGN.input.base} cursor-pointer flex justify-between items-center`}
                        >
                            {selectedDate ? (
                                <span className="text-white">{dayjs(selectedDate).format('DD/MM/YYYY')}</span>
                            ) : (
                                <span className="text-text-muted">Select a date</span>
                            )}
                            <i className="ri-calendar-line text-text-muted"></i>
                        </div>
                    </div>

                    {/* Time Selection */}
                    <div>
                        <label className={DESIGN.text.label}>Time</label>
                        <div
                            onClick={() => {
                                if (selectedService && selectedBarber && selectedDate) {
                                    setIsTimeModalOpen(true);
                                } else {
                                    setError('Please select Service, Barber, and Date first.');
                                }
                            }}
                            className={`${DESIGN.input.base} cursor-pointer flex justify-between items-center ${(!selectedService || !selectedBarber || !selectedDate) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {selectedSlot ? (
                                <span className="text-white">{formatTime(selectedSlot)}</span>
                            ) : (
                                <span className="text-text-muted">Select a time</span>
                            )}
                            <i className="ri-time-line text-text-muted"></i>
                        </div>
                    </div>

                    {/* Payment Method */}
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

                    {!selectedSlot && (
                        <p className="text-center text-sm text-text-secondary mb-2">
                            Please select a time slot to continue
                        </p>
                    )}
                    <button
                        type="submit"
                        disabled={submitting || !selectedSlot}
                        className={`w-full ${DESIGN.button.primary} text-lg mt-8`}
                    >
                        {submitting ? 'Booking...' : (coveredByPlan ? 'Book with Membership' : (paymentMethod === 'STRIPE' ? 'Proceed to Payment' : 'Confirm Booking'))}
                    </button>
                </form>
            </div>

            {/* Service Modal */}
            <SelectionModal
                isOpen={isServiceModalOpen}
                onClose={() => setIsServiceModalOpen(false)}
                title="Select Service"
                items={shop?.services || []}
                keyExtractor={(item: any) => item.id}
                onSelect={(item) => setSelectedService(item)}
                renderItem={(s: any) => {
                    const isCovered = isServiceCovered(s);
                    return (
                        <div className={`${DESIGN.selectionCard.base} ${selectedService?.id === s.id ? DESIGN.selectionCard.selected : DESIGN.selectionCard.unselected}`}>
                            {s.imageUrl && (
                                <img
                                    src={s.imageUrl}
                                    alt={s.name}
                                    className="w-16 h-16 object-cover rounded-lg mr-4"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                            )}
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-semibold text-white">{s.name}</h3>
                                    <div className="text-right">
                                        {isCovered ? (
                                            <div>
                                                <span className="block text-primary font-bold text-sm">Free</span>
                                                <span className="text-xs text-text-muted line-through">${s.price}</span>
                                            </div>
                                        ) : (
                                            <span className="font-bold text-white">${s.price}</span>
                                        )}
                                    </div>
                                </div>
                                <p className="text-sm text-text-muted">{s.duration} mins</p>
                            </div>
                        </div>
                    );
                }}
            />

            {/* Barber Modal */}
            <SelectionModal
                isOpen={isBarberModalOpen}
                onClose={() => setIsBarberModalOpen(false)}
                title="Select Barber"
                items={shop?.staff || []}
                keyExtractor={(item: any) => item.id}
                onSelect={(item) => setSelectedBarber(item)}
                renderItem={(s: any) => (
                    <div className={`${DESIGN.selectionCard.base} ${selectedBarber?.id === s.id ? DESIGN.selectionCard.selected : DESIGN.selectionCard.unselected} flex items-center`}>
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center mr-3 text-white font-bold">
                            {s.user.name.charAt(0)}
                        </div>
                        <span className="text-white font-medium">{s.user.name}</span>
                    </div>
                )}
            />

            {/* Date Modal */}
            <DatePickerModal
                isOpen={isDateModalOpen}
                onClose={() => setIsDateModalOpen(false)}
                onSelect={(date) => setSelectedDate(date)}
                selectedDate={selectedDate}
            />

            {/* Time Modal */}
            <TimePickerModal
                isOpen={isTimeModalOpen}
                onClose={() => setIsTimeModalOpen(false)}
                onSelect={(time) => setSelectedSlot(time)}
                slots={availableSlots}
                selectedSlot={selectedSlot}
            />
        </PageLayout>
    );
};

export default BookingPage;
