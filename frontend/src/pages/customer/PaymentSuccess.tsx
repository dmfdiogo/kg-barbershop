import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';

const PaymentSuccess: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

    useEffect(() => {
        const verifyPayment = async () => {
            const sessionId = searchParams.get('session_id');
            const appointmentId = searchParams.get('appointment_id');

            if (!sessionId || !appointmentId) {
                setStatus('error');
                return;
            }

            try {
                await api.post('/payment/success', { sessionId, appointmentId });
                setStatus('success');
            } catch (error) {
                console.error('Payment verification failed', error);
                setStatus('error');
            }
        };

        verifyPayment();
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
                {status === 'loading' && (
                    <div>
                        <h2 className="text-2xl font-bold mb-4">Verifying Payment...</h2>
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
                    </div>
                )}
                {status === 'success' && (
                    <div>
                        <div className="text-green-500 text-5xl mb-4">✓</div>
                        <h2 className="text-2xl font-bold mb-2">Payment Successful!</h2>
                        <p className="text-gray-600 mb-6">Your appointment has been confirmed.</p>
                        <button
                            onClick={() => navigate('/history')}
                            className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800 transition-colors"
                        >
                            View My Appointments
                        </button>
                    </div>
                )}
                {status === 'error' && (
                    <div>
                        <div className="text-red-500 text-5xl mb-4">✗</div>
                        <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
                        <p className="text-gray-600 mb-6">We couldn't verify your payment. Please check your appointments status.</p>
                        <button
                            onClick={() => navigate('/history')}
                            className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800 transition-colors"
                        >
                            Go to Appointments
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PaymentSuccess;
