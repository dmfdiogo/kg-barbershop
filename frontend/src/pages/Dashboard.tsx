import React from 'react';
import { useAuth } from '../context/AuthContext';
import AdminDashboard from './admin/AdminDashboard';
import StaffDashboard from './staff/StaffDashboard';
import CustomerDashboard from './customer/CustomerDashboard';

const Dashboard: React.FC = () => {
    const { user } = useAuth();

    if (user?.role === 'ADMIN') {
        return <AdminDashboard />;
    }

    if (user?.role === 'STAFF') {
        return <StaffDashboard />;
    }

    return <CustomerDashboard />;
};

export default Dashboard;
