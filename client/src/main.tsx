import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { PiSDKProvider } from './providers/PiSDKProvider';
import { AuthProvider } from './providers/AuthProvider';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Deploy from './pages/Deploy';
import Pricing from './pages/Pricing';
import ProjectDetail from './pages/ProjectDetail';
import ProtectedRoute from './components/ProtectedRoute';
import './index.css';

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/pricing', element: <Pricing /> },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
  {
    path: '/projects',
    element: (
      <ProtectedRoute>
        <Projects />
      </ProtectedRoute>
    ),
  },
  {
    path: '/projects/:id',
    element: (
      <ProtectedRoute>
        <ProjectDetail />
      </ProtectedRoute>
    ),
  },
  {
    path: '/deploy',
    element: (
      <ProtectedRoute>
        <Deploy />
      </ProtectedRoute>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PiSDKProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </PiSDKProvider>
  </React.StrictMode>,
);
