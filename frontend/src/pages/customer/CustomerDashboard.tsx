import React, { useState, useEffect } from 'react';
import { Layout, Button, Card, message } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';

const { Header, Content } = Layout;

const CustomerDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [shops, setShops] = useState<any[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchShops = async () => {
            try {
                const response = await api.get('/shops');
                setShops(response.data);
            } catch (error) {
                message.error('Failed to fetch shops');
            }
        };
        fetchShops();
    }, []);

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px' }}>
                <div style={{ color: 'white', fontSize: '1.2rem', fontWeight: 'bold' }}>Barber Shop App</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: 'white' }}>Welcome, {user?.name}</span>
                    <Button type="text" style={{ color: 'white' }} icon={<LogoutOutlined />} onClick={logout}>
                        Logout
                    </Button>
                </div>
            </Header>
            <Content style={{ padding: '50px' }}>
                <div style={{ background: '#fff', padding: 24, minHeight: 280 }}>
                    <h2>Find a Barber Shop</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginTop: 20 }}>
                        {shops.map(shop => (
                            <Card key={shop.id} title={shop.name} extra={<Button type="primary" onClick={() => navigate(`/book/${shop.slug}`)}>Book Now</Button>}>
                                <p>Owner: {shop.owner?.name}</p>
                                <p>Services available: {shop._count?.services || 0}</p>
                            </Card>
                        ))}
                    </div>
                </div>
            </Content>
        </Layout>
    );
};

export default CustomerDashboard;
