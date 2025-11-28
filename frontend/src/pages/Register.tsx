import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const Register: React.FC = () => {
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
            const response = await api.post('/auth/register', values);
            login(response.data.token, response.data.user);
            navigate('/');
        } catch (error: any) {
            setError(error.response?.data?.error || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-dark-bg">
            <div className="w-full max-w-md bg-dark-card p-8 shadow-none sm:shadow-xl rounded-none sm:rounded-xl border-0 sm:border border-amber-400/10 min-h-screen sm:min-h-0 flex flex-col justify-center">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-primary">Barber Shop</h2>
                    <p className="text-text-secondary mt-2">Crie uma nova conta</p>
                </div>

                {error && (
                    <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
                        {error}
                    </div>
                )}

                <form onSubmit={onFinish} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Nome</label>
                        <input
                            name="name"
                            required
                            className="w-full px-4 py-3 border border-amber-500 rounded-lg focus:ring-primary focus:border-primary outline-none transition-colors bg-dark-input text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">E-mail</label>
                        <input
                            name="email"
                            type="email"
                            required
                            className="w-full px-4 py-3 border border-amber-500 rounded-lg focus:ring-primary focus:border-primary outline-none transition-colors bg-dark-input text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Senha</label>
                        <input
                            name="password"
                            type="password"
                            required
                            className="w-full px-4 py-3 border border-amber-500 rounded-lg focus:ring-primary focus:border-primary outline-none transition-colors bg-dark-input text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Eu sou um...</label>
                        <select
                            name="role"
                            defaultValue="CUSTOMER"
                            className="w-full px-4 py-3 border border-amber-500 rounded-lg focus:ring-primary focus:border-primary outline-none transition-colors bg-dark-input text-white"
                        >
                            <option value="CUSTOMER">Cliente</option>
                            <option value="STAFF">Barbeiro (Funcionário)</option>
                            <option value="ADMIN">Dono da Barbearia (Admin)</option>
                        </select>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary text-black py-3 px-4 rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 font-bold shadow-lg hover:shadow-primary/20"
                    >
                        {loading ? 'Registrando...' : 'Registrar'}
                    </button>

                    <div className="text-center text-sm text-text-secondary">
                        Já tem uma conta? <Link to="/login" className="text-primary font-semibold hover:underline">Entrar</Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Register;
