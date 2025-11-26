import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const onFinish = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            const response = await api.post('/auth/login', values);
            login(response.data.token, response.data.user);
            navigate('/');
        } catch (error: any) {
            setError(error.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-dark-bg">
            <div className="w-full max-w-md bg-dark-card p-8 shadow-none sm:shadow-xl rounded-none sm:rounded-xl border-0 sm:border border-gray-800 min-h-screen sm:min-h-0 flex flex-col justify-center">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-primary">Barber Shop</h2>
                    <p className="text-text-secondary mt-2">Sign in to your account</p>
                </div>

                {error && (
                    <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
                        {error}
                    </div>
                )}

                <form onSubmit={onFinish} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
                        <input
                            name="email"
                            type="email"
                            required
                            className="w-full px-4 py-3 border border-gray-700 rounded-lg focus:ring-primary focus:border-primary outline-none transition-colors bg-dark-input text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Password</label>
                        <input
                            name="password"
                            type="password"
                            required
                            className="w-full px-4 py-3 border border-gray-700 rounded-lg focus:ring-primary focus:border-primary outline-none transition-colors bg-dark-input text-white"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary text-black py-3 px-4 rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 font-bold shadow-lg hover:shadow-primary/20"
                    >
                        {loading ? 'Logging in...' : 'Log in'}
                    </button>

                    <div className="text-center text-sm text-text-secondary">
                        Or <Link to="/register" className="text-primary font-semibold hover:underline">register now!</Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Login;
