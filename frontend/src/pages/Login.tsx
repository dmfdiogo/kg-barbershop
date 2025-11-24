import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const { Title } = Typography;

const Login: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { login } = useAuth();

    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            const response = await api.post('/auth/login', values);
            login(response.data.token, response.data.user);
            message.success('Login successful');
            navigate('/');
        } catch (error: any) {
            message.error(error.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
            <Card style={{ width: 400 }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <Title level={2}>Barber Shop</Title>
                    <p>Sign in to your account</p>
                </div>
                <Form name="login" onFinish={onFinish} layout="vertical">
                    <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                        <Input size="large" />
                    </Form.Item>
                    <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                        <Input.Password size="large" />
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" htmlType="submit" block size="large" loading={loading} style={{ backgroundColor: 'black', borderColor: 'black' }}>
                            Log in
                        </Button>
                    </Form.Item>
                    <div style={{ textAlign: 'center' }}>
                        Or <Link to="/register">register now!</Link>
                    </div>
                </Form>
            </Card>
        </div>
    );
};

export default Login;
