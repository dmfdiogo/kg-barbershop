import React, { useState, useEffect } from 'react';
import { Layout, Menu, List, message, Switch, TimePicker, Button } from 'antd';
import { LogoutOutlined, ScheduleOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import dayjs from 'dayjs';

const { Header, Content, Sider } = Layout;

const StaffDashboard: React.FC = () => {
    const { logout, user } = useAuth();
    const [appointments, setAppointments] = useState<any[]>([]);

    const [schedules, setSchedules] = useState<any[]>([]);

    useEffect(() => {
        const fetchAppointments = async () => {
            try {
                const response = await api.get('/appointments');
                setAppointments(response.data);
            } catch (error) {
                message.error('Failed to fetch appointments');
            }
        };

        const fetchSchedule = async () => {
            try {
                const response = await api.get('/schedule');
                // Initialize with default if empty
                if (response.data.length === 0) {
                    const defaultSchedule = Array.from({ length: 7 }, (_, i) => ({
                        dayOfWeek: i,
                        startTime: '09:00',
                        endTime: '17:00',
                        isAvailable: i > 0 && i < 6 // Mon-Fri default
                    }));
                    setSchedules(defaultSchedule);
                } else {
                    setSchedules(response.data);
                }
            } catch (error) {
                console.error('Failed to fetch schedule');
            }
        };

        fetchAppointments();
        fetchSchedule();
    }, []);

    const handleSaveSchedule = async () => {
        try {
            await api.post('/schedule', { schedules });
            message.success('Schedule updated');
        } catch (error) {
            message.error('Failed to update schedule');
        }
    };

    const updateScheduleItem = (index: number, field: string, value: any) => {
        const newSchedules = [...schedules];
        newSchedules[index] = { ...newSchedules[index], [field]: value };
        setSchedules(newSchedules);
    };

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider collapsible>
                <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)' }} />
                <Menu theme="dark" defaultSelectedKeys={['1']} mode="inline">
                    <Menu.Item key="1" icon={<ScheduleOutlined />}>
                        My Appointments
                    </Menu.Item>
                    <Menu.Item key="2" icon={<ScheduleOutlined />}>
                        Manage Schedule
                    </Menu.Item>
                    <Menu.Item key="3" icon={<LogoutOutlined />} onClick={logout}>
                        Logout
                    </Menu.Item>
                </Menu>
            </Sider>
            <Layout className="site-layout">
                <Header style={{ padding: 0, background: '#fff' }}>
                    <h2 style={{ marginLeft: 20 }}>Staff Dashboard - {user?.name}</h2>
                </Header>
                <Content style={{ margin: '0 16px' }}>
                    <div style={{ padding: 24, minHeight: 360 }}>
                        <h3>Manage Schedule</h3>
                        <List
                            dataSource={schedules}
                            renderItem={(item, index) => (
                                <List.Item>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
                                        <div style={{ width: 100 }}>{days[item.dayOfWeek]}</div>
                                        <Switch
                                            checked={item.isAvailable}
                                            onChange={(checked) => updateScheduleItem(index, 'isAvailable', checked)}
                                        />
                                        {item.isAvailable && (
                                            <>
                                                <TimePicker
                                                    format="HH:mm"
                                                    value={dayjs(item.startTime, 'HH:mm')}
                                                    onChange={(time) => updateScheduleItem(index, 'startTime', time?.format('HH:mm'))}
                                                />
                                                <span>to</span>
                                                <TimePicker
                                                    format="HH:mm"
                                                    value={dayjs(item.endTime, 'HH:mm')}
                                                    onChange={(time) => updateScheduleItem(index, 'endTime', time?.format('HH:mm'))}
                                                />
                                            </>
                                        )}
                                    </div>
                                </List.Item>
                            )}
                        />
                        <Button type="primary" onClick={handleSaveSchedule} style={{ marginTop: 20 }}>Save Schedule</Button>

                        <h3 style={{ marginTop: 40 }}>Upcoming Appointments</h3>
                        <List
                            itemLayout="horizontal"
                            dataSource={appointments}
                            renderItem={(item: any) => (
                                <List.Item>
                                    <List.Item.Meta
                                        title={`${item.service.name} with ${item.customer.name}`}
                                        description={`${new Date(item.startTime).toLocaleString()} - Status: ${item.status}`}
                                    />
                                </List.Item>
                            )}
                        />
                    </div>
                </Content>
            </Layout>
        </Layout>
    );
};

export default StaffDashboard;
