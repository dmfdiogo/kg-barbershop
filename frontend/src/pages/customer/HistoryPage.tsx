import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import dayjs from 'dayjs';
import RescheduleModal from '../../components/RescheduleModal';

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
        <div className="min-h-screen bg-dark-bg text-text-primary">
            <header className="bg-dark-card border-b border-gray-800 px-6 py-4 flex items-center sticky top-0 z-10">
                <button
                    onClick={() => navigate('/')}
                    className="mr-4 p-2 hover:bg-gray-800 rounded-full transition-colors text-white"
                >
                    <i className="ri-arrow-left-line text-xl"></i>
                </button>
                <h2 className="text-xl font-bold text-white">My Appointments</h2>

            </header>

            <main className="p-4 md:p-6 max-w-4xl mx-auto">
                {loading ? (
                    <div className="text-center py-10 text-text-secondary">Loading...</div>
                ) : appointments.length === 0 ? (
                    <div className="text-center py-10 bg-dark-card rounded-xl shadow border border-gray-800">
                        <p className="text-text-secondary mb-4">You haven't booked any appointments yet.</p>
                        <button
                            onClick={() => navigate('/')}
                            className="bg-primary text-black font-bold px-4 py-2 rounded hover:bg-yellow-400 transition-colors"
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
                                <div key={appt.id} className="bg-dark-card p-6 rounded-xl shadow-md flex flex-col md:flex-row justify-between items-start md:items-center border border-gray-800">
                                    <div>
                                        <h3 className="text-lg font-bold text-white">{appt.shop.name}</h3>
                                        <p className="text-text-secondary">{appt.service.name} with {appt.barber.user.name}</p>
                                        <p className="text-sm text-text-muted mt-1">
                                            {dayjs(appt.startTime).format('MMMM D, YYYY [at] h:mm A')}
                                        </p>
                                    </div>
                                    <div className="mt-4 md:mt-0 flex flex-col md:flex-row items-end md:items-center gap-4">
                                        <div className="flex items-center">
                                            <div className="flex flex-col items-end mr-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${appt.status === 'CONFIRMED' ? 'bg-green-900/30 text-green-400' :
                                                    appt.status === 'PENDING' ? 'bg-yellow-900/30 text-yellow-400' :
                                                        'bg-red-900/30 text-red-400'
                                                    }`}>
                                                    {appt.status}
                                                </span>
                                                <span className="text-xs text-text-muted mt-1">
                                                    {appt.paymentMethod} - {appt.paymentStatus}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-white">${appt.service.price}</p>
                                                <p className="text-xs text-text-muted">{appt.service.duration} mins</p>
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
