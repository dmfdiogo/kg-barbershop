import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import RescheduleModal from '../../components/RescheduleModal';
import CalendarView from '../../components/CalendarView';

const StaffDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [appointments, setAppointments] = useState<any[]>([]);
    const [schedules, setSchedules] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('appointments');
    const [loading, setLoading] = useState(false);
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
    const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

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
        <div className="flex h-screen bg-dark-bg text-text-primary">
            {/* Sidebar */}
            <div className="w-64 bg-dark-card border-r border-gray-800 flex flex-col">
                <div className="h-16 flex items-center justify-center border-b border-gray-800">
                    <h1 className="text-xl font-bold text-primary">Barber Panel</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveTab('appointments')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'appointments' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-calendar-check-line mr-3 text-lg"></i> My Appointments
                    </button>
                    <button
                        onClick={() => setActiveTab('schedule')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'schedule' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-time-line mr-3 text-lg"></i> Manage Schedule
                    </button>
                </nav>
                <div className="p-4 border-t border-gray-800">
                    <button onClick={logout} className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-red-400 transition-colors">
                        <i className="ri-logout-box-r-line mr-3 text-lg"></i> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <header className="bg-dark-card shadow-md border-b border-gray-800 h-16 flex items-center px-6 sticky top-0 z-10">
                    <h2 className="text-xl font-semibold text-white">Welcome, {user?.name}</h2>
                </header>

                <main className="p-6">
                    {activeTab === 'appointments' && (
                        <div>
                            <div>
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-medium text-text-secondary">Upcoming Appointments</h3>
                                    <div className="flex space-x-2 bg-dark-card rounded-lg p-1 border border-gray-800">
                                        <button
                                            onClick={() => setViewMode('list')}
                                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'list' ? 'bg-primary text-black shadow-sm' : 'text-text-secondary hover:text-white'}`}
                                        >
                                            List
                                        </button>
                                        <button
                                            onClick={() => setViewMode('calendar')}
                                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'calendar' ? 'bg-primary text-black shadow-sm' : 'text-text-secondary hover:text-white'}`}
                                        >
                                            Calendar
                                        </button>
                                    </div>
                                </div>

                                {viewMode === 'list' ? (
                                    <div className="bg-dark-card rounded-xl shadow-lg overflow-hidden border border-gray-800">
                                        {appointments.length === 0 ? (
                                            <div className="p-8 text-center text-text-muted">No upcoming appointments.</div>
                                        ) : (
                                            <ul className="divide-y divide-gray-800">
                                                {appointments.map((item: any) => (
                                                    <li key={item.id} className="p-6 hover:bg-gray-800/50 transition-colors">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <p className="text-lg font-bold text-white">
                                                                    {item.service.name} <span className="text-text-muted font-normal">with</span> {item.customer.name}
                                                                </p>
                                                                <p className="text-sm text-primary mt-1">
                                                                    {new Date(item.startTime).toLocaleString()}
                                                                </p>
                                                                <p className="text-xs text-text-muted mt-1">
                                                                    Payment: <span className="text-text-secondary">{item.paymentMethod}</span> - <span className={item.paymentStatus === 'PAID' ? 'text-green-400' : 'text-yellow-400'}>{item.paymentStatus}</span>
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center space-x-4">
                                                                <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-full ${item.status === 'CONFIRMED' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                                                                    }`}>
                                                                    {item.status}
                                                                </span>
                                                                {item.status !== 'CANCELLED' && (
                                                                    <button
                                                                        onClick={() => handleRescheduleClick(item)}
                                                                        className="text-sm text-primary hover:text-yellow-300 font-medium transition-colors"
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
                                ) : (
                                    <div className="bg-dark-card rounded-xl shadow-lg p-4 border border-gray-800">
                                        <CalendarView
                                            appointments={appointments}
                                            onSelectEvent={(appt) => handleRescheduleClick(appt)}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'schedule' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-medium text-text-secondary">Weekly Schedule</h3>
                                <button
                                    onClick={handleSaveSchedule}
                                    disabled={loading}
                                    className="bg-primary text-black font-bold px-6 py-2 rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 shadow-lg hover:shadow-primary/20"
                                >
                                    {loading ? 'Saving...' : 'Save Schedule'}
                                </button>
                            </div>

                            <div className="bg-dark-card rounded-xl shadow-lg overflow-hidden border border-gray-800">
                                <ul className="divide-y divide-gray-800">
                                    {schedules.map((item, index) => (
                                        <li key={item.dayOfWeek} className="p-6 flex flex-col hover:bg-gray-800/30 transition-colors">
                                            <div className="flex items-center justify-between w-full">
                                                <div className="w-32 font-bold text-white text-lg">{days[item.dayOfWeek]}</div>

                                                <div className="flex items-center space-x-6">
                                                    <label className="flex items-center cursor-pointer group">
                                                        <div className="relative">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only"
                                                                checked={item.isAvailable}
                                                                onChange={(e) => updateScheduleItem(index, 'isAvailable', e.target.checked)}
                                                            />
                                                            <div className={`block w-12 h-7 rounded-full transition-colors ${item.isAvailable ? 'bg-primary' : 'bg-gray-700'}`}></div>
                                                            <div className={`dot absolute left-1 top-1 bg-black w-5 h-5 rounded-full transition-transform ${item.isAvailable ? 'transform translate-x-5' : ''}`}></div>
                                                        </div>
                                                        <div className={`ml-3 text-sm font-medium transition-colors ${item.isAvailable ? 'text-primary' : 'text-text-muted'}`}>
                                                            {item.isAvailable ? 'Available' : 'Off'}
                                                        </div>
                                                    </label>

                                                    {item.isAvailable && (
                                                        <div className="flex items-center space-x-3 bg-dark-bg p-2 rounded-lg border border-gray-800">
                                                            <input
                                                                type="time"
                                                                value={item.startTime}
                                                                onChange={(e) => updateScheduleItem(index, 'startTime', e.target.value)}
                                                                className="bg-dark-input border border-gray-700 rounded px-2 py-1 text-sm text-white focus:ring-primary focus:border-primary outline-none"
                                                            />
                                                            <span className="text-text-muted">to</span>
                                                            <input
                                                                type="time"
                                                                value={item.endTime}
                                                                onChange={(e) => updateScheduleItem(index, 'endTime', e.target.value)}
                                                                className="bg-dark-input border border-gray-700 rounded px-2 py-1 text-sm text-white focus:ring-primary focus:border-primary outline-none"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {item.isAvailable && (
                                                <div className="mt-4 ml-32 pl-4 border-l-2 border-gray-800">
                                                    <div className="text-sm font-medium text-text-secondary mb-2">Breaks</div>
                                                    {item.breaks && item.breaks.map((brk: any, breakIndex: number) => (
                                                        <div key={breakIndex} className="flex items-center space-x-2 mb-2">
                                                            <input
                                                                type="time"
                                                                value={brk.startTime}
                                                                onChange={(e) => {
                                                                    const newBreaks = [...(item.breaks || [])];
                                                                    newBreaks[breakIndex] = { ...newBreaks[breakIndex], startTime: e.target.value };
                                                                    updateScheduleItem(index, 'breaks', newBreaks);
                                                                }}
                                                                className="bg-dark-input border border-gray-700 rounded px-2 py-1 text-xs text-white focus:ring-primary focus:border-primary outline-none"
                                                            />
                                                            <span className="text-text-muted text-xs">to</span>
                                                            <input
                                                                type="time"
                                                                value={brk.endTime}
                                                                onChange={(e) => {
                                                                    const newBreaks = [...(item.breaks || [])];
                                                                    newBreaks[breakIndex] = { ...newBreaks[breakIndex], endTime: e.target.value };
                                                                    updateScheduleItem(index, 'breaks', newBreaks);
                                                                }}
                                                                className="bg-dark-input border border-gray-700 rounded px-2 py-1 text-xs text-white focus:ring-primary focus:border-primary outline-none"
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const newBreaks = item.breaks.filter((_: any, i: number) => i !== breakIndex);
                                                                    updateScheduleItem(index, 'breaks', newBreaks);
                                                                }}
                                                                className="text-red-500 hover:text-red-400 text-xs transition-colors"
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <button
                                                        onClick={() => {
                                                            const newBreaks = [...(item.breaks || []), { startTime: '12:00', endTime: '13:00' }];
                                                            updateScheduleItem(index, 'breaks', newBreaks);
                                                        }}
                                                        className="text-primary hover:text-yellow-300 text-xs font-medium mt-1 transition-colors"
                                                    >
                                                        + Add Break
                                                    </button>
                                                </div>
                                            )}
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
