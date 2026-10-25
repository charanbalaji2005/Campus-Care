'use client';

import {
  Activity, BarChart3, BellRing, BookOpenCheck, Building2, CalendarDays, Database, FileClock, FolderKanban, Gauge, Globe, HeartHandshake, KeyRound, LayoutDashboard,
  Mail, MapPinned, Megaphone, MessagesSquare, PhoneCall, PlugZap, Route, Settings, ShieldAlert, ShieldCheck, Siren, Smartphone, Timer, UserCog, Users,
} from 'lucide-react';
import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

/**
 * The website is the Super Admin control centre. Students, staff, administrators and moderators
 * use the Android app; everything configured here reaches installed apps through the API.
 */
const nav: NavItem[] = [
  { href: '/super-admin/dashboard', label: 'Overview', icon: Gauge },
  { href: '/super-admin/live-ops', label: 'Live operations', icon: Activity },
  { href: '/super-admin/campus', label: 'Campus overview', icon: LayoutDashboard, permission: 'analytics:read' },
  { href: '/super-admin/incidents', label: 'Incident triage', icon: FolderKanban, permission: 'incidents:triage' },
  { href: '/super-admin/campus-alerts', label: 'Campus alerts', icon: BellRing, permission: 'campus_alerts:manage' },
  { href: '/super-admin/announcements', label: 'Announcements & events', icon: Megaphone, permission: 'announcements:manage' },
  { href: '/super-admin/safety-intel', label: 'Safety intelligence', icon: MapPinned, permission: 'safety_intel:manage' },
  { href: '/super-admin/community', label: 'Community safety', icon: HeartHandshake, permission: 'community_safety:manage' },
  { href: '/super-admin/moderation', label: 'Community moderation', icon: ShieldCheck, permission: 'chat:moderate' },
  { href: '/super-admin/awareness', label: 'Awareness & training', icon: BookOpenCheck, permission: 'training:manage' },
  { href: '/super-admin/contacts', label: 'Emergency contacts', icon: PhoneCall, permission: 'contacts:manage' },
  { href: '/super-admin/counselling', label: 'Counselling overview', icon: CalendarDays, permission: 'appointments:read_aggregate' },
  { href: '/super-admin/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics:read' },
  { href: '/super-admin/mobile-app', label: 'Mobile app', icon: Smartphone, permission: 'settings:manage' },
  { href: '/super-admin/sos', label: 'SOS & safety', icon: Siren, permission: 'sos:configure' },
  { href: '/super-admin/users', label: 'Users', icon: Users, permission: 'users:manage' },
  { href: '/super-admin/roles', label: 'Roles & permissions', icon: UserCog, permission: 'roles:manage' },
  { href: '/super-admin/committees', label: 'Committees', icon: Building2, permission: 'committees:manage' },
  { href: '/super-admin/case-routing', label: 'Case routing', icon: Route, permission: 'routing:manage' },
  { href: '/super-admin/chat', label: 'Support & chat', icon: MessagesSquare, permission: 'chat:configure' },
  { href: '/super-admin/domains', label: 'Approved domains', icon: Globe, permission: 'domains:manage' },
  { href: '/super-admin/identity-providers', label: 'Sign-in providers', icon: KeyRound, permission: 'identity_providers:manage' },
  { href: '/super-admin/email', label: 'Email', icon: Mail, permission: 'email:manage' },
  { href: '/super-admin/integrations', label: 'Integrations', icon: PlugZap, permission: 'settings:manage' },
  { href: '/super-admin/security', label: 'Security', icon: ShieldAlert, permission: 'security:manage' },
  { href: '/super-admin/audit-logs', label: 'Audit logs', icon: FileClock, permission: 'audit:read' },
  { href: '/super-admin/data-governance', label: 'Data governance', icon: Database, permission: 'retention:manage' },
  { href: '/super-admin/retention', label: 'Data retention', icon: Timer, permission: 'retention:manage' },
  { href: '/super-admin/settings', label: 'Platform settings', icon: Settings, permission: 'settings:manage' },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="Super Admin" nav={nav} roles={['super_admin']} permission="super_admin:access">{children}</PortalShell>;
}
