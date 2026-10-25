'use client';

import {
  Activity, BadgeCheck, BarChart3, Bell, BellRing, BookOpenCheck, Building2, CalendarClock, CalendarDays, Database, FileClock, FolderKanban, Gauge, Globe, HeartHandshake,
  KeyRound, LayoutDashboard, Mail, Map, Megaphone, MessageSquareLock, MessagesSquare, PhoneCall, PlugZap, Route, Settings, ShieldAlert, ShieldCheck, Siren,
  Smartphone, SmartphoneNfc, Timer, UserCog, UserRoundCheck, Users,
} from 'lucide-react';
import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

/**
 * The website is the Super Admin control centre. Students, staff, administrators and moderators
 * use the Android app; everything configured here reaches installed apps through the API.
 * Items are hidden when the signed-in account lacks the permission — the API enforces the same rules.
 */
const nav: NavItem[] = [
  { group: 'Operations', href: '/super-admin/dashboard', label: 'Dashboard', icon: Gauge },
  { group: 'Operations', href: '/super-admin/emergency-alerts', label: 'Emergency alerts', icon: Siren, permission: 'sos:dispatch' },
  { group: 'Operations', href: '/super-admin/live-map', label: 'Live map', icon: Map },
  { group: 'Operations', href: '/super-admin/duty-roster', label: 'Duty roster', icon: CalendarClock, permission: 'duty:view' },
  { group: 'Operations', href: '/super-admin/responders', label: 'Responders', icon: UserRoundCheck, permission: 'duty:view' },
  { group: 'Operations', href: '/super-admin/live-ops', label: 'Response metrics', icon: Activity },
  { group: 'Operations', href: '/super-admin/incidents', label: 'Incidents', icon: FolderKanban, permission: 'incidents:triage' },
  { group: 'Operations', href: '/super-admin/campus-alerts', label: 'Campus alerts', icon: BellRing, permission: 'campus_alerts:manage' },

  { group: 'People & access', href: '/super-admin/users', label: 'Users', icon: Users, permission: 'users:manage' },
  { group: 'People & access', href: '/super-admin/roles', label: 'Roles & permissions', icon: UserCog, permission: 'roles:manage' },
  { group: 'People & access', href: '/super-admin/committees', label: 'Committees', icon: Building2, permission: 'committees:manage' },
  { group: 'People & access', href: '/super-admin/chat-access', label: 'Chat access', icon: MessageSquareLock, permission: 'chat:configure' },
  { group: 'People & access', href: '/super-admin/chat', label: 'Support & chat', icon: MessagesSquare, permission: 'chat:configure' },
  { group: 'People & access', href: '/super-admin/case-routing', label: 'Case routing', icon: Route, permission: 'routing:manage' },

  { group: 'Security', href: '/super-admin/security', label: 'Security', icon: ShieldAlert, permission: 'security:manage' },
  { group: 'Security', href: '/super-admin/authenticator', label: 'Authenticator', icon: SmartphoneNfc },
  { group: 'Security', href: '/super-admin/identity-providers', label: 'Identity providers', icon: KeyRound, permission: 'identity_providers:manage' },
  { group: 'Security', href: '/super-admin/domains', label: 'Domains', icon: Globe, permission: 'domains:manage' },
  { group: 'Security', href: '/super-admin/audit-logs', label: 'Audit logs', icon: FileClock, permission: 'audit:read' },

  { group: 'Communication', href: '/super-admin/notifications', label: 'Notifications', icon: Bell },
  { group: 'Communication', href: '/super-admin/email', label: 'Email', icon: Mail, permission: 'email:manage' },
  { group: 'Communication', href: '/super-admin/announcements', label: 'Announcements & events', icon: Megaphone, permission: 'announcements:manage' },

  { group: 'Campus safety', href: '/super-admin/campus', label: 'Campus overview', icon: LayoutDashboard, permission: 'analytics:read' },
  { group: 'Campus safety', href: '/super-admin/safety-intel', label: 'Safety intelligence', icon: ShieldCheck, permission: 'safety_intel:manage' },
  { group: 'Campus safety', href: '/super-admin/community', label: 'Community safety', icon: HeartHandshake, permission: 'community_safety:manage' },
  { group: 'Campus safety', href: '/super-admin/moderation', label: 'Community moderation', icon: ShieldCheck, permission: 'chat:moderate' },
  { group: 'Campus safety', href: '/super-admin/awareness', label: 'Awareness & training', icon: BookOpenCheck, permission: 'training:manage' },
  { group: 'Campus safety', href: '/super-admin/contacts', label: 'Emergency contacts', icon: PhoneCall, permission: 'contacts:manage' },
  { group: 'Campus safety', href: '/super-admin/counselling', label: 'Counselling overview', icon: CalendarDays, permission: 'appointments:read_aggregate' },
  { group: 'Campus safety', href: '/super-admin/counselling-channel', label: 'Counselling channel', icon: BadgeCheck, permission: 'community_channels:manage' },
  { group: 'Campus safety', href: '/super-admin/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics:read' },

  { group: 'Platform', href: '/super-admin/sos', label: 'SOS & safety settings', icon: Siren, permission: 'sos:configure' },
  { group: 'Platform', href: '/super-admin/mobile-app', label: 'Mobile app', icon: Smartphone, permission: 'settings:manage' },
  { group: 'Platform', href: '/super-admin/integrations', label: 'Integrations', icon: PlugZap, permission: 'settings:manage' },
  { group: 'Platform', href: '/super-admin/data-governance', label: 'Data governance', icon: Database, permission: 'retention:manage' },
  { group: 'Platform', href: '/super-admin/retention', label: 'Data retention', icon: Timer, permission: 'retention:manage' },
  { group: 'Platform', href: '/super-admin/settings', label: 'Settings', icon: Settings, permission: 'settings:manage' },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="Super Admin" nav={nav} roles={['super_admin']} permission="super_admin:access">{children}</PortalShell>;
}
