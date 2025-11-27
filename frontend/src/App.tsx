import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

import Dashboard from './pages/Dashboard';
import BookingPage from './pages/customer/BookingPage';
import HistoryPage from './pages/customer/HistoryPage';
import ManageShop from './pages/admin/ManageShop';
import PaymentSuccess from './pages/customer/PaymentSuccess';
import PaymentCancel from './pages/customer/PaymentCancel';
import PlansPage from './pages/customer/PlansPage';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const RoleRoute: React.FC<{ children: React.ReactNode; allowedRoles: string[] }> = ({ children, allowedRoles }) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/payment/success" element={<PaymentSuccess />} />
          <Route path="/payment/cancel" element={<PaymentCancel />} />

          <Route path="/manage/:slug" element={
            <RoleRoute allowedRoles={['ADMIN']}>
              <Layout>
                <ManageShop />
              </Layout>
            </RoleRoute>
          } />
          <Route path="/book/:slug" element={
            <PrivateRoute>
              <Layout>
                <BookingPage />
              </Layout>
            </PrivateRoute>
          } />
          <Route path="/history" element={
            <PrivateRoute>
              <Layout>
                <HistoryPage />
              </Layout>
            </PrivateRoute>
          } />
          <Route path="/plans" element={
            <PrivateRoute>
              <Layout>
                <PlansPage />
              </Layout>
            </PrivateRoute>
          } />
          <Route path="/" element={
            <PrivateRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </PrivateRoute>
          } />
        </Routes>
      </Router>
    </AuthProvider>
  );
};

export default App;

