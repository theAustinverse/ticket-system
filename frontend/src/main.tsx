import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { App } from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { AdminAuthProvider } from './context/AdminAuthContext.tsx';
import { TourProvider } from './tour/TourProvider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AdminAuthProvider>
          <TourProvider>
            <App />
          </TourProvider>
        </AdminAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
