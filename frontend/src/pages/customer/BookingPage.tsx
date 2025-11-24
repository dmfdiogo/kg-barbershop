import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Button, Form, Select, DatePicker, message, Card, Typography, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import api from '../../services/api';
import dayjs from 'dayjs';

const { Header, Content } = Layout;
const { Title } = Typography;
const { Option } = Select;

const BookingPage: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [shop, setShop] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [availableSlots, setAvailableSlots] = useState<string[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

    // Form values to trigger availability fetch
    const [selectedService, setSelectedService] = useState<number | null>(null);
    const [selectedBarber, setSelectedBarber] = useState<number | null>(null);
    const [selectedDate, setSelectedDate] = useState<dayjs.Dayjs | null>(null);

    useEffect(() => {
        const fetchShop = async () => {
            try {
                const response = await api.get(`/shops/${slug}`);
                setShop(response.data);
            } catch (error) {
                message.error('Failed to load shop details');
                navigate('/');
            } finally {
                setLoading(false);
            }
        };
        fetchShop();
    }, [slug, navigate]);

    useEffect(() => {
        const fetchAvailability = async () => {
            if (selectedService && selectedBarber && selectedDate) {
                try {
                    const dateStr = selectedDate.format('YYYY-MM-DD');
                    const response = await api.get('/appointments/availability', {
                        params: {
                            barberId: selectedBarber,
                            serviceId: selectedService,
                            date: dateStr
                        }
                    });
                    setAvailableSlots(response.data);
                    setSelectedSlot(null); // Reset selection when params change
                } catch (error) {
                    console.error('Failed to fetch availability');
                }
            }
        };
        fetchAvailability();
    }, [selectedService, selectedBarber, selectedDate]);

    const onFinish = async () => {
        if (!selectedSlot) {
            message.error('Please select a time slot');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/appointments', {
                shopId: shop.id,
                barberId: selectedBarber,
                serviceId: selectedService,
                startTime: selectedSlot,
            });
            message.success('Appointment booked successfully!');
            navigate('/');
        } catch (error: any) {
            message.error(error.response?.data?.error || 'Booking failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', marginTop: 50 }}><Spin size="large" /></div>;

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Header style={{ background: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center' }}>
                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginRight: 20 }} />
                <Title level={4} style={{ margin: 0 }}>Book at {shop?.name}</Title>
            </Header>
            <Content style={{ padding: '20px', maxWidth: 600, margin: '0 auto', width: '100%' }}>
                <Card>
                    <Form layout="vertical" onFinish={onFinish}>
                        <Form.Item label="Select Service" required>
                            <Select placeholder="Choose a service" onChange={setSelectedService}>
                                {shop?.services.map((s: any) => (
                                    <Option key={s.id} value={s.id}>{s.name} - ${s.price} ({s.duration}m)</Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item label="Select Barber" required>
                            <Select placeholder="Choose a barber" onChange={setSelectedBarber}>
                                {shop?.staff.map((s: any) => (
                                    <Option key={s.id} value={s.id}>{s.user.name}</Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item label="Select Date" required>
                            <DatePicker
                                style={{ width: '100%' }}
                                onChange={setSelectedDate}
                                disabledDate={(current) => current && current < dayjs().startOf('day')}
                            />
                        </Form.Item>

                        {selectedService && selectedBarber && selectedDate && (
                            <div style={{ marginBottom: 24 }}>
                                <h4>Available Slots</h4>
                                {availableSlots.length === 0 ? (
                                    <p>No slots available for this date.</p>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 10 }}>
                                        {availableSlots.map(slot => (
                                            <Button
                                                key={slot}
                                                type={selectedSlot === slot ? 'primary' : 'default'}
                                                onClick={() => setSelectedSlot(slot)}
                                            >
                                                {dayjs(slot).format('HH:mm')}
                                            </Button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <Button type="primary" htmlType="submit" block loading={submitting} size="large" disabled={!selectedSlot}>
                            Confirm Booking
                        </Button>
                    </Form>
                </Card>
            </Content>
        </Layout>
    );
};

export default BookingPage;
