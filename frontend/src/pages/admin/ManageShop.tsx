import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';

const ManageShop: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [shop, setShop] = useState<any>(null);
    const [activeTab, setActiveTab] = useState('services');
    const [isServiceModalVisible, setIsServiceModalVisible] = useState(false);
    const [isStaffModalVisible, setIsStaffModalVisible] = useState(false);
    const [loading, setLoading] = useState(false);

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

    const handleAddService = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);
        const values = Object.fromEntries(formData.entries());

        try {
            await api.post('/services', { ...values, shopId: shop.id });
            setIsServiceModalVisible(false);
            fetchShop();
        } catch (error) {
            console.error('Failed to add service');
        } finally {
            setLoading(false);
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

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow px-6 py-4 flex items-center">
                <button
                    onClick={() => navigate('/')}
                    className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                    ←
                </button>
                <h2 className="text-xl font-bold text-gray-800">Manage {shop?.name}</h2>
            </header>

            <main className="p-6">
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    {/* Tabs */}
                    <div className="flex border-b">
                        <button
                            className={`px-6 py-3 font-medium ${activeTab === 'services' ? 'border-b-2 border-black text-black' : 'text-gray-500 hover:text-black'}`}
                            onClick={() => setActiveTab('services')}
                        >
                            Services
                        </button>
                        <button
                            className={`px-6 py-3 font-medium ${activeTab === 'staff' ? 'border-b-2 border-black text-black' : 'text-gray-500 hover:text-black'}`}
                            onClick={() => setActiveTab('staff')}
                        >
                            Staff
                        </button>
                    </div>

                    <div className="p-6">
                        {activeTab === 'services' && (
                            <div>
                                <button
                                    onClick={() => setIsServiceModalVisible(true)}
                                    className="mb-4 bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition-colors"
                                >
                                    + Add Service
                                </button>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration (min)</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price ($)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {shop?.services?.map((service: any) => (
                                                <tr key={service.id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{service.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{service.duration}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{service.price}</td>
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
                                    className="mb-4 bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition-colors"
                                >
                                    + Add Staff
                                </button>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {shop?.staff?.map((staff: any) => (
                                                <tr key={staff.id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{staff.user.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{staff.user.email}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="mt-4 text-sm text-gray-500">Note: User must already be registered as 'Staff' to be added.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Service Modal */}
            {isServiceModalVisible && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4">Add Service</h3>
                        <form onSubmit={handleAddService} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
                                <input
                                    name="name"
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-black focus:border-black outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
                                <input
                                    name="duration"
                                    type="number"
                                    min="1"
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-black focus:border-black outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Price ($)</label>
                                <input
                                    name="price"
                                    type="number"
                                    min="0"
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-black focus:border-black outline-none"
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsServiceModalVisible(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
                                >
                                    {loading ? 'Adding...' : 'Add'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Staff Modal */}
            {isStaffModalVisible && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4">Add Staff</h3>
                        <form onSubmit={handleAddStaff} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Staff Email</label>
                                <input
                                    name="email"
                                    type="email"
                                    required
                                    placeholder="Enter email of registered staff member"
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-black focus:border-black outline-none"
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsStaffModalVisible(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
                                >
                                    {loading ? 'Adding...' : 'Add'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageShop;
