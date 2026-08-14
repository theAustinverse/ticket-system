import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { CinematicBackground } from './components/CinematicBackground';
import { Prologue } from './components/Prologue';
import { BackgroundMusic } from './components/BackgroundMusic';
import { ChatWidget } from './components/ChatWidget';
import { LoginPage } from './pages/LoginPage';
import { EventListPage } from './pages/EventListPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { TrailerPage } from './pages/TrailerPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { QueuePage } from './pages/QueuePage';
import { OrderPage } from './pages/OrderPage';
import { OrderStatusPage } from './pages/OrderStatusPage';
import { ProfilePage } from './pages/ProfilePage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminOrdersPage } from './pages/AdminOrdersPage';
import { AdminEventsPage } from './pages/AdminEventsPage';
import { AdminChatPage } from './pages/AdminChatPage';
import { AdminAiImagePage } from './pages/AdminAiImagePage';
import { Lab3DPage } from './pages/Lab3DPage';
import { useAuth } from './context/AuthContext';
import { useAdminAuth } from './context/AdminAuthContext';
import { GuidedTour } from './tour/GuidedTour';
import { useTour } from './tour/TourProvider';

function NavBar() {
  const { token, logout } = useAuth();
  const { start } = useTour();
  return (
    <nav className="navbar">
      <Link to="/events" className="brand">
        售票系統
      </Link>
      {token ? (
        <div className="navbar-actions">
          <button className="link-button tour-launch" onClick={() => start()}>
            📖 使用教學
          </button>
          <Link to="/my-tickets">我的票卷</Link>
          <Link to="/profile">設定</Link>
          <button className="link-button" onClick={logout}>
            登出
          </button>
        </div>
      ) : (
        <div className="navbar-actions">
          <Link to="/login">登入</Link>
          <Link to="/login" state={{ mode: 'register' }}>
            註冊
          </Link>
        </div>
      )}
    </nav>
  );
}

function AdminNavBar() {
  const { token, logout } = useAdminAuth();
  return (
    <nav className="navbar">
      <Link to="/admin/dashboard" className="brand">
        後台管理系統
      </Link>
      {token && (
        <div className="navbar-actions">
          <button className="link-button" onClick={logout}>
            登出
          </button>
        </div>
      )}
    </nav>
  );
}

export function App() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <>
      <CinematicBackground />
      <Prologue />
      <BackgroundMusic />
      {!isAdminRoute && <ChatWidget />}
      {!isAdminRoute && <GuidedTour />}
      {isAdminRoute ? <AdminNavBar /> : <NavBar />}
      <Routes>
        <Route path="/" element={<EventListPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/events" element={<EventListPage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/trailer" element={<TrailerPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/my-tickets" element={<MyTicketsPage />} />
        <Route path="/register/:ticketTypeId" element={<RegistrationPage />} />
        <Route path="/queue/:ticketTypeId" element={<QueuePage />} />
        <Route path="/order/:ticketTypeId" element={<OrderPage />} />
        <Route path="/orders/:orderId" element={<OrderStatusPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/orders" element={<AdminOrdersPage />} />
        <Route path="/admin/events" element={<AdminEventsPage />} />
        <Route path="/admin/chat" element={<AdminChatPage />} />
        <Route path="/admin/ai-image" element={<AdminAiImagePage />} />
        {/* Not linked from any navbar — internal-only POC route. */}
        <Route path="/lab-3d" element={<Lab3DPage />} />
      </Routes>
    </>
  );
}
