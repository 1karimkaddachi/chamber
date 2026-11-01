import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { GuildProvider } from './lib/guild';
import { DashboardLayout } from './components/DashboardLayout';
import { Button, PageLoader } from './components/ui';
import { LoginPage } from './pages/Login';
import { NoServersPage } from './pages/NoServers';
import { NotFoundPage } from './pages/NotFound';
import { OverviewPage } from './pages/Overview';
import { GeneralPage } from './pages/General';
import { TriggersPage } from './pages/Triggers';
import { CategoriesPage } from './pages/Categories';
import { TemplatesPage } from './pages/Templates';
import { RoomTypesPage } from './pages/RoomTypes';
import { PermissionsPage } from './pages/Permissions';
import { PrivacyPage } from './pages/Privacy';
import { WaitingRoomPage } from './pages/WaitingRoom';
import { QueuePage } from './pages/Queue';
import { ReservationsPage } from './pages/Reservations';
import { AutomationPage } from './pages/Automation';
import { AIPage } from './pages/AI';
import { ActiveRoomsPage } from './pages/ActiveRooms';
import { AnalyticsPage } from './pages/Analytics';
import { LogsPage } from './pages/Logs';
import { PremiumPage } from './pages/Premium';
import { AdvancedPage } from './pages/Advanced';

function RequireAuth() {
  const { me, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!me) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function HomeRedirect() {
  const { me } = useAuth();
  if (!me) return <Navigate to="/login" replace />;
  if (me.guilds.length === 0) return <NoServersPage />;
  const last = localStorage.getItem('chamber:last-guild');
  const target = me.guilds.find((guild) => guild.id === last) ?? me.guilds[0];
  return <Navigate to={`/g/${target.id}`} replace />;
}

function GuildLayout() {
  const { guildId } = useParams();
  const { me } = useAuth();
  const navigate = useNavigate();
  if (!guildId) return <Navigate to="/" replace />;
  const guild = me?.guilds.find((entry) => entry.id === guildId);
  if (!guild) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <h1 className="font-display text-xl font-semibold">No access to this server</h1>
          <p className="mt-2 text-sm text-muted">
            Your Discord roles do not grant access to this server, or the bot is not installed there.
          </p>
          <Button variant="primary" className="mt-5" onClick={() => navigate('/')}>
            Choose a server
          </Button>
        </div>
      </div>
    );
  }
  return (
    <GuildProvider key={guildId} guildId={guildId}>
      <DashboardLayout />
    </GuildProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/g/:guildId" element={<GuildLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="general" element={<GeneralPage />} />
          <Route path="triggers" element={<TriggersPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="room-types" element={<RoomTypesPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="waiting-room" element={<WaitingRoomPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="ai" element={<AIPage />} />
          <Route path="active-rooms" element={<ActiveRoomsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="premium" element={<PremiumPage />} />
          <Route path="advanced" element={<AdvancedPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
