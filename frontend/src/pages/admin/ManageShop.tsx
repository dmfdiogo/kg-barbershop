import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import ConfirmationModal from '../../components/ConfirmationModal';

const ManageShop: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
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

    return (
        <div className="min-h-screen bg-dark-bg text-text-primary">
            <header className="bg-dark-card border-b border-gray-800 px-6 py-4 flex items-center sticky top-0 z-10">
                <button
                    onClick={() => navigate('/')}
                    className="mr-4 p-2 hover:bg-gray-800 rounded-full transition-colors text-white"
                >
                    <i className="ri-arrow-left-line text-xl"></i>
                </button>
                <h2 className="text-xl font-bold text-white">Manage {shop?.name}</h2>
            </header>

            <main className="p-4 md:p-6">
                <div className="bg-dark-card rounded-xl shadow-lg overflow-hidden border border-gray-800">
                    {/* Tabs */}
                    <div className="flex border-b border-gray-800">
                        <button
                            className={`px-6 py-4 font-bold transition-colors ${activeTab === 'services' ? 'border-b-2 border-primary text-primary' : 'text-text-secondary hover:text-white hover:bg-gray-800'}`}
                            onClick={() => setActiveTab('services')}
                        >
                            Services
                        </button>
                        <button
                            className={`px-6 py-4 font-bold transition-colors ${activeTab === 'staff' ? 'border-b-2 border-primary text-primary' : 'text-text-secondary hover:text-white hover:bg-gray-800'}`}
                            onClick={() => setActiveTab('staff')}
                        >
                            Staff
                        </button>
                    </div>

                    <div className="p-6">
                        {activeTab === 'services' && (
                            <div>
                                <button
                                    onClick={openCreateServiceModal}
                                    className="mb-6 bg-primary text-black font-bold px-4 py-2 rounded hover:bg-yellow-400 transition-colors shadow-lg hover:shadow-primary/20"
                                >
                                    + Add Service
                                </button>
                                <div className="overflow-x-auto rounded-lg border border-gray-800">
                                    <table className="min-w-full divide-y divide-gray-800">
                                        <thead className="bg-gray-900">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Name</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Duration (min)</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Price ($)</th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-dark-card divide-y divide-gray-800">
                                            {shop?.services?.map((service: any) => (
                                                <tr key={service.id} className="hover:bg-gray-800/50 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{service.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary">{service.duration}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary">{service.price}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <button
                                                            onClick={() => openEditServiceModal(service)}
                                                            className="text-primary hover:text-yellow-300 mr-4 transition-colors"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => setDeleteServiceId(service.id)}
                                                            className="text-red-500 hover:text-red-400 transition-colors"
                                                        >
                                                            Delete
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'staff' && (
                            <div>
                                <button
                                    onClick={() => setIsStaffModalVisible(true)}
                                    className="mb-6 bg-primary text-black font-bold px-4 py-2 rounded hover:bg-yellow-400 transition-colors shadow-lg hover:shadow-primary/20"
                                >
                                    + Add Staff
                                </button>
                                <div className="overflow-x-auto rounded-lg border border-gray-800">
                                    <table className="min-w-full divide-y divide-gray-800">
                                        <thead className="bg-gray-900">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Name</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Email</th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-dark-card divide-y divide-gray-800">
                                            {shop?.staff?.map((staff: any) => (
                                                <tr key={staff.id} className="hover:bg-gray-800/50 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{staff.user.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary">{staff.user.email}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <button
                                                            onClick={() => setRemoveStaffId(staff.id)}
                                                            className="text-red-500 hover:text-red-400 transition-colors"
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="mt-4 text-sm text-text-muted">Note: User must already be registered as 'Staff' to be added.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Service Modal */}
            {isServiceModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-dark-card rounded-xl p-6 w-full max-w-md border border-gray-800 shadow-2xl">
                        <h3 className="text-xl font-bold mb-4 text-white">{editingService ? 'Edit Service' : 'Add Service'}</h3>
                        <form onSubmit={handleCreateOrUpdateService} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Service Name</label>
                                <input
                                    name="name"
                                    required
                                    defaultValue={editingService?.name}
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Duration (minutes)</label>
                                <input
                                    name="duration"
                                    type="number"
                                    min="1"
                                    required
                                    defaultValue={editingService?.duration}
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Buffer Time (minutes)</label>
                                <input
                                    name="bufferTime"
                                    type="number"
                                    min="0"
                                    defaultValue={editingService?.bufferTime || 0}
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Price ($)</label>
                                <input
                                    name="price"
                                    type="number"
                                    min="0"
                                    required
                                    defaultValue={editingService?.price}
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
                                <textarea
                                    name="description"
                                    rows={3}
                                    defaultValue={editingService?.description}
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Image URL</label>
                                <input
                                    name="imageUrl"
                                    type="url"
                                    placeholder="https://example.com/image.jpg"
                                    defaultValue={editingService?.imageUrl}
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsServiceModalVisible(false)}
                                    className="px-4 py-2 text-text-secondary hover:bg-gray-800 rounded transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-4 py-2 bg-primary text-black font-bold rounded hover:bg-yellow-400 transition-colors"
                                >
                                    {loading ? (editingService ? 'Saving...' : 'Adding...') : (editingService ? 'Save Changes' : 'Add')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Staff Modal */}
            {isStaffModalVisible && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-dark-card rounded-xl p-6 w-full max-w-md border border-gray-800 shadow-2xl">
                        <h3 className="text-xl font-bold mb-4 text-white">Add Staff</h3>
                        <form onSubmit={handleAddStaff} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Staff Email</label>
                                <input
                                    name="email"
                                    type="email"
                                    required
                                    placeholder="Enter email of registered staff member"
                                    className="w-full px-3 py-2 border border-gray-700 rounded bg-dark-input text-white focus:ring-primary focus:border-primary outline-none"
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsStaffModalVisible(false)}
                                    className="px-4 py-2 text-text-secondary hover:bg-gray-800 rounded transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-4 py-2 bg-primary text-black font-bold rounded hover:bg-yellow-400 transition-colors"
                                >
                                    {loading ? 'Adding...' : 'Add'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={!!deleteServiceId}
                onClose={() => setDeleteServiceId(null)}
                onConfirm={confirmDeleteService}
                title="Delete Service"
                message="Are you sure you want to delete this service?"
                confirmText="Delete"
                isDangerous={true}
            />

            <ConfirmationModal
                isOpen={!!removeStaffId}
                onClose={() => setRemoveStaffId(null)}
                onConfirm={confirmRemoveStaff}
                title="Remove Staff"
                message="Are you sure you want to remove this staff member from the shop?"
                confirmText="Remove"
                isDangerous={true}
            />
        </div>
    );
};

export default ManageShop;
