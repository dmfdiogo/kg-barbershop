import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import { AuthProvider, useAuth } from './context/AuthContext';

import Dashboard from './pages/Dashboard';
import BookingPage from './pages/customer/BookingPage';
import HistoryPage from './pages/customer/HistoryPage';
import ManageShop from './pages/admin/ManageShop';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/manage/:slug" element={
            <PrivateRoute>
              <ManageShop />
            </PrivateRoute>
          } />
          <Route path="/book/:slug" element={
            <PrivateRoute>
              <BookingPage />
            </PrivateRoute>
          } />
          <Route path="/history" element={
            <PrivateRoute>
              <HistoryPage />
            </PrivateRoute>
          } />
          <Route path="/" element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } />
        </Routes>
      </Router>
    </AuthProvider>
  );
};

export default App;
