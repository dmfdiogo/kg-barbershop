import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import RescheduleModal from '../../components/RescheduleModal';
import { DESIGN } from '../../theme/design';
import { formatDateTime } from '../../utils/date';
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
            alert('Horário atualizado com sucesso');
        } catch (error) {
            console.error('Failed to update schedule');
            alert('Falha ao atualizar horário');
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

    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    return (
        <div className={`${DESIGN.layout.pageContainer} flex flex-col md:flex-row`}>
            {/* Sidebar */}
            <div className="w-64 bg-dark-card border-r border-amber-400/10 flex flex-col hidden md:flex">
                <div className="h-16 flex items-center justify-center border-b border-amber-400/10">
                    <h1 className="text-xl font-bold text-primary">Painel do Barbeiro</h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveTab('appointments')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'appointments' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-calendar-check-line mr-3 text-lg"></i> Meus Agendamentos
                    </button>
                    <button
                        onClick={() => setActiveTab('schedule')}
                        className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'schedule' ? 'bg-gray-800 text-primary' : 'text-text-secondary hover:bg-gray-800 hover:text-white'}`}
                    >
                        <i className="ri-time-line mr-3 text-lg"></i> Gerenciar Horários
                    </button>
                </nav>
                <div className="p-4 border-t border-amber-400/10">
                    <button onClick={logout} className="w-full flex items-center px-4 py-2 hover:bg-gray-800 rounded text-left text-red-400 transition-colors">
                        <i className="ri-logout-box-r-line mr-3 text-lg"></i> Sair
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-transparent shadow-md border-b border-amber-400/10 h-16 flex items-center px-6 flex-none z-10">
                    <h2 className={DESIGN.text.subHeader}>Bem-vindo, {user?.name}</h2>
                </header>

                <main className="flex-1 overflow-y-auto mask-fade p-6 scrollbar-hide">
                    {activeTab === 'appointments' && (
                        <div>
                            <div>
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className={`${DESIGN.text.subHeader} text-lg`}>Próximos Agendamentos</h3>
                                    <div className="flex space-x-2 bg-dark-card rounded-lg p-1 border border-amber-400/10">
                                        <button
                                            onClick={() => setViewMode('list')}
                                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'list' ? 'bg-primary text-black shadow-sm' : 'text-text-secondary hover:text-white'}`}
                                        >
                                            Lista
                                        </button>
                                        <button
                                            onClick={() => setViewMode('calendar')}
                                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'calendar' ? 'bg-primary text-black shadow-sm' : 'text-text-secondary hover:text-white'}`}
                                        >
                                            Calendário
                                        </button>
                                    </div>
                                </div>

                                {viewMode === 'list' ? (
                                    <div className={`${DESIGN.card.base} overflow-hidden`}>
                                        {appointments.length === 0 ? (
                                            <div className={`p-8 text-center ${DESIGN.text.muted}`}>Nenhum agendamento próximo.</div>
                                        ) : (
                                            <ul className="divide-y divide-gray-800">
                                                {appointments.map((item: any) => (
                                                    <li key={item.id} className="p-6 hover:bg-gray-800/50 transition-colors">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <p className="text-lg font-bold text-white">
                                                                    {item.service.name} <span className={`${DESIGN.text.muted} font-normal`}>com</span> {item.customer.name}
                                                                </p>
                                                                <p className="text-sm text-primary mt-1">
                                                                    {formatDateTime(item.startTime)}
                                                                </p>
                                                                <p className={`text-xs ${DESIGN.text.muted} mt-1`}>
                                                                    Pagamento: <span className="text-text-secondary">{item.paymentMethod}</span> - <span className={item.paymentStatus === 'PAID' ? 'text-green-400' : 'text-yellow-400'}>{item.paymentStatus === 'PAID' ? 'PAGO' : item.paymentStatus}</span>
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center space-x-4">
                                                                <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-full ${item.status === 'CONFIRMED' ? DESIGN.badge.success : DESIGN.badge.warning}`}>
                                                                    {item.status === 'CONFIRMED' ? 'CONFIRMADO' : item.status === 'CANCELLED' ? 'CANCELADO' : item.status}
                                                                </span>
                                                                {item.status !== 'CANCELLED' && (
                                                                    <button
                                                                        onClick={() => handleRescheduleClick(item)}
                                                                        className="text-sm text-primary hover:text-yellow-300 font-medium transition-colors"
                                                                    >
                                                                        Reagendar
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
                                    <div className={`${DESIGN.card.base} p-4`}>
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
                                <h3 className={`${DESIGN.text.subHeader} text-lg`}>Horário Semanal</h3>
                                <button
                                    onClick={handleSaveSchedule}
                                    disabled={loading}
                                    className={`${DESIGN.button.primary} disabled:opacity-50`}
                                >
                                    {loading ? 'Salvando...' : 'Salvar Horário'}
                                </button>
                            </div>

                            <div className={`${DESIGN.card.base} overflow-hidden`}>
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
                                                        <div className={`ml-3 text-sm font-medium transition-colors ${item.isAvailable ? 'text-primary' : DESIGN.text.muted}`}>
                                                            {item.isAvailable ? 'Disponível' : 'Folga'}
                                                        </div>
                                                    </label>

                                                    {item.isAvailable && (
                                                        <div className="flex items-center space-x-3 bg-dark-bg p-2 rounded-lg border border-amber-400/10">
                                                            <input
                                                                type="time"
                                                                value={item.startTime}
                                                                onChange={(e) => updateScheduleItem(index, 'startTime', e.target.value)}
                                                                className={DESIGN.input.base}
                                                            />
                                                            <span className={DESIGN.text.muted}>até</span>
                                                            <input
                                                                type="time"
                                                                value={item.endTime}
                                                                onChange={(e) => updateScheduleItem(index, 'endTime', e.target.value)}
                                                                className={DESIGN.input.base}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {item.isAvailable && (
                                                <div className="mt-4 ml-32 pl-4 border-l-2 border-amber-400/10">
                                                    <div className={`text-sm font-medium ${DESIGN.text.body} mb-2`}>Pausas</div>
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
                                                                className={`${DESIGN.input.base} py-1 text-xs`}
                                                            />
                                                            <span className={`${DESIGN.text.muted} text-xs`}>até</span>
                                                            <input
                                                                type="time"
                                                                value={brk.endTime}
                                                                onChange={(e) => {
                                                                    const newBreaks = [...(item.breaks || [])];
                                                                    newBreaks[breakIndex] = { ...newBreaks[breakIndex], endTime: e.target.value };
                                                                    updateScheduleItem(index, 'breaks', newBreaks);
                                                                }}
                                                                className={`${DESIGN.input.base} py-1 text-xs`}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const newBreaks = item.breaks.filter((_: any, i: number) => i !== breakIndex);
                                                                    updateScheduleItem(index, 'breaks', newBreaks);
                                                                }}
                                                                className="text-red-500 hover:text-red-400 text-xs transition-colors"
                                                            >
                                                                Remover
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
                                                        + Adicionar Pausa
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
