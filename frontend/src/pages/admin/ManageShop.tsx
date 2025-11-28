import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import ConfirmationModal from '../../components/ConfirmationModal';
import { DESIGN } from '../../theme/design';
import PageLayout from '../../components/PageLayout';
import { useAuth } from '../../context/AuthContext';

import AdminBottomNav from '../../components/AdminBottomNav';

const ManageShop: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [shop, setShop] = useState<any>(null);
    const [activeTab, setActiveTab] = useState('services');
    const [isServiceModalVisible, setIsServiceModalVisible] = useState(false);
    const [isStaffModalVisible, setIsStaffModalVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const [editingService, setEditingService] = useState<any>(null);
    const [deleteServiceId, setDeleteServiceId] = useState<number | null>(null);
    const [removeStaffId, setRemoveStaffId] = useState<number | null>(null);

    const fetchShop = async () => {
        try {
            const response = await api.get(`/shops/${slug}`);
            setShop(response.data);
        } catch (error) {
            console.error('Failed to load shop details');
        }
    };

    useEffect(() => {
        fetchShop();
    }, [slug]);

    const handleCreateOrUpdateService = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            if (editingService) {
                await api.put(`/services/${editingService.id}`, values);
            } else {
                await api.post('/services', { ...values, shopId: shop.id });
            }
            setIsServiceModalVisible(false);
            setEditingService(null);
            fetchShop();
        } catch (error) {
            console.error('Failed to save service');
        } finally {
            setLoading(false);
        }
    };

    const confirmDeleteService = async () => {
        if (deleteServiceId) {
            try {
                await api.delete(`/services/${deleteServiceId}`);
                fetchShop();
            } catch (error) {
                console.error('Failed to delete service');
            }
            setDeleteServiceId(null);
        }
    };

    const handleAddStaff = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/shops/staff', { ...values, shopId: shop.id });
            setIsStaffModalVisible(false);
            fetchShop();
        } catch (error) {
            console.error('Failed to add staff');
        } finally {
            setLoading(false);
        }
    };

    const confirmRemoveStaff = async () => {
        if (removeStaffId) {
            try {
                await api.delete(`/shops/staff/${removeStaffId}`);
                fetchShop();
            } catch (error) {
                console.error('Failed to remove staff');
            }
            setRemoveStaffId(null);
        }
    };

    const openCreateServiceModal = () => {
        setEditingService(null);
        setIsServiceModalVisible(true);
    };

    const openEditServiceModal = (service: any) => {
        setEditingService(service);
        setIsServiceModalVisible(true);
    };

    const handleNavChange = (view: string) => {
        if (view === 'shops' || view === 'analytics') {
            navigate('/admin', { state: { view } });
        } else if (view === 'profile') {
            logout();
        } else {
            setActiveTab(view);
        }
    };

    return (
        <PageLayout
            title={`Gerenciar ${shop?.name}`}
            showBack
            className="p-4 md:p-6 pb-24"
        >
            <div className="space-y-6">
                {activeTab === 'services' && (
                    <div>
                        <button
                            onClick={openCreateServiceModal}
                            className={`mb-6 ${DESIGN.button.primary} w-full md:w-auto flex items-center justify-center gap-2`}
                        >
                            <i className="ri-add-line"></i>
                            Adicionar Serviço
                        </button>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {shop?.services?.map((service: any) => (
                                <div key={service.id} className="bg-dark-input p-4 rounded-lg border border-amber-400/10 flex flex-col justify-between group hover:border-primary/50 transition-all">
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <h4 className="font-bold text-white text-lg">{service.name}</h4>
                                            <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded uppercase tracking-wider">{service.type || 'OUTRO'}</span>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xl font-bold text-white">${service.price}</p>
                                            <p className="text-xs text-text-muted">{service.duration} min</p>
                                        </div>
                                    </div>

                                    {service.description && (
                                        <p className="text-sm text-text-secondary mb-4 line-clamp-2">{service.description}</p>
                                    )}

                                    <div className="flex justify-end gap-2 mt-auto pt-4 border-t border-amber-400/10">
                                        <button
                                            onClick={() => openEditServiceModal(service)}
                                            className="p-2 text-text-secondary hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                                            title="Editar"
                                        >
                                            <i className="ri-pencil-line text-lg"></i>
                                        </button>
                                        <button
                                            onClick={() => setDeleteServiceId(service.id)}
                                            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="Excluir"
                                        >
                                            <i className="ri-delete-bin-line text-lg"></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {(!shop?.services || shop.services.length === 0) && (
                            <div className="text-center py-12 text-text-muted">
                                <i className="ri-scissors-cut-line text-4xl mb-2 block opacity-50"></i>
                                <p>Nenhum serviço adicionado ainda.</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'staff' && (
                    <div>
                        <button
                            onClick={() => setIsStaffModalVisible(true)}
                            className={`mb-6 ${DESIGN.button.primary} w-full md:w-auto flex items-center justify-center gap-2`}
                        >
                            <i className="ri-user-add-line"></i>
                            Adicionar Equipe
                        </button>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {shop?.staff?.map((staff: any) => (
                                <div key={staff.id} className="bg-dark-input p-4 rounded-lg border border-amber-400/10 flex items-center justify-between group hover:border-primary/50 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold">
                                            {staff.user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white">{staff.user.name}</h4>
                                            <p className="text-xs text-text-muted">{staff.user.email}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setRemoveStaffId(staff.id)}
                                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
                                        title="Remover"
                                    >
                                        <i className="ri-user-unfollow-line text-lg"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                        {(!shop?.staff || shop.staff.length === 0) && (
                            <div className="text-center py-12 text-text-muted">
                                <i className="ri-team-line text-4xl mb-2 block opacity-50"></i>
                                <p>Nenhum membro da equipe adicionado ainda.</p>
                            </div>
                        )}
                        <p className={`mt-6 text-center text-xs ${DESIGN.text.muted}`}>Nota: O usuário já deve estar registrado como 'Equipe' para ser adicionado.</p>
                    </div>
                )}
            </div>

            {/* Service Modal */}
            {isServiceModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>{editingService ? 'Editar Serviço' : 'Adicionar Serviço'}</h3>
                        <form onSubmit={handleCreateOrUpdateService} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Nome do Serviço</label>
                                <input
                                    name="name"
                                    required
                                    defaultValue={editingService?.name}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Tipo de Serviço</label>
                                <select
                                    name="type"
                                    required
                                    defaultValue={editingService?.type || 'OTHER'}
                                    className={DESIGN.input.select}
                                >
                                    <option value="OTHER">Outro</option>
                                    <option value="HAIRCUT">Corte de Cabelo</option>
                                    <option value="BEARD">Barba</option>
                                </select>
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Duração (minutos)</label>
                                <input
                                    name="duration"
                                    type="number"
                                    min="1"
                                    required
                                    defaultValue={editingService?.duration}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Tempo de Intervalo (minutos)</label>
                                <input
                                    name="bufferTime"
                                    type="number"
                                    min="0"
                                    defaultValue={editingService?.bufferTime || 0}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Preço ($)</label>
                                <input
                                    name="price"
                                    type="number"
                                    min="0"
                                    required
                                    defaultValue={editingService?.price}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Descrição</label>
                                <textarea
                                    name="description"
                                    rows={3}
                                    defaultValue={editingService?.description}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>URL da Imagem</label>
                                <input
                                    name="imageUrl"
                                    type="url"
                                    placeholder="https://example.com/image.jpg"
                                    defaultValue={editingService?.imageUrl}
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsServiceModalVisible(false)}
                                    className={DESIGN.button.secondary}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className={DESIGN.button.primary}
                                >
                                    {loading ? (editingService ? 'Salvando...' : 'Adicionando...') : (editingService ? 'Salvar Alterações' : 'Adicionar')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Staff Modal */}
            {isStaffModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>Adicionar Equipe</h3>
                        <form onSubmit={handleAddStaff} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Email do Membro da Equipe</label>
                                <input
                                    name="email"
                                    type="email"
                                    required
                                    placeholder="Digite o email do membro da equipe registrado"
                                    className={DESIGN.input.base}
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsStaffModalVisible(false)}
                                    className={DESIGN.button.secondary}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className={DESIGN.button.primary}
                                >
                                    {loading ? 'Adicionando...' : 'Adicionar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <AdminBottomNav activeView={activeTab} isShopContext={true} onViewChange={handleNavChange} />

            <ConfirmationModal
                isOpen={!!deleteServiceId}
                onClose={() => setDeleteServiceId(null)}
                onConfirm={confirmDeleteService}
                title="Excluir Serviço"
                message="Tem certeza que deseja excluir este serviço?"
                confirmText="Excluir"
                isDangerous={true}
            />

            <ConfirmationModal
                isOpen={!!removeStaffId}
                onClose={() => setRemoveStaffId(null)}
                onConfirm={confirmRemoveStaff}
                title="Remover Equipe"
                message="Tem certeza que deseja remover este membro da equipe da barbearia?"
                confirmText="Remover"
                isDangerous={true}
            />
        </PageLayout>
    );
};

export default ManageShop;
