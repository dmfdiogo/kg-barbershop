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
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
                <div className="text-yellow-500 text-5xl mb-4">!</div>
                <h2 className="text-2xl font-bold mb-2">Payment Cancelled</h2>
                <p className="text-gray-600 mb-6">You cancelled the payment process. The appointment booking has been cancelled.</p>
                <div className="space-y-3">
                    <button
                        onClick={() => navigate('/history')}
                        className="block w-full bg-black text-white px-6 py-2 rounded hover:bg-gray-800 transition-colors"
                    >
                        View My Appointments
                    </button>
                    <button
                        onClick={() => navigate(-1)}
                        className="block w-full border border-gray-300 text-gray-700 px-6 py-2 rounded hover:bg-gray-50 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentCancel;
