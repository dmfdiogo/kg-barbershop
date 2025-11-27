import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import dayjs from 'dayjs';
import RescheduleModal from '../../components/RescheduleModal';
import { DESIGN } from '../../theme/design';
import { formatDateTime } from '../../utils/date';

import PageHeader from '../../components/PageHeader';

const HistoryPage: React.FC = () => {
    const navigate = useNavigate();
    const [appointments, setAppointments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
    const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);

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

    return (
        <div className={DESIGN.layout.pageContainer}>
            <PageHeader title="My Appointments" showBack />

            <main className="p-4 md:p-6 max-w-4xl mx-auto">
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
                        {appointments.map((appt) => {
                            const isFuture = dayjs(appt.startTime).isAfter(dayjs());
                            const hoursDiff = dayjs(appt.startTime).diff(dayjs(), 'hour');
                            const canReschedule = isFuture && hoursDiff >= 24;

                            return (
                                <div key={appt.id} className={`${DESIGN.card.base} p-6 flex flex-col md:flex-row justify-between items-start md:items-center`}>
                                    <div>
                                        <h3 className="text-lg font-bold text-white">{appt.shop.name}</h3>
                                        <p className={DESIGN.text.body}>{appt.service.name} with {appt.barber.user.name}</p>
                                        <p className={`text-sm ${DESIGN.text.muted} mt-1`}>
                                            {formatDateTime(appt.startTime)}
                                        </p>
                                    </div>
                                    <div className="mt-4 md:mt-0 flex flex-col md:flex-row items-end md:items-center gap-4">
                                        <div className="flex items-center">
                                            <div className="flex flex-col items-end mr-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${appt.status === 'CONFIRMED' ? DESIGN.badge.success :
                                                    appt.status === 'PENDING' ? DESIGN.badge.warning :
                                                        DESIGN.badge.error
                                                    }`}>
                                                    {appt.status}
                                                </span>
                                                <span className={`text-xs ${DESIGN.text.muted} mt-1`}>
                                                    {appt.paymentMethod} - {appt.paymentStatus}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-white">${appt.service.price}</p>
                                                <p className={`text-xs ${DESIGN.text.muted}`}>{appt.service.duration} mins</p>
                                            </div>
                                        </div>

                                        {isFuture && appt.status !== 'CANCELLED' && (
                                            <button
                                                onClick={() => handleRescheduleClick(appt)}
                                                disabled={!canReschedule}
                                                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${canReschedule
                                                    ? 'bg-dark-input text-white hover:bg-gray-700'
                                                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                                    }`}
                                                title={!canReschedule ? "Cannot reschedule less than 24h in advance" : ""}
                                            >
                                                Reschedule
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {selectedAppointment && (
                <RescheduleModal
                    appointment={selectedAppointment}
                    isOpen={isRescheduleModalOpen}
                    onClose={() => setIsRescheduleModalOpen(false)}
                    onSuccess={handleRescheduleSuccess}
                />
            )}
        </div>
    );
};

export default HistoryPage;
