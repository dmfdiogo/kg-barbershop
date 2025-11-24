import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Button, Form, Input, InputNumber, Table, Tabs, Modal, message, Select } from 'antd';
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../../services/api';

const { Header, Content } = Layout;
// const { Option } = Select;

const ManageShop: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [shop, setShop] = useState<any>(null);
    const [isServiceModalVisible, setIsServiceModalVisible] = useState(false);
    const [isStaffModalVisible, setIsStaffModalVisible] = useState(false);
    const [form] = Form.useForm();
    const [staffForm] = Form.useForm();

    const fetchShop = async () => {
        try {
            const response = await api.get(`/shops/${slug}`);
            setShop(response.data);
        } catch (error) {
            message.error('Failed to load shop details');
        }
    };

    useEffect(() => {
        fetchShop();
    }, [slug]);

    const handleAddService = async (values: any) => {
        try {
            await api.post('/services', { ...values, shopId: shop.id });
            message.success('Service added');
            setIsServiceModalVisible(false);
            form.resetFields();
            fetchShop();
        } catch (error) {
            message.error('Failed to add service');
        }
    };

    const handleAddStaff = async (values: any) => {
        try {
            await api.post('/shops/staff', { ...values, shopId: shop.id });
            message.success('Staff added');
            setIsStaffModalVisible(false);
            staffForm.resetFields();
            fetchShop();
        } catch (error: any) {
            message.error(error.response?.data?.error || 'Failed to add staff');
        }
    };

    // Note: We don't have a dedicated endpoint to add staff yet (needs user creation or invitation).
    // For MVP, let's assume we can just add an existing user by email or ID?
    // Or maybe we create a new user?
    // Let's implement a simple "Add Staff by Email" if the backend supported it, but for now
    // I'll leave the Staff tab as a placeholder or implement a basic "Invite" mock.
    // Wait, the schema has StaffProfile. We need to create a StaffProfile.
    // I'll add a quick endpoint for that in the backend if needed, or just skip for now.
    // Let's stick to Services first as that's critical for booking.

    const serviceColumns = [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Duration (min)', dataIndex: 'duration', key: 'duration' },
        { title: 'Price ($)', dataIndex: 'price', key: 'price' },
    ];

    const staffColumns = [
        { title: 'Name', dataIndex: ['user', 'name'], key: 'name' },
        { title: 'Email', dataIndex: ['user', 'email'], key: 'email' },
    ];

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Header style={{ background: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center' }}>
                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginRight: 20 }} />
                <h2>Manage {shop?.name}</h2>
            </Header>
            <Content style={{ padding: '20px' }}>
                <div style={{ background: '#fff', padding: 24 }}>
                    <Tabs defaultActiveKey="1">
                        <Tabs.TabPane tab="Services" key="1">
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsServiceModalVisible(true)} style={{ marginBottom: 16 }}>
                                Add Service
                            </Button>
                            <Table dataSource={shop?.services} columns={serviceColumns} rowKey="id" />
                        </Tabs.TabPane>
                        <Tabs.TabPane tab="Staff" key="2">
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsStaffModalVisible(true)} style={{ marginBottom: 16 }}>
                                Add Staff
                            </Button>
                            <Table dataSource={shop?.staff} columns={staffColumns} rowKey="id" />
                            <p>Note: User must already be registered as 'Staff' to be added.</p>
                        </Tabs.TabPane>
                    </Tabs>
                </div>
            </Content>

            <Modal title="Add Service" open={isServiceModalVisible} onCancel={() => setIsServiceModalVisible(false)} onOk={() => form.submit()}>
                <Form form={form} onFinish={handleAddService} layout="vertical">
                    <Form.Item name="name" label="Service Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="duration" label="Duration (minutes)" rules={[{ required: true }]}>
                        <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="price" label="Price ($)" rules={[{ required: true }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal title="Add Staff" open={isStaffModalVisible} onCancel={() => setIsStaffModalVisible(false)} onOk={() => staffForm.submit()}>
                <Form form={staffForm} onFinish={handleAddStaff} layout="vertical">
                    <Form.Item name="email" label="Staff Email" rules={[{ required: true, type: 'email' }]}>
                        <Input placeholder="Enter email of registered staff member" />
                    </Form.Item>
                </Form>
            </Modal>
        </Layout>
    );
};

export default ManageShop;
