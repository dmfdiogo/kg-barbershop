import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import dayjs from 'dayjs';
import RescheduleModal from '../../components/RescheduleModal';
import { DESIGN } from '../../theme/design';
import { formatDateTime } from '../../utils/date';

import PageLayout from '../../components/PageLayout';

const HistoryPage: React.FC = () => {
    const navigate = useNavigate();
    const [appointments, setAppointments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
    const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
    const [showPast, setShowPast] = useState(false);

    const fetchHistory = async () => {
        try {
            const response = await api.get('/appointments');
            setAppointments(response.data);
        } catch (error) {
            console.error('Failed to fetch history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, []);

    const handleRescheduleClick = (appt: any) => {
        setSelectedAppointment(appt);
        setIsRescheduleModalOpen(true);
    };

    const handleRescheduleSuccess = () => {
        fetchHistory(); // Refresh list
    };

    const filteredAppointments = appointments.filter(appt => {
        if (showPast) return true;
        return dayjs(appt.startTime).isSame(dayjs(), 'day') || dayjs(appt.startTime).isAfter(dayjs());
    });

    return (
        <PageLayout title="My Appointments" showBack className="p-4 md:p-6 w-full">
            {loading ? (
                <div className={`text-center py-10 ${DESIGN.text.body}`}>Loading...</div>
            ) : appointments.length === 0 ? (
                <div className={`text-center py-10 ${DESIGN.card.base}`}>
                    <p className={`${DESIGN.text.body} mb-4`}>You haven't booked any appointments yet.</p>
                    <button
                        onClick={() => navigate('/')}
                        className={DESIGN.button.primary}
                    >
                        Find a Shop
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredAppointments.map((appt) => {
                        const isFuture = dayjs(appt.startTime).isAfter(dayjs());
                        const hoursDiff = dayjs(appt.startTime).diff(dayjs(), 'hour');
                        const canReschedule = isFuture && hoursDiff >= 1; // Relaxed to 1h for testing

                        return (
                            <div key={appt.id} className={`${DESIGN.card.base} p-5`}>
                                {/* Header: Shop Name & Status */}
                                <div className="flex justify-between items-start mb-3">
                                    <h3 className="text-lg font-bold text-white">{appt.shop.name}</h3>
                                    <div className="flex flex-col items-end">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${appt.status === 'CONFIRMED' ? DESIGN.badge.success :
                                            appt.status === 'PENDING' ? DESIGN.badge.warning :
                                                DESIGN.badge.error
                                            }`}>
                                            {appt.status}
                                        </span>
                                        <span className={`text-[10px] ${DESIGN.text.muted} mt-1`}>
                                            {appt.paymentMethod} • {appt.paymentStatus}
                                        </span>
                                    </div>
                                </div>

                                {/* Body: Service Details */}
                                <div className="mb-4">
                                    <p className="text-white font-medium text-lg mb-1">
                                        {appt.service.name}
                                    </p>
                                    <p className={`${DESIGN.text.body} text-sm flex items-center gap-2`}>
                                        <i className="ri-user-line"></i> {appt.barber.user.name}
                                    </p>
                                    <p className={`${DESIGN.text.body} text-sm flex items-center gap-2 mt-1`}>
                                        <i className="ri-calendar-event-line"></i> {formatDateTime(appt.startTime)}
                                    </p>
                                </div>

                                {/* Footer: Price & Actions */}
                                <div className="flex justify-between items-end border-t border-amber-400/10 pt-4 mt-2">
                                    <div>
                                        <p className="font-bold text-white text-lg">${appt.service.price}</p>
                                        <p className={`text-xs ${DESIGN.text.muted}`}>{appt.service.duration} mins</p>
                                    </div>

                                    {isFuture && appt.status !== 'CANCELLED' && (
                                        <button
                                            onClick={() => handleRescheduleClick(appt)}
                                            disabled={!canReschedule}
                                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${canReschedule
                                                ? 'bg-dark-input text-white hover:bg-gray-700 border border-amber-500'
                                                : 'bg-transparent text-gray-600 cursor-not-allowed'
                                                }`}
                                            title={!canReschedule ? "Cannot reschedule less than 1h in advance" : ""}
                                        >
                                            Reschedule
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    <button
                        onClick={() => setShowPast(!showPast)}
                        className={`w-full py-3 text-sm font-medium transition-colors ${DESIGN.text.muted} hover:text-white border border-dashed border-amber-400/10 rounded-xl hover:border-gray-600`}
                    >
                        {showPast ? 'Hide Past Appointments' : 'Show Past Appointments'}
                    </button>
                </div>
            )}
            {selectedAppointment && (
                <RescheduleModal
                    appointment={selectedAppointment}
                    isOpen={isRescheduleModalOpen}
                    onClose={() => setIsRescheduleModalOpen(false)}
                    onSuccess={handleRescheduleSuccess}
                />
            )}
        </PageLayout>
    );
};

export default HistoryPage;
