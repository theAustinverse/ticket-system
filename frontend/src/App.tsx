import { Link, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { EventListPage } from './pages/EventListPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { QueuePage } from './pages/QueuePage';
import { OrderPage } from './pages/OrderPage';
import { OrderStatusPage } from './pages/OrderStatusPage';
import { useAuth } from './context/AuthContext';

function NavBar() {
  const { token, logout } = useAuth();
  return (
    <nav className="navbar">
      <Link to="/events" className="brand">
        搶票系統
      </Link>
      {token ? (
        <button className="link-button" onClick={logout}>
          登出
        </button>
      ) : (
        <Link to="/login">登入</Link>
      )}
    </nav>
  );
}

export function App() {
  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<EventListPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/events" element={<EventListPage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/queue/:ticketTypeId" element={<QueuePage />} />
        <Route path="/order/:ticketTypeId" element={<OrderPage />} />
        <Route path="/orders/:orderId" element={<OrderStatusPage />} />
      </Routes>
    </>
  );
}
