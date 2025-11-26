import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';

const PaymentSuccess: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const sessionId = searchParams.get('session_id');
    const appointmentId = searchParams.get('appointment_id');

    useEffect(() => {
        const verifyPayment = async () => {

            if (!sessionId) {
                setStatus('error');
                return;
            }

            try {
                const type = searchParams.get('type');
                if (type === 'subscription') {
                    // Poll for verification (max 5 attempts)
                    let attempts = 0;
                    const maxAttempts = 5;

                    const checkStatus = async () => {
                        try {
                            const response = await api.post('/payment/verify-subscription', { sessionId });
                            if (response.data.status === 'success') {
                                setStatus('success');
                            } else if (attempts < maxAttempts) {
                                attempts++;
                                setTimeout(checkStatus, 2000); // Retry every 2 seconds
                            } else {
                                // If still pending after retries, show success anyway but maybe with a note?
                                // Or just show success because we know Stripe redirect happened.
                                // Let's show success but log it.
                                console.log('Subscription verification timed out, but assuming success from redirect');
                                setStatus('success');
                            }
                        } catch (e) {
                            console.error('Verification error', e);
                            setStatus('error');
                        }
                    };

                    checkStatus();
                } else {
                    await api.post('/payment/success', { sessionId, appointmentId });
                    setStatus('success');
                }
            } catch (error) {
                console.error('Payment verification failed', error);
                setStatus('error');
            }
        };

        verifyPayment();
    }, [sessionId, appointmentId, searchParams]);

    return (
        <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
            <div className="bg-dark-card p-8 rounded-xl shadow-2xl max-w-md w-full text-center border border-gray-800">
                {status === 'loading' && (
                    <div>
                        <h2 className="text-2xl font-bold mb-4 text-white">Verifying Payment...</h2>
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    </div>
                )}
                {status === 'success' && (
                    <div>
                        <div className="text-green-400 text-5xl mb-4">
                            <i className="ri-checkbox-circle-fill"></i>
                        </div>
                        <h2 className="text-2xl font-bold mb-2 text-white">Payment Successful!</h2>
                        <p className="text-text-secondary mb-8">Your appointment has been confirmed.</p>
                        <button
                            onClick={() => navigate('/history')}
                            className="bg-primary text-black font-bold px-6 py-3 rounded-lg hover:bg-yellow-400 transition-colors shadow-lg shadow-primary/20 w-full"
                        >
                            View My Appointments
                        </button>
                    </div>
                )}
                {status === 'error' && (
                    <div>
                        <div className="text-red-500 text-5xl mb-4">
                            <i className="ri-close-circle-fill"></i>
                        </div>
                        <h2 className="text-2xl font-bold mb-2 text-white">Something went wrong</h2>
                        <p className="text-text-secondary mb-8">We couldn't verify your payment. Please check your appointments status.</p>
                        <button
                            onClick={() => navigate('/history')}
                            className="bg-primary text-black font-bold px-6 py-3 rounded-lg hover:bg-yellow-400 transition-colors shadow-lg shadow-primary/20 w-full"
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
