import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Modal, Form, Input, message, Card } from 'antd';
import { ShopOutlined, UserOutlined, LogoutOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const { Header, Content, Sider } = Layout;

const AdminDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [shops, setShops] = useState<any[]>([]);
    const [form] = Form.useForm();
    const navigate = useNavigate();

    const fetchShops = async () => {
        try {
            const response = await api.get('/shops');
            setShops(response.data);
        } catch (error) {
            message.error('Failed to fetch shops');
        }
    };

    useEffect(() => {
        fetchShops();
    }, []);

    const handleCreateShop = async (values: any) => {
        try {
            await api.post('/shops', values);
            message.success('Shop created successfully');
            setIsModalVisible(false);
            form.resetFields();
            fetchShops();
        } catch (error: any) {
            message.error(error.response?.data?.error || 'Failed to create shop');
        }
    };

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider collapsible>
                <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)' }} />
                <Menu theme="dark" defaultSelectedKeys={['1']} mode="inline">
                    <Menu.Item key="1" icon={<ShopOutlined />}>
                        My Shops
                    </Menu.Item>
                    <Menu.Item key="2" icon={<UserOutlined />}>
                        Staff
                    </Menu.Item>
                    <Menu.Item key="3" icon={<LogoutOutlined />} onClick={logout}>
                        Logout
                    </Menu.Item>
                </Menu>
            </Sider>
            <Layout className="site-layout">
                <Header style={{ padding: 0, background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 20 }}>
                    <h2 style={{ marginLeft: 20 }}>Admin Dashboard - {user?.name}</h2>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
                        Create Shop
                    </Button>
                </Header>
                <Content style={{ margin: '0 16px' }}>
                    <div style={{ padding: 24, minHeight: 360 }}>
                        <h3>Your Shops</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                            {shops.map(shop => (
                                <Card key={shop.id} title={shop.name} extra={<Button type="link" onClick={() => navigate(`/manage/${shop.slug}`)}>Manage</Button>}>
                                    <p>URL: {shop.slug}</p>
                                    <p>Services: {shop._count?.services || 0}</p>
                                    <p>Staff: {shop._count?.staff || 0}</p>
                                </Card>
                            ))}
                        </div>
                    </div>
                </Content>
            </Layout>

            <Modal title="Create New Shop" open={isModalVisible} onCancel={() => setIsModalVisible(false)} onOk={() => form.submit()}>
                <Form form={form} onFinish={handleCreateShop} layout="vertical">
                    <Form.Item name="name" label="Shop Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="slug" label="URL Slug" rules={[{ required: true }]}>
                        <Input addonBefore="app.com/" />
                    </Form.Item>
                </Form>
            </Modal>
        </Layout>
    );
};

export default AdminDashboard;
