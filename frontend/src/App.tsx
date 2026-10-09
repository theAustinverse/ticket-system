import { lazy, Suspense } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CinematicBackground } from './components/CinematicBackground';
import { Prologue } from './components/Prologue';
import { BackgroundMusic } from './components/BackgroundMusic';
import { ChatWidget } from './components/ChatWidget';
import { HelpWidget } from './components/HelpWidget';
import { LoginPage } from './pages/LoginPage';
import { EventListPage } from './pages/EventListPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { QueuePage } from './pages/QueuePage';
import { OrderPage } from './pages/OrderPage';
import { OrderStatusPage } from './pages/OrderStatusPage';
import { ProfilePage } from './pages/ProfilePage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { PublicTicketPage } from './pages/PublicTicketPage';
import { CHECKIN_TOKEN_KEY } from './api/client';
import { decodeJwtClaim } from './jwt';
import { useAuth } from './context/AuthContext';
import { useAdminAuth } from './context/AdminAuthContext';
import { GuidedTour } from './tour/GuidedTour';
import { useTour } from './tour/TourProvider';
import { RouteFx, useRouteTransition } from './transitions/RouteTransition';
import { PageLoading } from './components/PageLoading';
import { NoticeMarquee } from './components/NoticeMarquee';

// Pages that most visitors never open (back office, door scanner, 3D lab, the
// trailer) are split into their own chunks so they don't weigh down the first
// load — the 3D lab alone pulled three.js into the main bundle. The buyer's
// purchase path (event list -> register -> queue -> order) stays eager on
// purpose: a chunk fetched mid-rush would add a network round trip exactly
// when the queue is longest.
const TrailerPage = lazy(() => import('./pages/TrailerPage').then((m) => ({ default: m.TrailerPage })));
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AdminOrdersPage = lazy(() => import('./pages/AdminOrdersPage').then((m) => ({ default: m.AdminOrdersPage })));
const AdminEventsPage = lazy(() => import('./pages/AdminEventsPage').then((m) => ({ default: m.AdminEventsPage })));
const AdminHelpPage = lazy(() => import('./pages/AdminHelpPage').then((m) => ({ default: m.AdminHelpPage })));
const AdminChatPage = lazy(() => import('./pages/AdminChatPage').then((m) => ({ default: m.AdminChatPage })));
const AdminAiImagePage = lazy(() => import('./pages/AdminAiImagePage').then((m) => ({ default: m.AdminAiImagePage })));
const Lab3DPage = lazy(() => import('./pages/Lab3DPage').then((m) => ({ default: m.Lab3DPage })));
const CheckinLoginPage = lazy(() => import('./pages/CheckinLoginPage').then((m) => ({ default: m.CheckinLoginPage })));
const CheckinPage = lazy(() => import('./pages/CheckinPage').then((m) => ({ default: m.CheckinPage })));
const CheckinRosterPage = lazy(() => import('./pages/CheckinRosterPage').then((m) => ({ default: m.CheckinRosterPage })));
const EntryGuidePage = lazy(() => import('./pages/EntryGuidePage').then((m) => ({ default: m.EntryGuidePage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then((m) => ({ default: m.ContactPage })));
const AdminContactsPage = lazy(() => import('./pages/AdminContactsPage').then((m) => ({ default: m.AdminContactsPage })));
const AdminSponsorshipsPage = lazy(() => import('./pages/AdminSponsorshipsPage').then((m) => ({ default: m.AdminSponsorshipsPage })));

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
          <Link to="/entry-guide">🧸 入場教學</Link>
          <Link to="/contact">聯絡我們</Link>
          <Link to="/my-tickets">我的票券</Link>
          <Link to="/profile">設定</Link>
          <button className="link-button" onClick={logout}>
            登出
          </button>
        </div>
      ) : (
        <div className="navbar-actions">
          <Link to="/entry-guide">🧸 入場教學</Link>
          <Link to="/contact">聯絡我們</Link>
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

function CheckinNavBar() {
  const navigate = useNavigate();
  const token = localStorage.getItem(CHECKIN_TOKEN_KEY);
  const staffName = token ? decodeJwtClaim(token, 'name') : null;
  return (
    <nav className="navbar">
      <span className="brand">報到系統</span>
      {token && (
        <div className="navbar-actions">
          <Link to="/checkin">掃描</Link>
          <Link to="/checkin/roster">名單</Link>
          <span className="hint">{staffName ?? '後台'}</span>
          <button
            className="link-button"
            onClick={() => {
              localStorage.removeItem(CHECKIN_TOKEN_KEY);
              navigate('/checkin/login');
            }}
          >
            登出
          </button>
        </div>
      )}
    </nav>
  );
}

export function App() {
  const location = useLocation();
  const { shown, fx, done } = useRouteTransition();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isCheckinRoute = location.pathname.startsWith('/checkin');
  // A guest opening their shared ticket at the door, or a scanner phone, must
  // see the page immediately: no intro overlay, no music starting on the
  // first tap, no chat bubble or tour covering the QR / the camera.
  const isBareRoute = isCheckinRoute || location.pathname.startsWith('/t/');

  return (
    <>
      {!isCheckinRoute && <CinematicBackground />}
      {!isBareRoute && <Prologue />}
      {!isBareRoute && <BackgroundMusic />}
      {!isAdminRoute && !isBareRoute && <ChatWidget />}
      {!isAdminRoute && !isBareRoute && <HelpWidget />}
      {!isAdminRoute && !isBareRoute && <GuidedTour />}
      {!isAdminRoute && !isBareRoute && <NoticeMarquee />}
      {isCheckinRoute ? <CheckinNavBar /> : isAdminRoute ? <AdminNavBar /> : <NavBar />}
      <Suspense fallback={<PageLoading />}>
      <Routes location={shown}>
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
        <Route path="/entry-guide" element={<EntryGuidePage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/t/:token" element={<PublicTicketPage />} />
        <Route path="/checkin/login" element={<CheckinLoginPage />} />
        <Route path="/checkin" element={<CheckinPage />} />
        <Route path="/checkin/roster" element={<CheckinRosterPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/orders" element={<AdminOrdersPage />} />
        <Route path="/admin/events" element={<AdminEventsPage />} />
        <Route path="/admin/contacts" element={<AdminContactsPage />} />
        <Route path="/admin/sponsorships" element={<AdminSponsorshipsPage />} />
        <Route path="/admin/help" element={<AdminHelpPage />} />
        <Route path="/admin/chat" element={<AdminChatPage />} />
        <Route path="/admin/ai-image" element={<AdminAiImagePage />} />
        {/* Not linked from any navbar — internal-only POC route. */}
        <Route path="/lab-3d" element={<Lab3DPage />} />
      </Routes>
      </Suspense>
      {fx && <RouteFx fx={fx} onDone={done} />}
    </>
  );
}
