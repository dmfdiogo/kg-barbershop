import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { DESIGN } from '../../theme/design';
import ConfirmationModal from '../../components/ConfirmationModal';

const AdminStaffView: React.FC = () => {
    const [staffList, setStaffList] = useState<any[]>([]);
    const [shops, setShops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
    const [isAssignModalVisible, setIsAssignModalVisible] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<any>(null);

    const fetchStaff = async () => {
        try {
            const response = await api.get('/staff');
            setStaffList(response.data);
        } catch (error) {
            console.error('Failed to fetch staff');
        }
    };

    const fetchShops = async () => {
        try {
            const response = await api.get('/shops');
            setShops(response.data);
        } catch (error) {
            console.error('Failed to fetch shops');
        }
    };

    useEffect(() => {
        fetchStaff();
        fetchShops();
    }, []);

    const handleCreateStaff = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/staff', values);
            setIsCreateModalVisible(false);
            fetchStaff();
        } catch (error: any) {
            console.error('Failed to create staff');
            alert(error.response?.data?.error || 'Falha ao criar usuário');
        } finally {
            setLoading(false);
        }
    };

    const handleAssignStaff = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/staff/assign', {
                userId: selectedStaff.id,
                shopId: parseInt(values.shopId as string)
            });
            setIsAssignModalVisible(false);
            setSelectedStaff(null);
            fetchStaff();
        } catch (error: any) {
            console.error('Failed to assign staff');
            alert(error.response?.data?.error || 'Falha ao atribuir equipe');
        } finally {
            setLoading(false);
        }
    };

    const [confirmRemove, setConfirmRemove] = useState<{ userId: number, shopId: number } | null>(null);

    const handleRemoveFromShop = async () => {
        if (!confirmRemove) return;

        try {
            await api.post('/staff/remove', confirmRemove);
            fetchStaff();
        } catch (error) {
            console.error('Failed to remove staff from shop');
        } finally {
            setConfirmRemove(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className={`${DESIGN.text.subHeader} text-lg`}>Gerenciamento Global de Equipe</h3>
                <button
                    onClick={() => setIsCreateModalVisible(true)}
                    className={DESIGN.button.primary}
                >
                    <i className="ri-user-add-line mr-2"></i>
                    Novo Usuário
                </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {staffList.map((user) => (
                    <div key={user.id} className={`${DESIGN.card.base} p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4`}>
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-xl">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h4 className="font-bold text-white flex items-center gap-2">
                                    {user.name}
                                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase ${user.role === 'ADMIN' ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'}`}>
                                        {user.role}
                                    </span>
                                </h4>
                                <p className="text-sm text-text-muted">{user.email}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                            {user.staffProfiles?.map((profile: any) => (
                                <div key={profile.id} className="flex items-center gap-1 bg-dark-input px-3 py-1 rounded-full border border-amber-400/10">
                                    <span className="text-xs text-white">{profile.shop.name}</span>
                                    <button
                                        onClick={() => setConfirmRemove({ userId: user.id, shopId: profile.shop.id })}
                                        className="text-red-400 hover:text-red-300 ml-1"
                                        title="Remover da loja"
                                    >
                                        <i className="ri-close-circle-line"></i>
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={() => { setSelectedStaff(user); setIsAssignModalVisible(true); }}
                                className="text-xs text-primary hover:text-white border border-primary/30 hover:border-primary px-3 py-1 rounded-full transition-colors"
                            >
                                + Atribuir Loja
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Create User Modal */}
            {isCreateModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>Criar Novo Usuário</h3>
                        <form onSubmit={handleCreateStaff} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Nome</label>
                                <input name="name" required className={DESIGN.input.base} />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Email</label>
                                <input name="email" type="email" required className={DESIGN.input.base} />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Senha</label>
                                <input name="password" type="password" required className={DESIGN.input.base} />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Função</label>
                                <select name="role" className={DESIGN.input.select}>
                                    <option value="STAFF">Barbeiro (Staff)</option>
                                    <option value="ADMIN">Admin</option>
                                </select>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button type="button" onClick={() => setIsCreateModalVisible(false)} className={DESIGN.button.secondary}>Cancelar</button>
                                <button type="submit" disabled={loading} className={DESIGN.button.primary}>{loading ? 'Criando...' : 'Criar'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Assign Shop Modal */}
            {isAssignModalVisible && selectedStaff && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>Atribuir Loja para {selectedStaff.name}</h3>
                        <form onSubmit={handleAssignStaff} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Selecione a Barbearia</label>
                                <select name="shopId" required className={DESIGN.input.select}>
                                    <option value="">Selecione...</option>
                                    {shops.map(shop => (
                                        <option key={shop.id} value={shop.id}>{shop.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button type="button" onClick={() => { setIsAssignModalVisible(false); setSelectedStaff(null); }} className={DESIGN.button.secondary}>Cancelar</button>
                                <button type="submit" disabled={loading} className={DESIGN.button.primary}>{loading ? 'Atribuindo...' : 'Atribuir'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={!!confirmRemove}
                onClose={() => setConfirmRemove(null)}
                onConfirm={handleRemoveFromShop}
                title="Remover da Loja"
                message="Tem certeza que deseja remover este membro da equipe desta barbearia?"
                confirmText="Remover"
                isDangerous={true}
            />
        </div>
    );
};

export default AdminStaffView;
