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
        setSubmitting(true);
        setError('');
        try {
            await api.post('/appointments', {
                shopId: shop.id,
                barberId: selectedBarber,
                serviceId: selectedService,
                startTime: selectedSlot,
            });
            navigate('/');
        } catch (error: any) {
            setError(error.response?.data?.error || 'Booking failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center items-center h-screen">Loading...</div>;

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow px-6 py-4 flex items-center">
                <button
                    onClick={() => navigate('/')}
                    className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                    ←
                </button>
                <h2 className="text-xl font-bold text-gray-800">Book at {shop?.name}</h2>
            </header>

            <main className="p-6 max-w-2xl mx-auto">
                <div className="bg-white rounded-lg shadow-lg p-8">
                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
                            {error}
                        </div>
                    )}

                    <form onSubmit={onFinish} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Select Service</label>
                            <select
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-black focus:border-black outline-none bg-white"
                                onChange={(e) => setSelectedService(Number(e.target.value))}
                                value={selectedService || ''}
                            >
                                <option value="">Choose a service</option>
                                {shop?.services.map((s: any) => (
                                    <option key={s.id} value={s.id}>{s.name} - ${s.price} ({s.duration}m)</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Select Barber</label>
                            <select
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-black focus:border-black outline-none bg-white"
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
                            <label className="block text-sm font-medium text-gray-700 mb-1">Select Date</label>
                            <input
                                type="date"
                                required
                                min={dayjs().format('YYYY-MM-DD')}
                                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-black focus:border-black outline-none"
                                onChange={(e) => setSelectedDate(e.target.value)}
                                value={selectedDate}
                            />
                        </div>

                        {selectedService && selectedBarber && selectedDate && (
                            <div className="pt-4">
                                <h4 className="text-lg font-medium text-gray-900 mb-3">Available Slots</h4>
                                {availableSlots.length === 0 ? (
                                    <p className="text-gray-500 italic">No slots available for this date.</p>
                                ) : (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                        {availableSlots.map(slot => (
                                            <button
                                                key={slot}
                                                type="button"
                                                onClick={() => setSelectedSlot(slot)}
                                                className={`py-2 px-3 rounded text-sm font-medium transition-colors ${selectedSlot === slot
                                                        ? 'bg-black text-white'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {dayjs(slot).format('HH:mm')}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={submitting || !selectedSlot}
                            className="w-full bg-black text-white py-3 px-4 rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg mt-8"
                        >
                            {submitting ? 'Booking...' : 'Confirm Booking'}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
};

export default BookingPage;
