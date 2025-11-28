import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';

const PaymentCancel: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const appointmentId = searchParams.get('appointment_id');

    useEffect(() => {
        const cancelAppointment = async () => {
            if (appointmentId) {
                try {
                    await api.patch(`/appointments/${appointmentId}/status`, { status: 'CANCELLED' });
                    console.log('Appointment cancelled due to payment cancellation');
                } catch (error) {
                    console.error('Failed to cancel appointment', error);
                }
            }
        };
        cancelAppointment();
    }, [appointmentId]);

    return (
        <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
            <div className="bg-dark-card p-8 rounded-xl shadow-2xl max-w-md w-full text-center border border-amber-400/10">
                <div className="text-yellow-500 text-5xl mb-4">
                    <i className="ri-error-warning-fill"></i>
                </div>
                <h2 className="text-2xl font-bold mb-2 text-white">Payment Cancelled</h2>
                <p className="text-text-secondary mb-8">You cancelled the payment process. The appointment booking has been cancelled.</p>
                <div className="space-y-4">
                    <button
                        onClick={() => navigate('/history')}
                        className="block w-full bg-primary text-black font-bold px-6 py-3 rounded-lg hover:bg-yellow-400 transition-colors shadow-lg shadow-primary/20"
                    >
                        View My Appointments
                    </button>
                    <button
                        onClick={() => navigate(-1)}
                        className="block w-full border border-amber-500 text-text-secondary px-6 py-3 rounded-lg hover:bg-gray-800 hover:text-white transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentCancel;
