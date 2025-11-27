import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../services/api';

const PaymentSuccess: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const sessionId = searchParams.get('session_id');
    const appointmentId = searchParams.get('appointment_id');

    const type = searchParams.get('type');

    useEffect(() => {
        const verifyPayment = async () => {
            if (!sessionId) {
                setStatus('error');
                return;
            }

            let attempts = 0;
            const maxAttempts = 10; // 20 seconds total

            const checkStatus = async () => {
                try {
                    let response;

                    if (type === 'subscription') {
                        // For subscriptions, we need to check if the DB has been updated by the webhook
                        // We use a POST request as verifySubscription expects sessionId in body
                        response = await api.post('/payment/verify-subscription', { sessionId });

                        if (response.data.status === 'success') {
                            setStatus('success');
                        } else if (response.data.status === 'pending' && attempts < maxAttempts) {
                            attempts++;
                            setTimeout(checkStatus, 2000);
                        } else if (attempts >= maxAttempts) {
                            console.log('Subscription verification timed out');
                            setStatus('error');
                        }
                    } else {
                        // For one-time payments
                        response = await api.get(`/payment/verify-session/${sessionId}`);

                        if (response.data.payment_status === 'paid') {
                            setStatus('success');
                        } else if (attempts < maxAttempts) {
                            attempts++;
                            setTimeout(checkStatus, 2000);
                        } else {
                            setStatus('error');
                        }
                    }
                } catch (e) {
                    console.error('Verification error', e);
                    if (axios.isAxiosError(e) && (e.response?.status === 403 || e.response?.status === 404)) {
                        setStatus('error');
                    } else if (attempts < maxAttempts) {
                        attempts++;
                        setTimeout(checkStatus, 2000);
                    } else {
                        setStatus('error');
                    }
                }
            };

            checkStatus();
        };

        verifyPayment();
    }, [sessionId, appointmentId, searchParams, type]);

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
