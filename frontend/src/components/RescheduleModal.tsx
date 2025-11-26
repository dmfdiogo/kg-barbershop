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
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 backdrop-blur-sm">
            <div className="bg-dark-card rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 border border-gray-800">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white">Reschedule Appointment</h3>
                    <button onClick={onClose} className="text-text-secondary hover:text-white transition-colors">
                        <i className="ri-close-line text-2xl"></i>
                    </button>
                </div>

                <div className="mb-6 space-y-2">
                    <p className="text-sm text-text-secondary">
                        Current: <span className="font-medium text-white">{dayjs(appointment.startTime).format('MMM D, HH:mm')}</span>
                    </p>
                    <p className="text-sm text-text-secondary">
                        Service: <span className="font-medium text-white">{appointment.service.name}</span> ({appointment.service.duration}m)
                    </p>
                </div>

                {error && (
                    <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">Select New Date</label>
                        <input
                            type="date"
                            min={dayjs().add(1, 'day').format('YYYY-MM-DD')}
                            className="w-full px-4 py-2 border border-gray-700 rounded-lg bg-dark-input text-white focus:ring-primary focus:border-primary outline-none transition-colors"
                            onChange={(e) => setSelectedDate(e.target.value)}
                            value={selectedDate}
                        />
                    </div>

                    {selectedDate && (
                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-3">Available Slots</label>
                            {loading ? (
                                <div className="text-center text-text-muted text-sm py-4">Loading slots...</div>
                            ) : availableSlots.length === 0 ? (
                                <p className="text-text-muted text-sm italic py-2">No slots available.</p>
                            ) : (
                                <div className="grid grid-cols-3 gap-3 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                    {availableSlots.map(slot => (
                                        <button
                                            key={slot}
                                            onClick={() => setSelectedSlot(slot)}
                                            className={`py-2 px-2 rounded-lg text-xs font-bold transition-all ${selectedSlot === slot
                                                ? 'bg-primary text-black shadow-lg shadow-primary/20'
                                                : 'bg-gray-800 text-text-secondary hover:bg-gray-700 hover:text-white'
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
                        className="w-full bg-primary text-black py-3 px-4 rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold shadow-lg hover:shadow-primary/20 mt-2"
                    >
                        {submitting ? 'Confirming...' : 'Confirm Reschedule'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RescheduleModal;
