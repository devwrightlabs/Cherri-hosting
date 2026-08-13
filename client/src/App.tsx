import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { PiSDKProvider } from './providers/PiSDKProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Deploy from './pages/Deploy';
import Pricing from './pages/Pricing';
import Account from './pages/Account';
import Billing from './pages/Billing';
import ProjectDetail from './pages/ProjectDetail';
import { SupportList, SupportDetail } from './pages/Support';
import ProtectedRoute from './components/ProtectedRoute';

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/pricing', element: <Pricing /> },
  {
    path: '/account',
    element: (
      <ProtectedRoute>
        <Account />
      </ProtectedRoute>
    ),
  },
  {
    path: '/billing',
    element: (
      <ProtectedRoute>
        <Billing />
      </ProtectedRoute>
    ),
  },
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
  {
    path: '/support',
    element: (
      <ProtectedRoute>
        <SupportList />
      </ProtectedRoute>
    ),
  },
  {
    path: '/support/:id',
    element: (
      <ProtectedRoute>
        <SupportDetail />
      </ProtectedRoute>
    ),
  },
]);

export default function App() {
  return (
    <PiSDKProvider>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </PiSDKProvider>
  );
}
