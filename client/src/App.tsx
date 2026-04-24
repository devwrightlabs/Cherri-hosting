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

export default function App() {
  return (
    <PiSDKProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </PiSDKProvider>
  );
}
