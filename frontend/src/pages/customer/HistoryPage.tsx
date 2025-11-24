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
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow px-6 py-4 flex items-center">
                <button
                    onClick={() => navigate('/')}
                    className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                    ←
                </button>
                <h2 className="text-xl font-bold text-gray-800">My Appointments</h2>
            </header>

            <main className="p-6 max-w-4xl mx-auto">
                {loading ? (
                    <div className="text-center py-10">Loading...</div>
                ) : appointments.length === 0 ? (
                    <div className="text-center py-10 bg-white rounded-lg shadow">
                        <p className="text-gray-500 mb-4">You haven't booked any appointments yet.</p>
                        <button
                            onClick={() => navigate('/')}
                            className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800"
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
                                <div key={appt.id} className="bg-white p-6 rounded-lg shadow-md flex flex-col md:flex-row justify-between items-start md:items-center">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900">{appt.shop.name}</h3>
                                        <p className="text-gray-600">{appt.service.name} with {appt.barber.user.name}</p>
                                        <p className="text-sm text-gray-500 mt-1">
                                            {dayjs(appt.startTime).format('MMMM D, YYYY [at] h:mm A')}
                                        </p>
                                    </div>
                                    <div className="mt-4 md:mt-0 flex flex-col md:flex-row items-end md:items-center gap-4">
                                        <div className="flex items-center">
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${appt.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' :
                                                appt.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-red-100 text-red-800'
                                                }`}>
                                                {appt.status}
                                            </span>
                                            <div className="ml-4 text-right">
                                                <p className="font-bold text-gray-900">${appt.service.price}</p>
                                                <p className="text-xs text-gray-500">{appt.service.duration} mins</p>
                                            </div>
                                        </div>

                                        {isFuture && appt.status !== 'CANCELLED' && (
                                            <button
                                                onClick={() => handleRescheduleClick(appt)}
                                                disabled={!canReschedule}
                                                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${canReschedule
                                                        ? 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                                                        : 'bg-gray-50 text-gray-400 cursor-not-allowed'
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
