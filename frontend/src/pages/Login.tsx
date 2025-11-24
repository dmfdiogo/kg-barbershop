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
        <div className="flex justify-center items-center h-screen bg-gray-100">
            <div className="w-full max-w-md bg-white shadow-lg rounded-lg p-8">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-gray-900">Barber Shop</h2>
                    <p className="text-gray-600 mt-2">Sign in to your account</p>
                </div>

                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        {error}
                    </div>
                )}

                <form onSubmit={onFinish} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            name="email"
                            type="email"
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-black focus:border-black outline-none transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                            name="password"
                            type="password"
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-black focus:border-black outline-none transition-colors"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-black text-white py-2 px-4 rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50 font-medium"
                    >
                        {loading ? 'Logging in...' : 'Log in'}
                    </button>

                    <div className="text-center text-sm text-gray-600">
                        Or <Link to="/register" className="text-black font-semibold hover:underline">register now!</Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Login;
