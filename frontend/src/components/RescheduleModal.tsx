import React, { useState, useEffect } from 'react';
import api from '../services/api';
import dayjs from 'dayjs';

interface RescheduleModalProps {
    appointment: any;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

const RescheduleModal: React.FC<RescheduleModalProps> = ({ appointment, isOpen, onClose, onSuccess }) => {
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [availableSlots, setAvailableSlots] = useState<string[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSelectedDate('');
            setAvailableSlots([]);
            setSelectedSlot(null);
            setError('');
        }
    }, [isOpen]);

    useEffect(() => {
        const fetchAvailability = async () => {
            if (appointment && selectedDate) {
                setLoading(true);
                try {
                    const response = await api.get('/appointments/availability', {
                        params: {
                            barberId: appointment.barberId,
                            serviceId: appointment.serviceId,
                            date: selectedDate
                        }
                    });
                    setAvailableSlots(response.data);
                    setSelectedSlot(null);
                } catch (error) {
                    console.error('Failed to fetch availability');
                } finally {
                    setLoading(false);
                }
            }
        };
        fetchAvailability();
    }, [selectedDate, appointment]);

    const handleReschedule = async () => {
        if (!selectedSlot) return;
        setSubmitting(true);
        setError('');
        try {
            await api.patch(`/appointments/${appointment.id}/reschedule`, {
                newStartTime: selectedSlot
            });
            onSuccess();
            onClose();
        } catch (error: any) {
            setError(error.response?.data?.error || 'Rescheduling failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-900">Reschedule Appointment</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
                </div>

                <div className="mb-4">
                    <p className="text-sm text-gray-600">
                        Current: <span className="font-medium">{dayjs(appointment.startTime).format('MMM D, HH:mm')}</span>
                    </p>
                    <p className="text-sm text-gray-600">
                        Service: <span className="font-medium">{appointment.service.name}</span> ({appointment.service.duration}m)
                    </p>
                </div>

                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Select New Date</label>
                        <input
                            type="date"
                            min={dayjs().add(1, 'day').format('YYYY-MM-DD')} // Enforce > 24h rule visually? Or just allow any future date and let backend validate? 
                            // Backend validates 24h rule for the *existing* appointment, not the new one.
                            // But for the new one, it must be in the future.
                            // Let's just use tomorrow as min for simplicity, or today if we want to allow same-day rescheduling (if backend allows).
                            // Backend says: "Cannot reschedule appointments less than 24 hours in advance" -> This refers to the OLD appointment time vs NOW.
                            // It doesn't restrict the NEW time, other than it being in the future and available.
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-black focus:border-black outline-none"
                            onChange={(e) => setSelectedDate(e.target.value)}
                            value={selectedDate}
                        />
                    </div>

                    {selectedDate && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Available Slots</label>
                            {loading ? (
                                <div className="text-center text-gray-500 text-sm">Loading slots...</div>
                            ) : availableSlots.length === 0 ? (
                                <p className="text-gray-500 text-sm italic">No slots available.</p>
                            ) : (
                                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                                    {availableSlots.map(slot => (
                                        <button
                                            key={slot}
                                            onClick={() => setSelectedSlot(slot)}
                                            className={`py-1 px-2 rounded text-xs font-medium transition-colors ${selectedSlot === slot
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
                        onClick={handleReschedule}
                        disabled={submitting || !selectedSlot}
                        className="w-full bg-black text-white py-2 px-4 rounded hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold mt-4"
                    >
                        {submitting ? 'Confirming...' : 'Confirm Reschedule'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RescheduleModal;
