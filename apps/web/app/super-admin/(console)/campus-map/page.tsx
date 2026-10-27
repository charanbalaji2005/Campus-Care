'use client';

import * as React from 'react';
import {
  MapPin,
  Navigation,
  Compass,
  Footprints,
  Accessibility,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Search,
  Plus,
  Edit,
  Trash2,
  Shield,
  Siren,
  Building2,
  Flame,
  ArrowRight,
  Filter,
  Eye,
  RefreshCw,
  BellRing,
  ExternalLink,
  ChevronRight,
  Info,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, Badge, Card, Input } from '@/components/ui/primitives';
import { toast } from 'sonner';

interface CampusData {
  center: { latitude: number; longitude: number; zoom: number };
  campus: string;
  buildings: Array<{
    id: string;
    name: string;
    code: string;
    category: string;
    latitude: number;
    longitude: number;
    entrances: Array<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      isAccessible: boolean;
      isMain: boolean;
      status: string;
    }>;
    operatingHours?: string;
    contactPhone?: string;
    description: string;
    status: string;
    isEmergencyLocation: boolean;
    accessibilityNotes?: string;
  }>;
  emergencyLocations: Array<{
    id: string;
    name: string;
    code: string;
    category: string;
    latitude: number;
    longitude: number;
    contactPhone?: string;
  }>;
  pathways: Array<{
    id: string;
    name: string;
    coordinates: Array<[number, number]>;
    pathType: string;
    isOneWay: boolean;
    distanceMeters: number;
    surfaceType: string;
    hasLighting: boolean;
    status: string;
    temporaryClosure?: {
      startDate: string;
      endDate: string;
      reason: string;
      alternativeNotes?: string;
    };
  }>;
  stats: {
    totalBuildings: number;
    totalPathways: number;
    activeReportsCount: number;
  };
}

interface MapReport {
  id: string;
  reporter?: { name: string; email: string };
  reportType: string;
  locationLabel: string;
  latitude?: number;
  longitude?: number;
  targetEntityType: string;
  description: string;
  status: string;
  resolutionNote?: string;
  createdAt: string;
}

interface CalculatedRoute {
  found: boolean;
  isApproximate: boolean;
  distanceMeters: number;
  durationSeconds: number;
  mode: string;
  geometry: Array<[number, number]>;
  steps: Array<{
    instruction: string;
    distanceMeters: number;
    durationSeconds: number;
    pathwayName: string;
  }>;
  warnings?: string[];
}

const CATEGORY_COLORS: Record<string, string> = {
  academic: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300',
  library: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300',
  hostel: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300',
  security_office: 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950 dark:text-rose-300',
  medical: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300',
  assembly_point: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300',
  cafeteria: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300',
  gate: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300',
  parking: 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-300',
  bus_stop: 'bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-950 dark:text-teal-300',
};

export default function CampusMapPage() {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'buildings' | 'pathways' | 'reports' | 'preview'>('overview');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState('all');

  // Route preview test state
  const [routeOriginId, setRouteOriginId] = React.useState('');
  const [routeDestId, setRouteDestId] = React.useState('');
  const [routeMode, setRouteMode] = React.useState<'walking' | 'accessible'>('walking');
  const [calculatingRoute, setCalculatingRoute] = React.useState(false);
  const [testedRoute, setTestedRoute] = React.useState<CalculatedRoute | null>(null);

  // New building modal
  const [showBuildingModal, setShowBuildingModal] = React.useState(false);
  const [bName, setBName] = React.useState('');
  const [bCode, setBCode] = React.useState('');
  const [bCategory, setBCategory] = React.useState('academic');
  const [bLat, setBLat] = React.useState('16.5650');
  const [bLng, setBLng] = React.useState('80.5250');
  const [bDesc, setBDesc] = React.useState('');
  const [bHours, setBHours] = React.useState('08:00 - 20:00');
  const [bPhone, setBPhone] = React.useState('');
  const [bEmergency, setBEmergency] = React.useState(false);
  const [bSaving, setBSaving] = React.useState(false);

  // New pathway modal
  const [showPathwayModal, setShowPathwayModal] = React.useState(false);
  const [pName, setPName] = React.useState('');
  const [pStartLabel, setPStartLabel] = React.useState('');
  const [pStartLat, setPStartLat] = React.useState('16.5610');
  const [pStartLng, setPStartLng] = React.useState('80.5200');
  const [pEndLabel, setPEndLabel] = React.useState('');
  const [pEndLat, setPEndLat] = React.useState('16.5630');
  const [pEndLng, setPEndLng] = React.useState('80.5230');
  const [pType, setPType] = React.useState('pedestrian');
  const [pSurface, setPSurface] = React.useState('paved');
  const [pDist, setPDist] = React.useState('250');
  const [pSaving, setPSaving] = React.useState(false);

  // Closure modal
  const [showClosureModal, setShowClosureModal] = React.useState(false);
  const [closurePathwayId, setClosurePathwayId] = React.useState('');
  const [closureReason, setClosureReason] = React.useState('');
  const [closureAlt, setClosureAlt] = React.useState('');
  const [closureBroadcast, setClosureBroadcast] = React.useState(true);
  const [closureSaving, setClosureSaving] = React.useState(false);

  // Fetch campus map data
  const { data: mapData, isLoading, mutate: refreshMap } = useApi<CampusData>('/campus-map/data');
  const { data: reportsData, mutate: refreshReports } = useApi<{ items: MapReport[] }>('/campus-map/admin/reports');

  // Handle route calculation test
  const handleTestRoute = async () => {
    if (!routeOriginId || !routeDestId) {
      toast.error('Please select both origin and destination buildings');
      return;
    }
    if (routeOriginId === routeDestId) {
      toast.error('Origin and destination cannot be the same building');
      return;
    }

    setCalculatingRoute(true);
    try {
      const originB = mapData?.buildings.find((b) => b.id === routeOriginId);
      const res = await api.post<CalculatedRoute>('/campus-map/admin/preview-route', {
        origin: { latitude: originB?.latitude, longitude: originB?.longitude },
        destination: { buildingId: routeDestId },
        mode: routeMode,
      });
      setTestedRoute(res);
      toast.success(`Calculated route: ${res.distanceMeters}m (${Math.round(res.durationSeconds / 60)} min)`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to calculate campus route');
    } finally {
      setCalculatingRoute(false);
    }
  };

  // Create building
  const handleSaveBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bName || !bCode) {
      toast.error('Name and Code are required');
      return;
    }

    setBSaving(true);
    try {
      await api.post('/campus-map/admin/buildings', {
        name: bName,
        code: bCode,
        category: bCategory,
        campus: 'main',
        latitude: parseFloat(bLat),
        longitude: parseFloat(bLng),
        description: bDesc,
        operatingHours: bHours || null,
        contactPhone: bPhone || null,
        isEmergencyLocation: bEmergency,
        entrances: [
          {
            id: `ent-${Date.now()}`,
            name: 'Main Entrance',
            latitude: parseFloat(bLat),
            longitude: parseFloat(bLng),
            isAccessible: true,
            isMain: true,
            status: 'open',
          },
        ],
      });
      toast.success('Campus building added and published successfully');
      setShowBuildingModal(false);
      void refreshMap();
      // Reset form
      setBName('');
      setBCode('');
      setBDesc('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create building');
    } finally {
      setBSaving(false);
    }
  };

  // Create pathway segment
  const handleSavePathway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName) {
      toast.error('Pathway name is required');
      return;
    }

    setPSaving(true);
    try {
      const sLat = parseFloat(pStartLat);
      const sLng = parseFloat(pStartLng);
      const eLat = parseFloat(pEndLat);
      const eLng = parseFloat(pEndLng);

      await api.post('/campus-map/admin/pathways', {
        name: pName,
        campus: 'main',
        startNode: { id: `node-${Date.now()}-1`, label: pStartLabel || 'Start', latitude: sLat, longitude: sLng },
        endNode: { id: `node-${Date.now()}-2`, label: pEndLabel || 'End', latitude: eLat, longitude: eLng },
        coordinates: [
          [sLng, sLat],
          [eLng, eLat],
        ],
        pathType: pType,
        surfaceType: pSurface,
        distanceMeters: parseFloat(pDist),
        status: 'open',
      });

      toast.success('Pathway segment connected and added to routing graph');
      setShowPathwayModal(false);
      void refreshMap();
      setPName('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create pathway segment');
    } finally {
      setPSaving(false);
    }
  };

  // Temporary closure
  const handleApplyClosure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closurePathwayId || !closureReason) {
      toast.error('Reason is required');
      return;
    }

    setClosureSaving(true);
    try {
      await api.post(`/campus-map/admin/pathways/${closurePathwayId}/closure`, {
        status: 'closed',
        reason: closureReason,
        alternativeNotes: closureAlt || null,
        broadcastNotice: closureBroadcast,
      });

      toast.success('Pathway closure scheduled and campus notification sent');
      setShowClosureModal(false);
      setClosureReason('');
      setClosureAlt('');
      void refreshMap();
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply pathway closure');
    } finally {
      setClosureSaving(false);
    }
  };

  // Reopen pathway
  const handleReopenPathway = async (pathwayId: string) => {
    try {
      await api.post(`/campus-map/admin/pathways/${pathwayId}/closure`, {
        status: 'open',
        reason: 'Maintenance work complete',
      });
      toast.success('Pathway reopened for public and emergency navigation');
      void refreshMap();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reopen pathway');
    }
  };

  // Resolve map report
  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      await api.patch(`/campus-map/admin/reports/${reportId}`, {
        status,
        resolutionNote: status === 'resolved' ? 'Verified by campus administration and updated in map.' : 'Dismissed after field review.',
      });
      toast.success(`Report marked ${status}`);
      void refreshReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update report');
    }
  };

  const filteredBuildings = React.useMemo(() => {
    if (!mapData?.buildings) return [];
    return mapData.buildings.filter((b) => {
      const matchSearch =
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchCat = selectedCategory === 'all' || b.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [mapData?.buildings, searchQuery, selectedCategory]);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Campus Map & Routes Management
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Interactive campus directory, verified pathway routing graph, closures, and accessibility management.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refreshMap();
              void refreshReports();
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setShowPathwayModal(true)}
            variant="outline"
            className="gap-2"
          >
            <Navigation className="h-4 w-4 text-emerald-600" />
            Add Pathway
          </Button>
          <Button
            size="sm"
            onClick={() => setShowBuildingModal(true)}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Building
          </Button>
        </div>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Buildings</p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                {mapData?.stats.totalBuildings ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Building2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {mapData?.emergencyLocations.length ?? 0} emergency assembly & security hubs
          </div>
        </Card>

        <Card className="p-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Mapped Pathways</p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                {mapData?.stats.totalPathways ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <Footprints className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Dijkstra routing graph active & verified
          </div>
        </Card>

        <Card className="p-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Closures</p>
              <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {mapData?.pathways.filter((p) => p.status === 'closed' || p.status === 'maintenance').length ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Maintenance & temporary reroutes
          </div>
        </Card>

        <Card className="p-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Map Issue Reports</p>
              <p className="mt-1 text-2xl font-bold text-purple-600 dark:text-purple-400">
                {mapData?.stats.activeReportsCount ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600 dark:bg-purple-950 dark:text-purple-400">
              <BellRing className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Student feedback pending review
          </div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        {[
          { key: 'overview', label: 'Interactive Map & Corridors', icon: Compass },
          { key: 'buildings', label: 'Buildings & Facilities', icon: Building2 },
          { key: 'pathways', label: 'Pathways & Graph', icon: Footprints },
          { key: 'preview', label: 'Route Test & Preview', icon: Navigation },
          { key: 'reports', label: `Student Reports (${mapData?.stats.activeReportsCount ?? 0})`, icon: BellRing },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                isActive
                  ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW & INTERACTIVE MAP VIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Visual Map Card */}
          <Card className="lg:col-span-2 overflow-hidden border-slate-200 dark:border-slate-800">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-emerald-600" />
                <span className="font-semibold text-slate-900 dark:text-white text-sm">
                  Campus Pathway & Facility Network
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Open Pathway
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Maintenance
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> Emergency Hub
                </span>
              </div>
            </div>

            {/* Schematic Campus Map Canvas / SVG */}
            <div className="relative h-[480px] bg-slate-950 p-6 flex flex-col justify-between overflow-hidden select-none">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#34d399_1px,transparent_1px)] [background-size:16px_16px]" />

              {/* Map Header Overlay */}
              <div className="relative z-10 flex items-center justify-between">
                <div className="rounded-lg bg-slate-900/80 backdrop-blur px-3 py-1.5 border border-slate-800 text-xs text-emerald-400 font-mono">
                  SRM-AP Main Campus • Lat: {mapData?.center.latitude.toFixed(4)}, Lng: {mapData?.center.longitude.toFixed(4)}
                </div>
                <Badge className="bg-emerald-950 text-emerald-300 border-emerald-800">
                  OpenStreetMap Active
                </Badge>
              </div>

              {/* Buildings and Pathways SVG Schematic */}
              <div className="relative z-10 my-auto flex items-center justify-center">
                <svg viewBox="0 0 800 400" className="w-full h-80 max-w-2xl drop-shadow-xl">
                  {/* Campus Boundary Outline */}
                  <rect x="40" y="20" width="720" height="360" rx="24" fill="#0f172a" stroke="#1e293b" strokeWidth="2" strokeDasharray="4 4" />
                  
                  {/* Main Axis Pathways */}
                  <line x1="100" y1="340" x2="260" y2="200" stroke="#10b981" strokeWidth="6" strokeLinecap="round" />
                  <line x1="260" y1="200" x2="480" y2="140" stroke="#10b981" strokeWidth="6" strokeLinecap="round" />
                  <line x1="480" y1="140" x2="680" y2="120" stroke="#10b981" strokeWidth="6" strokeLinecap="round" />
                  <line x1="260" y1="200" x2="320" y2="300" stroke="#10b981" strokeWidth="4" strokeLinecap="round" />
                  <line x1="320" y1="300" x2="520" y2="280" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 4" />
                  <line x1="520" y1="280" x2="480" y2="140" stroke="#10b981" strokeWidth="4" strokeLinecap="round" />

                  {/* Route Polyline Highlight if tested */}
                  {testedRoute && (
                    <polyline
                      points="100,340 260,200 480,140"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="5"
                      strokeLinecap="round"
                      className="animate-pulse"
                    />
                  )}

                  {/* Building Nodes */}
                  <g className="cursor-pointer">
                    <circle cx="100" cy="340" r="14" fill="#3b82f6" />
                    <text x="100" y="370" fill="#94a3b8" fontSize="11" textAnchor="middle" fontWeight="bold">Main Gate</text>
                  </g>

                  <g className="cursor-pointer">
                    <circle cx="260" cy="200" r="16" fill="#10b981" />
                    <text x="260" y="175" fill="#e2e8f0" fontSize="12" textAnchor="middle" fontWeight="bold">Central Plaza</text>
                  </g>

                  <g className="cursor-pointer">
                    <circle cx="480" cy="140" r="18" fill="#059669" />
                    <text x="480" y="115" fill="#34d399" fontSize="13" textAnchor="middle" fontWeight="bold">Central Library</text>
                  </g>

                  <g className="cursor-pointer">
                    <circle cx="680" cy="120" r="14" fill="#8b5cf6" />
                    <text x="680" y="95" fill="#c4b5fd" fontSize="11" textAnchor="middle" fontWeight="bold">Hostel Block A</text>
                  </g>

                  <g className="cursor-pointer">
                    <circle cx="320" cy="300" r="16" fill="#ef4444" />
                    <text x="320" y="335" fill="#fca5a5" fontSize="12" textAnchor="middle" fontWeight="bold">Security HQ</text>
                  </g>

                  <g className="cursor-pointer">
                    <circle cx="520" cy="280" r="15" fill="#f59e0b" />
                    <text x="520" y="315" fill="#fde68a" fontSize="11" textAnchor="middle" fontWeight="bold">Dining Commons</text>
                  </g>
                </svg>
              </div>

              {/* Map Footer Overlay */}
              <div className="relative z-10 flex items-center justify-between text-xs text-slate-400">
                <div>Graph Node Count: {mapData?.buildings.length ? mapData.buildings.length * 2 : 12} • Edges: {mapData?.pathways.length ?? 0}</div>
                <div className="text-emerald-400 font-medium">GPS Precision: Fused High Accuracy</div>
              </div>
            </div>
          </Card>

          {/* Quick Actions & Emergency Locations Panel */}
          <div className="space-y-4">
            <Card className="p-4 border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Siren className="h-4 w-4 text-rose-500" />
                Emergency Access Locations
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Priority assembly points and emergency response hubs routed with zero latency.
              </p>

              <div className="mt-3 space-y-2">
                {mapData?.emergencyLocations.slice(0, 5).map((loc) => (
                  <div
                    key={loc.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-rose-500" />
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-white">{loc.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{loc.code} • {loc.contactPhone || 'Dispatch'}</p>
                      </div>
                    </div>
                    <Badge tone="neutral" className="text-[10px]">
                      {loc.category.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Active Pathway Closures
              </h3>
              <div className="mt-3 space-y-2">
                {mapData?.pathways.filter((p) => p.status !== 'open').length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">No active pathway closures. All campus corridors are open.</p>
                ) : (
                  mapData?.pathways
                    .filter((p) => p.status !== 'open')
                    .map((p) => (
                      <div
                        key={p.id}
                        className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-900 dark:text-amber-200">{p.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReopenPathway(p.id)}
                            className="h-6 text-[10px] text-emerald-600 hover:text-emerald-700"
                          >
                            Reopen
                          </Button>
                        </div>
                        <p className="text-amber-800 dark:text-amber-300 mt-0.5">
                          {p.temporaryClosure?.reason || 'Under maintenance'}
                        </p>
                      </div>
                    ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: BUILDINGS & FACILITIES DIRECTORY */}
      {activeTab === 'buildings' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search building name, code, or facility..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="h-9 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-slate-700 dark:text-slate-300"
              >
                <option value="all">All Categories</option>
                <option value="academic">Academic Blocks</option>
                <option value="library">Library</option>
                <option value="hostel">Hostels & Residences</option>
                <option value="security_office">Security Office</option>
                <option value="medical">Medical Facility</option>
                <option value="cafeteria">Dining & Cafeteria</option>
                <option value="assembly_point">Emergency Assembly Point</option>
                <option value="gate">Main Gates</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBuildings.map((b) => (
              <Card
                key={b.id}
                className="p-4 border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        {b.code}
                      </span>
                      <h3 className="font-semibold text-slate-900 dark:text-white text-base mt-0.5">
                        {b.name}
                      </h3>
                    </div>
                    <Badge className={CATEGORY_COLORS[b.category] || 'bg-slate-100 text-slate-700'}>
                      {b.category.replace('_', ' ')}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                    {b.description || 'Campus academic and administrative facility.'}
                  </p>

                  <div className="mt-3 text-xs text-slate-500 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>{b.operatingHours || 'Standard Operating Hours'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-mono">Lat: {b.latitude.toFixed(4)}, Lng: {b.longitude.toFixed(4)}</span>
                    </div>
                  </div>

                  {b.entrances && b.entrances.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                      <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Verified Entrances ({b.entrances.length}):
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {b.entrances.map((ent) => (
                          <span
                            key={ent.id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${
                              ent.isAccessible
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {ent.isAccessible && <Accessibility className="h-3 w-3 text-emerald-600" />}
                            {ent.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className={`inline-flex items-center gap-1 ${b.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${b.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {b.status}
                  </span>
                  <div className="flex items-center gap-2">
                    {b.isEmergencyLocation && (
                      <Badge tone="neutral" className="text-[10px] text-rose-600 border-rose-300">
                        Emergency Hub
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: PATHWAYS & ROUTING GRAPH */}
      {activeTab === 'pathways' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Verified campus walkway segments, ramp accessibility indicators, and maintenance closures.
            </p>
            <Button
              size="sm"
              onClick={() => setShowPathwayModal(true)}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Connect New Pathway
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-semibold">Pathway Name</th>
                  <th className="px-4 py-3 font-semibold">Connected Nodes</th>
                  <th className="px-4 py-3 font-semibold">Length</th>
                  <th className="px-4 py-3 font-semibold">Path Type</th>
                  <th className="px-4 py-3 font-semibold">Surface</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                {mapData?.pathways.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                      {p.coordinates.length} waypoints
                    </td>
                    <td className="px-4 py-3 font-mono font-medium">{p.distanceMeters} m</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                          p.pathType === 'accessible'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {p.pathType === 'accessible' && <Accessibility className="h-3 w-3" />}
                        {p.pathType}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize">{p.surfaceType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                          p.status === 'open'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status === 'open' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setClosurePathwayId(p.id);
                            setShowClosureModal(true);
                          }}
                          className="h-7 text-xs text-amber-600 hover:text-amber-700"
                        >
                          Schedule Closure
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReopenPathway(p.id)}
                          className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                        >
                          Reopen
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ROUTE TEST & PREVIEW */}
      {activeTab === 'preview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 border-slate-200 dark:border-slate-800 space-y-4">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white text-base">
                Route Calculation Simulator
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Validate Dijkstra graph routing, accessibility bypasses, and temporary closure rerouting in real time.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Origin Building / Hub</label>
                <select
                  value={routeOriginId}
                  onChange={(e) => setRouteOriginId(e.target.value)}
                  className="mt-1 w-full h-9 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-slate-900 dark:text-white"
                >
                  <option value="">Select Starting Point...</option>
                  {mapData?.buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Destination Building / Hub</label>
                <select
                  value={routeDestId}
                  onChange={(e) => setRouteDestId(e.target.value)}
                  className="mt-1 w-full h-9 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-slate-900 dark:text-white"
                >
                  <option value="">Select Destination...</option>
                  {mapData?.buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Travel Mode</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setRouteMode('walking')}
                    className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-medium transition-colors ${
                      routeMode === 'walking'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600'
                    }`}
                  >
                    <Footprints className="h-4 w-4" />
                    Standard Walking
                  </button>
                  <button
                    type="button"
                    onClick={() => setRouteMode('accessible')}
                    className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-medium transition-colors ${
                      routeMode === 'accessible'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600'
                    }`}
                  >
                    <Accessibility className="h-4 w-4" />
                    Wheelchair / Ramps
                  </button>
                </div>
              </div>

              <Button
                onClick={handleTestRoute}
                disabled={calculatingRoute}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 mt-2"
              >
                <Navigation className="h-4 w-4" />
                {calculatingRoute ? 'Computing Graph...' : 'Calculate Optimal Route'}
              </Button>
            </div>

            {testedRoute && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Total Distance:</span>
                  <span className="font-bold text-slate-900 dark:text-white font-mono">{testedRoute.distanceMeters} meters</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Estimated Walking Time:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                    {Math.round(testedRoute.durationSeconds / 60)} min ({testedRoute.durationSeconds}s)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Route Type:</span>
                  <Badge tone="neutral" className="text-[10px]">
                    {testedRoute.isApproximate ? 'Direct Approximate' : 'Verified Pathway Graph'}
                  </Badge>
                </div>
              </div>
            )}
          </Card>

          {/* Turn by Turn Directions */}
          <Card className="lg:col-span-2 p-5 border-slate-200 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-white text-base">
              Turn-by-Turn Navigation Steps
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Deterministic step instructions delivered to student mobile devices.
            </p>

            <div className="mt-4 space-y-3">
              {!testedRoute ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <Navigation className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-xs">Select origin and destination on the left to simulate routing.</p>
                </div>
              ) : (
                testedRoute.steps.map((s, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-xs"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-[11px]">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 dark:text-white">{s.instruction}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Pathway: <span className="font-semibold">{s.pathwayName}</span> • Distance: {s.distanceMeters}m
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 5: STUDENT MAP REPORTS */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Closed pathways, blocked doors, and map inaccuracies reported by students via the mobile app.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reportsData?.items?.length === 0 ? (
              <p className="text-xs text-slate-500 py-6">No map reports found.</p>
            ) : (
              reportsData?.items.map((r) => (
                <Card key={r.id} className="p-4 border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                        {r.reportType.replace('_', ' ')}
                      </span>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-sm">{r.locationLabel}</h4>
                    </div>
                    <Badge
                      className={
                        r.status === 'resolved'
                          ? 'bg-emerald-100 text-emerald-700'
                          : r.status === 'dismissed'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-amber-100 text-amber-700'
                      }
                    >
                      {r.status}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                    "{r.description}"
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
                    <span>Reported by: {r.reporter?.name || 'Anonymous Student'}</span>
                    {r.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResolveReport(r.id, 'dismissed')}
                          className="h-7 text-xs text-slate-500"
                        >
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleResolveReport(r.id, 'resolved')}
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Resolve & Notify
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* MODAL: ADD BUILDING */}
      {showBuildingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Add Campus Facility or Building</h3>
            <p className="text-xs text-slate-500 mt-1">Configure verified GPS coordinates and entrance accessibility.</p>

            <form onSubmit={handleSaveBuilding} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Building / Facility Name</label>
                <Input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="e.g. Science Block B" className="mt-1 h-9 text-xs" required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Code / ID</label>
                  <Input value={bCode} onChange={(e) => setBCode(e.target.value)} placeholder="e.g. SCI-B" className="mt-1 h-9 text-xs" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Category</label>
                  <select
                    value={bCategory}
                    onChange={(e) => setBCategory(e.target.value)}
                    className="mt-1 w-full h-9 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3"
                  >
                    <option value="academic">Academic Building</option>
                    <option value="library">Library</option>
                    <option value="hostel">Hostel & Residence</option>
                    <option value="security_office">Security Office</option>
                    <option value="medical">Medical Facility</option>
                    <option value="cafeteria">Cafeteria & Dining</option>
                    <option value="assembly_point">Emergency Assembly Point</option>
                    <option value="gate">Campus Gate</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Latitude</label>
                  <Input value={bLat} onChange={(e) => setBLat(e.target.value)} className="mt-1 h-9 text-xs font-mono" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Longitude</label>
                  <Input value={bLng} onChange={(e) => setBLng(e.target.value)} className="mt-1 h-9 text-xs font-mono" required />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Description</label>
                <Input value={bDesc} onChange={(e) => setBDesc(e.target.value)} placeholder="Building description and departments..." className="mt-1 h-9 text-xs" />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="bEmergency"
                  checked={bEmergency}
                  onChange={(e) => setBEmergency(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
                <label htmlFor="bEmergency" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Mark as Emergency Assembly / Security Priority Location
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowBuildingModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={bSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {bSaving ? 'Saving...' : 'Publish Building'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: ADD PATHWAY */}
      {showPathwayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Connect Pathway Segment</h3>
            <p className="text-xs text-slate-500 mt-1">Connect two verified campus nodes into the routing graph.</p>

            <form onSubmit={handleSavePathway} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Pathway Corridor Name</label>
                <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. North Promenade Walkway" className="mt-1 h-9 text-xs" required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Path Type</label>
                  <select
                    value={pType}
                    onChange={(e) => setPType(e.target.value)}
                    className="mt-1 w-full h-9 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3"
                  >
                    <option value="pedestrian">Pedestrian</option>
                    <option value="accessible">Wheelchair Accessible</option>
                    <option value="vehicle">Vehicle / Shuttle</option>
                    <option value="emergency_access">Emergency Access Corridor</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Distance (meters)</label>
                  <Input value={pDist} onChange={(e) => setPDist(e.target.value)} className="mt-1 h-9 text-xs font-mono" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Surface Type</label>
                  <select
                    value={pSurface}
                    onChange={(e) => setPSurface(e.target.value)}
                    className="mt-1 w-full h-9 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3"
                  >
                    <option value="paved">Paved / Smooth Stone</option>
                    <option value="ramp">Ramp</option>
                    <option value="stairs">Stairs</option>
                    <option value="indoor">Indoor Corridor</option>
                    <option value="gravel">Gravel</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowPathwayModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {pSaving ? 'Connecting...' : 'Connect to Graph'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: SCHEDULE CLOSURE */}
      {showClosureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Schedule Pathway Closure
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Mark this corridor as closed and optionally broadcast an alert to students.
            </p>

            <form onSubmit={handleApplyClosure} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Closure Reason</label>
                <Input
                  value={closureReason}
                  onChange={(e) => setClosureReason(e.target.value)}
                  placeholder="e.g. Utility pipe repair and resurfacing"
                  className="mt-1 h-9 text-xs"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Alternative Route Recommendation</label>
                <Input
                  value={closureAlt}
                  onChange={(e) => setClosureAlt(e.target.value)}
                  placeholder="e.g. Please use the South Accessible Ramp"
                  className="mt-1 h-9 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="closureBroadcast"
                  checked={closureBroadcast}
                  onChange={(e) => setClosureBroadcast(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
                <label htmlFor="closureBroadcast" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Broadcast high-priority push notice to affected students
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowClosureModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={closureSaving} className="bg-amber-600 hover:bg-amber-700 text-white">
                  {closureSaving ? 'Applying...' : 'Apply Closure'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
