'use client';

import {
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  BellRing,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  Database,
  FileClock,
  Gauge,
  Globe,
  GraduationCap,
  HeartHandshake,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  Mail,
  Map,
  MapPin,
  Megaphone,
  MessageSquareLock,
  MessagesSquare,
  PhoneCall,
  PlugZap,
  Route,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Smartphone,
  SmartphoneNfc,
  Timer,
  UserCog,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

/**
 * Super Admin Control Center navigation categorized into 6 collapsible operational groups.
 * Real-time badges and permissions are evaluated server-side and client-side.
 */
const nav: NavItem[] = [
  // 1. Overview
  { group: 'Overview', href: '/super-admin/dashboard', label: 'Dashboard', icon: Gauge, exact: true },
  { group: 'Overview', href: '/super-admin/activity-center', label: 'Activity Center', icon: ListTodo, badgeKey: 'activity' },

  // 2. People & Access
  { group: 'People & Access', href: '/super-admin/users', label: 'All Users', icon: Users, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/users/students', label: 'Students', icon: GraduationCap, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/users/campus-admins', label: 'Campus Admins', icon: Building2, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/users/counsellors', label: 'Counsellors', icon: HeartHandshake, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/users/officers', label: 'Safety Officers', icon: Siren, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/users/super-admins', label: 'Super Admins', icon: ShieldAlert, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/roles', label: 'Roles & Permissions', icon: UserCog, permission: 'roles:manage' },
  { group: 'People & Access', href: '/super-admin/users/verifications', label: 'Verification Queue', icon: CheckCheck, permission: 'users:manage', badgeKey: 'verifications' },
  { group: 'People & Access', href: '/super-admin/users/sessions', label: 'Login Sessions', icon: KeyRound, permission: 'users:manage' },
  { group: 'People & Access', href: '/super-admin/committees', label: 'Committees', icon: Building2, permission: 'committees:manage' },

  // 3. Safety Operations
  { group: 'Safety Operations', href: '/super-admin/emergency-alerts', label: 'SOS Alerts', icon: Siren, permission: 'sos:dispatch', badgeKey: 'sos' },
  { group: 'Safety Operations', href: '/super-admin/campus-map', label: 'Campus Map & Routes', icon: MapPin },
  { group: 'Safety Operations', href: '/super-admin/live-map', label: 'Safe Walk & Live Map', icon: Map },
  { group: 'Safety Operations', href: '/super-admin/duty-roster', label: 'Duty Roster', icon: CalendarClock, permission: 'duty:view' },
  { group: 'Safety Operations', href: '/super-admin/responders', label: 'Responders', icon: UserRoundCheck, permission: 'duty:view' },
  { group: 'Safety Operations', href: '/super-admin/live-ops', label: 'Response Metrics', icon: Activity },

  // 4. Communication
  // Chats replaces the former Reports / "Incidents & Complaints" entry: user-submitted reports live under Chats › Reports.
  { group: 'Communication', href: '/super-admin/chats', label: 'Chats', icon: MessagesSquare, badgeKey: 'chats' },
  { group: 'Communication', href: '/super-admin/counselling-channel', label: 'Channels', icon: BadgeCheck, permission: 'community_channels:manage' },
  { group: 'Communication', href: '/super-admin/chat', label: 'Chat Settings', icon: MessageSquareLock, permission: 'chat:configure' },
  { group: 'Communication', href: '/super-admin/support', label: 'Support Center', icon: LifeBuoy, permission: 'support:manage', badgeKey: 'support' },
  { group: 'Communication', href: '/super-admin/notifications', label: 'Notifications', icon: Bell },
  { group: 'Communication', href: '/super-admin/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements:manage' },
  { group: 'Communication', href: '/super-admin/email', label: 'Email Operations', icon: Mail, permission: 'email:manage' },

  // 5. Services
  { group: 'Services', href: '/super-admin/counselling', label: 'Counselling Operations', icon: CalendarDays, permission: 'appointments:read_aggregate' },
  { group: 'Services', href: '/super-admin/counselling-insights', label: 'Counselling Insights', icon: BarChart3, permission: 'appointments:read_aggregate' },
  { group: 'Services', href: '/super-admin/community', label: 'Community Safety', icon: HeartHandshake, permission: 'community_safety:manage' },
  { group: 'Services', href: '/super-admin/moderation', label: 'Community Moderation', icon: ShieldCheck, permission: 'chat:moderate' },
  { group: 'Services', href: '/super-admin/awareness', label: 'Awareness & Training', icon: BookOpenCheck, permission: 'training:manage' },
  { group: 'Services', href: '/super-admin/contacts', label: 'Emergency Contacts', icon: PhoneCall, permission: 'contacts:manage' },

  // 6. System Administration
  { group: 'System Administration', href: '/super-admin/analytics', label: 'Analytics & Reports', icon: BarChart3, permission: 'analytics:read' },
  { group: 'System Administration', href: '/super-admin/audit-logs', label: 'Database Activity & Audit Logs', icon: FileClock, permission: 'audit:read' },
  { group: 'System Administration', href: '/super-admin/security', label: 'Security Center', icon: ShieldAlert, permission: 'security:manage' },
  { group: 'System Administration', href: '/super-admin/settings', label: 'Application Settings & Health', icon: Settings, permission: 'settings:manage' },
  { group: 'System Administration', href: '/super-admin/data-governance', label: 'Data Governance', icon: Database, permission: 'retention:manage' },
  { group: 'System Administration', href: '/super-admin/retention', label: 'Data Retention', icon: Timer, permission: 'retention:manage' },
  { group: 'System Administration', href: '/super-admin/mobile-app', label: 'Mobile App Settings', icon: Smartphone, permission: 'settings:manage' },
  { group: 'System Administration', href: '/super-admin/integrations', label: 'Integrations', icon: PlugZap, permission: 'settings:manage' },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell portal="Super Admin" nav={nav} roles={['super_admin']} permission="super_admin:access">
      {children}
    </PortalShell>
  );
}
