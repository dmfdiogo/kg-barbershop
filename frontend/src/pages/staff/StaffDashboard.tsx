import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import RescheduleModal from '../../components/RescheduleModal';

const StaffDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [appointments, setAppointments] = useState<any[]>([]);
    const [schedules, setSchedules] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('appointments');
    const [loading, setLoading] = useState(false);
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
    const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);

    const fetchAppointments = async () => {
        try {
            const response = await api.get('/appointments');
            setAppointments(response.data);
        } catch (error) {
            console.error('Failed to fetch appointments');
        }
    };

    useEffect(() => {
        const fetchSchedule = async () => {
            try {
                const response = await api.get('/schedule');
                if (response.data.length === 0) {
                    const defaultSchedule = Array.from({ length: 7 }, (_, i) => ({
                        dayOfWeek: i,
                        startTime: '09:00',
                        endTime: '17:00',
                        isAvailable: i > 0 && i < 6 // Mon-Fri default
                    }));
                    setSchedules(defaultSchedule);
                } else {
                    setSchedules(response.data);
                }
            } catch (error) {
                console.error('Failed to fetch schedule');
            }
        };

        fetchAppointments();
        fetchSchedule();
    }, []);

    const handleSaveSchedule = async () => {
        setLoading(true);
        try {
            await api.post('/schedule', { schedules });
            // Show success message (maybe a toast later)
            alert('Schedule updated successfully');
        } catch (error) {
            console.error('Failed to update schedule');
            alert('Failed to update schedule');
        } finally {
            setLoading(false);
        }
    };

    const updateScheduleItem = (index: number, field: string, value: any) => {
        const newSchedules = [...schedules];
        newSchedules[index] = { ...newSchedules[index], [field]: value };
        setSchedules(newSchedules);
    };

    const handleRescheduleClick = (appt: any) => {
        setSelectedAppointment(appt);
        setIsRescheduleModalOpen(true);
    };

    const handleRescheduleSuccess = () => {
        fetchAppointments();
    };

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-gray-900 text-white flex flex-col">
                <div className="h-16 flex items-center justify-center border-b border-gray-800">
                    <h1 className="text-xl font-bold">Barber Panel</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveTab('appointments')}
                        className={`w-full flex items-center px-4 py-2 rounded text-left ${activeTab === 'appointments' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                    >
                        <span className="mr-3">📅</span> My Appointments
                    </button>
                    <button
                        onClick={() => setActiveTab('schedule')}
                        className={`w-full flex items-center px-4 py-2 rounded text-left ${activeTab === 'schedule' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                    >
                        <span className="mr-3">⏰</span> Manage Schedule
                    </button>
                </nav>
                <div className="p-4 border-t border-gray-800">
                    <button onClick={logout} className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-red-400">
                        <span className="mr-3">🚪</span> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <header className="bg-white shadow h-16 flex items-center px-6">
                    <h2 className="text-xl font-semibold text-gray-800">Welcome, {user?.name}</h2>
                </header>

                <main className="p-6">
                    {activeTab === 'appointments' && (
                        <div>
                            <h3 className="text-lg font-medium text-gray-700 mb-4">Upcoming Appointments</h3>
                            <div className="bg-white rounded-lg shadow overflow-hidden">
                                {appointments.length === 0 ? (
                                    <div className="p-6 text-gray-500">No upcoming appointments.</div>
                                ) : (
                                    <ul className="divide-y divide-gray-200">
                                        {appointments.map((item: any) => (
                                            <li key={item.id} className="p-6 hover:bg-gray-50">
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {item.service.name} with {item.customer.name}
                                                        </p>
                                                        <p className="text-sm text-gray-500">
                                                            {new Date(item.startTime).toLocaleString()}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center space-x-4">
                                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                                            }`}>
                                                            {item.status}
                                                        </span>
                                                        {item.status !== 'CANCELLED' && (
                                                            <button
                                                                onClick={() => handleRescheduleClick(item)}
                                                                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                                            >
                                                                Reschedule
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'schedule' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-medium text-gray-700">Weekly Schedule</h3>
                                <button
                                    onClick={handleSaveSchedule}
                                    disabled={loading}
                                    className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition-colors disabled:opacity-50"
                                >
                                    {loading ? 'Saving...' : 'Save Schedule'}
                                </button>
                            </div>

                            <div className="bg-white rounded-lg shadow overflow-hidden">
                                <ul className="divide-y divide-gray-200">
                                    {schedules.map((item, index) => (
                                        <li key={item.dayOfWeek} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                            <div className="w-32 font-medium text-gray-900">{days[item.dayOfWeek]}</div>

                                            <div className="flex items-center space-x-4">
                                                <label className="flex items-center cursor-pointer">
                                                    <div className="relative">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only"
                                                            checked={item.isAvailable}
                                                            onChange={(e) => updateScheduleItem(index, 'isAvailable', e.target.checked)}
                                                        />
                                                        <div className={`block w-10 h-6 rounded-full ${item.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                                        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition ${item.isAvailable ? 'transform translate-x-4' : ''}`}></div>
                                                    </div>
                                                    <div className="ml-3 text-gray-700 text-sm font-medium">
                                                        {item.isAvailable ? 'Available' : 'Off'}
                                                    </div>
                                                </label>

                                                {item.isAvailable && (
                                                    <div className="flex items-center space-x-2">
                                                        <input
                                                            type="time"
                                                            value={item.startTime}
                                                            onChange={(e) => updateScheduleItem(index, 'startTime', e.target.value)}
                                                            className="border border-gray-300 rounded px-2 py-1 text-sm"
                                                        />
                                                        <span className="text-gray-500">to</span>
                                                        <input
                                                            type="time"
                                                            value={item.endTime}
                                                            onChange={(e) => updateScheduleItem(index, 'endTime', e.target.value)}
                                                            className="border border-gray-300 rounded px-2 py-1 text-sm"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
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
        </div>
    );
};

export default StaffDashboard;
