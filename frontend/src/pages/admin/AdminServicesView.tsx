import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { DESIGN } from '../../theme/design';
import ConfirmationModal from '../../components/ConfirmationModal';

const AdminServicesView: React.FC = () => {
    const [servicesList, setServicesList] = useState<any[]>([]);
    const [shops, setShops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
    const [isAssignModalVisible, setIsAssignModalVisible] = useState(false);
    const [selectedService, setSelectedService] = useState<any>(null);
    const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

    const fetchServices = async () => {
        try {
            const response = await api.get('/global-services');
            setServicesList(response.data);
        } catch (error) {
            console.error('Failed to fetch global services');
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
        fetchServices();
        fetchShops();
    }, []);

    const handleCreateService = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/global-services', values);
            setIsCreateModalVisible(false);
            fetchServices();
        } catch (error: any) {
            console.error('Failed to create service');
            alert(error.response?.data?.error || 'Falha ao criar serviço');
        } finally {
            setLoading(false);
        }
    };

    const handleAssignService = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/global-services/assign', {
                globalServiceId: selectedService.id,
                shopId: parseInt(values.shopId as string),
                price: values.price,
                duration: values.duration
            });
            setIsAssignModalVisible(false);
            setSelectedService(null);
            fetchServices();
        } catch (error: any) {
            console.error('Failed to assign service');
            alert(error.response?.data?.error || 'Falha ao atribuir serviço');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteService = async () => {
        if (!confirmDelete) return;

        try {
            await api.delete(`/global-services/${confirmDelete}`);
            fetchServices();
        } catch (error: any) {
            console.error('Failed to delete service');
            alert(error.response?.data?.error || 'Falha ao excluir serviço');
        } finally {
            setConfirmDelete(null);
        }
    };

    const [confirmRemoveFromShop, setConfirmRemoveFromShop] = useState<{ globalServiceId: number, shopId: number } | null>(null);

    const handleRemoveFromShop = async () => {
        if (!confirmRemoveFromShop) return;

        try {
            await api.post('/global-services/remove', confirmRemoveFromShop);
            fetchServices();
        } catch (error: any) {
            console.error('Failed to remove service from shop');
            alert(error.response?.data?.error || 'Falha ao remover serviço da loja');
        } finally {
            setConfirmRemoveFromShop(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className={`${DESIGN.text.subHeader} text-lg`}>Gerenciamento Global de Serviços</h3>
                <button
                    onClick={() => setIsCreateModalVisible(true)}
                    className={DESIGN.button.primary}
                >
                    <i className="ri-add-line mr-2"></i>
                    Novo Serviço
                </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {servicesList.map((service) => (
                    <div key={service.id} className={`${DESIGN.card.base} p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4`}>
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xl">
                                <i className="ri-scissors-cut-line"></i>
                            </div>
                            <div>
                                <h4 className="font-bold text-white flex items-center gap-2">
                                    {service.name}
                                    <span className="text-[10px] bg-gray-700 px-2 py-0.5 rounded uppercase text-text-muted">
                                        {service.type}
                                    </span>
                                </h4>
                                <p className="text-sm text-text-muted">{service.defaultDuration} min • R$ {service.defaultPrice}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                            {service.services?.map((shopService: any) => (
                                <div key={shopService.shop.id} className="flex items-center gap-1 bg-dark-input px-3 py-1 rounded-full border border-amber-400/10">
                                    <span className="text-xs text-white">{shopService.shop.name}</span>
                                    <button
                                        onClick={() => setConfirmRemoveFromShop({ globalServiceId: service.id, shopId: shopService.shop.id })}
                                        className="text-red-400 hover:text-red-300 ml-1"
                                        title="Remover da loja"
                                    >
                                        <i className="ri-close-circle-line"></i>
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={() => { setSelectedService(service); setIsAssignModalVisible(true); }}
                                className="text-xs text-primary hover:text-white border border-primary/30 hover:border-primary px-3 py-1 rounded-full transition-colors"
                            >
                                + Atribuir Loja
                            </button>
                            <button
                                onClick={() => setConfirmDelete(service.id)}
                                className="text-xs text-red-400 hover:text-white border border-red-900/30 hover:bg-red-900/50 px-3 py-1 rounded-full transition-colors"
                            >
                                <i className="ri-delete-bin-line"></i>
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Create Service Modal */}
            {isCreateModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>Criar Novo Serviço Global</h3>
                        <form onSubmit={handleCreateService} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Nome do Serviço</label>
                                <input name="name" required className={DESIGN.input.base} placeholder="Ex: Corte Masculino" />
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Descrição</label>
                                <textarea name="description" className={DESIGN.input.base} rows={2} placeholder="Descrição do serviço..." />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={DESIGN.text.label}>Duração Padrão (min)</label>
                                    <input name="defaultDuration" type="number" required className={DESIGN.input.base} defaultValue={30} />
                                </div>
                                <div>
                                    <label className={DESIGN.text.label}>Preço Padrão (R$)</label>
                                    <input name="defaultPrice" type="number" step="0.01" required className={DESIGN.input.base} defaultValue={50.00} />
                                </div>
                            </div>
                            <div>
                                <label className={DESIGN.text.label}>Tipo</label>
                                <select name="type" className={DESIGN.input.select}>
                                    <option value="HAIRCUT">Corte de Cabelo</option>
                                    <option value="BEARD">Barba</option>
                                    <option value="OTHER">Outro</option>
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
            {isAssignModalVisible && selectedService && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`${DESIGN.card.base} p-6 w-full max-w-md shadow-2xl`}>
                        <h3 className={`${DESIGN.text.subHeader} mb-4`}>Atribuir {selectedService.name}</h3>
                        <form onSubmit={handleAssignService} className="space-y-4">
                            <div>
                                <label className={DESIGN.text.label}>Selecione a Barbearia</label>
                                <select name="shopId" required className={DESIGN.input.select}>
                                    <option value="">Selecione...</option>
                                    {shops.map(shop => (
                                        <option key={shop.id} value={shop.id}>{shop.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={DESIGN.text.label}>Duração (min)</label>
                                    <input name="duration" type="number" required className={DESIGN.input.base} defaultValue={selectedService.defaultDuration} />
                                </div>
                                <div>
                                    <label className={DESIGN.text.label}>Preço (R$)</label>
                                    <input name="price" type="number" step="0.01" required className={DESIGN.input.base} defaultValue={selectedService.defaultPrice} />
                                </div>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button type="button" onClick={() => { setIsAssignModalVisible(false); setSelectedService(null); }} className={DESIGN.button.secondary}>Cancelar</button>
                                <button type="submit" disabled={loading} className={DESIGN.button.primary}>{loading ? 'Atribuindo...' : 'Atribuir'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={handleDeleteService}
                title="Excluir Serviço Global"
                message="Tem certeza que deseja excluir este serviço? Isso só é possível se ele não estiver atribuído a nenhuma loja."
                confirmText="Excluir"
                isDangerous={true}
            />

            <ConfirmationModal
                isOpen={!!confirmRemoveFromShop}
                onClose={() => setConfirmRemoveFromShop(null)}
                onConfirm={handleRemoveFromShop}
                title="Remover da Loja"
                message="Tem certeza que deseja remover este serviço desta barbearia?"
                confirmText="Remover"
                isDangerous={true}
            />
        </div>
    );
};

export default AdminServicesView;
