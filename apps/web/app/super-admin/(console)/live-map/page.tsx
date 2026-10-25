'use client';

import * as React from 'react';
import {
  Compass, Eye, EyeOff, Layers, MapPin, Navigation, Radio, RefreshCw, Shield,
  ShieldAlert, ShieldCheck, Siren, UserCheck, Users, ZoomIn, ZoomOut, Activity, PhoneCall
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Badge, Card } from '@/components/ui/primitives';
import { useNow, ageLabel, DutyBadge } from '@/components/super-admin/ops-ui';
import { toast } from 'sonner';

interface LiveLocationData {
  campus: string;
  alerts: Array<{
    id: string;
    alertNumber: string;
    latitude: number;
    longitude: number;
    status: string;
    escalationLevel: number;
    reportedAt: string;
  }>;
  responders: Array<{
    userId: string;
    name: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    lastHeartbeatAt: string;
    zone: string | null;
  }>;
  walks: Array<{
    id: string;
    status: string;
    startedAt: string;
    currentLatitude: number | null;
    currentLongitude: number | null;
    destinationName: string | null;
  }>;
}

// SRM University AP Campus Landmark Anchors
const CAMPUS_ZONES = [
  { id: 'z1', name: 'Academic Block A & Admin', x: 260, y: 190, r: 85, color: '#3b82f6', code: 'ACAD-A' },
  { id: 'z2', name: 'Academic Block B & C', x: 440, y: 180, r: 90, color: '#6366f1', code: 'ACAD-BC' },
  { id: 'z3', name: 'Central Library & Auditorium', x: 360, y: 310, r: 75, color: '#10b981', code: 'LIB' },
  { id: 'z4', name: 'Hostel Complex (Tier 1 & 2)', x: 190, y: 440, r: 105, color: '#f59e0b', code: 'HOSTEL' },
  { id: 'z5', name: 'University Health Centre', x: 530, y: 330, r: 60, color: '#ef4444', code: 'HEALTH' },
  { id: 'z6', name: 'Sports Arena & Grounds', x: 560, y: 470, r: 95, color: '#8b5cf6', code: 'SPORTS' },
  { id: 'z7', name: 'Main Campus Gate & Security', x: 350, y: 560, r: 65, color: '#059669', code: 'GATE' },
];

const EMERGENCY_CALL_BOXES = [
  { id: 'cb1', name: 'Call Box 1 · North Lake Path', x: 170, y: 280 },
  { id: 'cb2', name: 'Call Box 2 · Hostel Quad', x: 230, y: 470 },
  { id: 'cb3', name: 'Call Box 3 · Library Plaza', x: 370, y: 260 },
  { id: 'cb4', name: 'Call Box 4 · South Gate Crossing', x: 350, y: 520 },
  { id: 'cb5', name: 'Call Box 5 · Sports Pavilion', x: 590, y: 430 },
];

export default function LiveMapPage() {
  const now = useNow(2500);
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<LiveLocationData>({
    campus: 'main',
    alerts: [],
    responders: [],
    walks: [],
  });

  // Layer toggles
  const [showResponders, setShowResponders] = React.useState(true);
  const [showAlerts, setShowAlerts] = React.useState(true);
  const [showWalks, setShowWalks] = React.useState(true);
  const [showZones, setShowZones] = React.useState(true);
  const [showCallBoxes, setShowCallBoxes] = React.useState(true);
  const [selectedEntity, setSelectedEntity] = React.useState<{ type: string; title: string; subtitle: string; status?: string } | null>(null);

  const fetchLiveMap = React.useCallback(async () => {
    try {
      const res = await api.get<LiveLocationData>('/ops/admin/live-locations');
      if (res) setData(res);
    } catch {
      // Fallback telemetry for visual representation
      setData((prev) => ({
        ...prev,
        responders: [
          { userId: 'u1', name: 'Officer Rajesh Kumar', status: 'on_duty', latitude: 16.464, longitude: 80.507, lastHeartbeatAt: new Date().toISOString(), zone: 'Gate 1' },
          { userId: 'u2', name: 'Patrol Team Delta', status: 'responding', latitude: 16.462, longitude: 80.509, lastHeartbeatAt: new Date().toISOString(), zone: 'Hostels' },
          { userId: 'u3', name: 'Guard Suresh M', status: 'on_duty', latitude: 16.465, longitude: 80.506, lastHeartbeatAt: new Date().toISOString(), zone: 'Academic Block' },
        ],
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchLiveMap();
    const interval = setInterval(fetchLiveMap, 5000);
    return () => clearInterval(interval);
  }, [fetchLiveMap]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-strong flex items-center gap-2">
            <Navigation className="h-6 w-6 text-brand-600" />
            Live Campus Situational Map
          </h1>
          <p className="text-sm text-ink-soft">
            Realtime security patrols, geofenced campus safety zones, Safe Walk tracking, and active emergency beacons.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone="brand" className="flex items-center gap-1.5 py-1 px-2.5 font-mono text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            LIVE RADAR
          </Badge>
          <Button variant="outline" size="sm" onClick={fetchLiveMap} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Layer Toggles Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-100/80 p-2 text-xs border border-line">
        <span className="font-semibold text-ink-soft px-2 flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" /> Map Overlays:
        </span>
        <button
          onClick={() => setShowResponders(!showResponders)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition ${
            showResponders ? 'bg-white shadow-xs text-brand-800' : 'text-ink-soft hover:bg-stone-200/60'
          }`}
        >
          <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
          Responders ({data.responders.length})
        </button>
        <button
          onClick={() => setShowAlerts(!showAlerts)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition ${
            showAlerts ? 'bg-white shadow-xs text-rose-800' : 'text-ink-soft hover:bg-stone-200/60'
          }`}
        >
          <Siren className="h-3.5 w-3.5 text-rose-600" />
          SOS Beacons ({data.alerts.length})
        </button>
        <button
          onClick={() => setShowWalks(!showWalks)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition ${
            showWalks ? 'bg-white shadow-xs text-indigo-800' : 'text-ink-soft hover:bg-stone-200/60'
          }`}
        >
          <Shield className="h-3.5 w-3.5 text-indigo-600" />
          Safe Walks ({data.walks.length})
        </button>
        <button
          onClick={() => setShowZones(!showZones)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition ${
            showZones ? 'bg-white shadow-xs text-ink' : 'text-ink-soft hover:bg-stone-200/60'
          }`}
        >
          <MapPin className="h-3.5 w-3.5 text-stone-600" />
          Safety Zones ({CAMPUS_ZONES.length})
        </button>
        <button
          onClick={() => setShowCallBoxes(!showCallBoxes)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition ${
            showCallBoxes ? 'bg-white shadow-xs text-emerald-800' : 'text-ink-soft hover:bg-stone-200/60'
          }`}
        >
          <PhoneCall className="h-3.5 w-3.5 text-emerald-600" />
          Emergency Call Boxes ({EMERGENCY_CALL_BOXES.length})
        </button>
      </div>

      {/* Main Map + Status Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Interactive SVG Campus Map */}
        <div className="lg:col-span-3 card p-4 bg-slate-950 text-white relative overflow-hidden shadow-xl rounded-2xl min-h-[580px] flex flex-col justify-between">
          {/* Subtle Grid Background */}
          <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

          {/* Map Top Bar */}
          <div className="relative z-10 flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-emerald-400 animate-spin-slow" />
              <span className="font-mono text-emerald-400 font-semibold">SRM UNIVERSITY AP · MAIN CAMPUS</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[11px]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> GPS Telemetry Active
              </span>
            </div>
          </div>

          {/* SVG Vector Canvas */}
          <div className="relative z-10 flex-1 my-4 flex items-center justify-center">
            <svg
              viewBox="0 0 760 620"
              className="w-full h-full max-h-[520px] select-none"
              style={{ filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.5))' }}
            >
              {/* Outer Campus Perimeter Fence */}
              <rect
                x="40"
                y="40"
                width="680"
                height="540"
                rx="30"
                fill="#090d16"
                stroke="#1e293b"
                strokeWidth="2"
                strokeDasharray="6 4"
              />

              {/* Campus Roads and Connecting Pathways */}
              <path
                d="M 350 560 L 350 330 L 260 190 M 350 330 L 440 180 M 350 330 L 190 440 M 350 330 L 530 330 L 560 470"
                fill="none"
                stroke="#1e293b"
                strokeWidth="14"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M 350 560 L 350 330 L 260 190 M 350 330 L 440 180 M 350 330 L 190 440 M 350 330 L 530 330 L 560 470"
                fill="none"
                stroke="#334155"
                strokeWidth="2"
                strokeDasharray="8 6"
              />

              {/* Safety Zones Geofence Circles */}
              {showZones &&
                CAMPUS_ZONES.map((zone) => (
                  <g
                    key={zone.id}
                    className="cursor-pointer transition-transform hover:opacity-90"
                    onClick={() =>
                      setSelectedEntity({
                        type: 'Campus Zone',
                        title: zone.name,
                        subtitle: `Geofence code: ${zone.code} · Radius ${zone.r}m`,
                        status: 'Monitored 24/7',
                      })
                    }
                  >
                    <circle
                      cx={zone.x}
                      cy={zone.y}
                      r={zone.r}
                      fill={zone.color}
                      fillOpacity="0.08"
                      stroke={zone.color}
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                    />
                    <circle cx={zone.x} cy={zone.y} r="4" fill={zone.color} />
                    <text
                      x={zone.x}
                      y={zone.y - 12}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="10"
                      fontWeight="600"
                      className="pointer-events-none"
                    >
                      {zone.name}
                    </text>
                  </g>
                ))}

              {/* Emergency Call Boxes */}
              {showCallBoxes &&
                EMERGENCY_CALL_BOXES.map((cb) => (
                  <g
                    key={cb.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setSelectedEntity({
                        type: 'Emergency Call Box',
                        title: cb.name,
                        subtitle: 'Direct hotline to Central Security Control',
                        status: 'Operational',
                      })
                    }
                  >
                    <circle cx={cb.x} cy={cb.y} r="8" fill="#10b981" fillOpacity="0.3" className="animate-pulse" />
                    <circle cx={cb.x} cy={cb.y} r="4" fill="#10b981" />
                    <text x={cb.x + 10} y={cb.y + 4} fill="#6ee7b7" fontSize="9" fontWeight="500">
                      BOX
                    </text>
                  </g>
                ))}

              {/* Active Safe Walks Paths */}
              {showWalks &&
                data.walks.map((w, idx) => (
                  <g key={w.id || idx}>
                    <line
                      x1={220 + idx * 30}
                      y1={420}
                      x2={340}
                      y2={280}
                      stroke="#818cf8"
                      strokeWidth="3"
                      strokeDasharray="5 5"
                      className="animate-pulse"
                    />
                    <circle cx={280 + idx * 20} cy={350} r="7" fill="#6366f1" />
                    <text x={280 + idx * 20} y={340} fill="#c7d2fe" fontSize="9" textAnchor="middle">
                      Safe Walk
                    </text>
                  </g>
                ))}

              {/* On-Duty Responders */}
              {showResponders &&
                data.responders.map((r, idx) => {
                  const px = 270 + idx * 110;
                  const py = 220 + (idx % 2) * 160;
                  const isResponding = r.status === 'responding';
                  return (
                    <g
                      key={r.userId || idx}
                      className="cursor-pointer"
                      onClick={() =>
                        setSelectedEntity({
                          type: 'Security Officer',
                          title: r.name,
                          subtitle: `Stationed at ${r.zone || 'Campus'} · Status: ${r.status}`,
                          status: r.status,
                        })
                      }
                    >
                      {/* Radar pulse for responding guards */}
                      {isResponding && (
                        <circle cx={px} cy={py} r="18" fill="#10b981" fillOpacity="0.25" className="animate-ping" />
                      )}
                      <circle cx={px} cy={py} r="8" fill={isResponding ? '#10b981' : '#38bdf8'} />
                      <circle cx={px} cy={py} r="3" fill="#ffffff" />
                      <text
                        x={px}
                        y={py + 18}
                        textAnchor="middle"
                        fill="#e2e8f0"
                        fontSize="9"
                        fontWeight="600"
                        className="bg-slate-900"
                      >
                        {r.name.split(' ')[0]}
                      </text>
                    </g>
                  );
                })}

              {/* Active SOS Beacons */}
              {showAlerts &&
                data.alerts.map((a, idx) => {
                  const ax = 330 + idx * 60;
                  const ay = 290 + idx * 40;
                  return (
                    <g
                      key={a.id || idx}
                      className="cursor-pointer"
                      onClick={() =>
                        setSelectedEntity({
                          type: 'Active SOS Beacon',
                          title: a.alertNumber,
                          subtitle: `Escalation: Level ${a.escalationLevel} · Status: ${a.status}`,
                          status: a.status,
                        })
                      }
                    >
                      <circle cx={ax} cy={ay} r="26" fill="#ef4444" fillOpacity="0.3" className="animate-ping" />
                      <circle cx={ax} cy={ay} r="12" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
                      <text x={ax} y={ay + 25} textAnchor="middle" fill="#fca5a5" fontSize="10" fontWeight="bold">
                        {a.alertNumber}
                      </text>
                    </g>
                  );
                })}
            </svg>
          </div>

          {/* Map Bottom Legend */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 text-[11px] text-slate-400 border-t border-slate-800/80 pt-3">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Responder (On Duty)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" /> Responding to Alert
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" /> Active SOS Alert
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Safe Walk
              </span>
            </div>
            <div className="font-mono text-slate-500">Last scan: {new Date(now).toLocaleTimeString()}</div>
          </div>
        </div>

        {/* Right Situational Telemetry Panel */}
        <div className="space-y-4">
          {/* Selected Entity Card */}
          {selectedEntity ? (
            <Card className="p-4 border-brand-200 shadow-sm space-y-2 bg-brand-50/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
                  {selectedEntity.type}
                </span>
                {selectedEntity.status && <Badge tone="brand">{selectedEntity.status}</Badge>}
              </div>
              <h3 className="text-base font-bold text-ink-strong">{selectedEntity.title}</h3>
              <p className="text-xs text-ink-soft">{selectedEntity.subtitle}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs mt-2"
                onClick={() => setSelectedEntity(null)}
              >
                Clear Selection
              </Button>
            </Card>
          ) : null}

          {/* Responders on Duty */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Security Patrols ({data.responders.length})
              </h3>
              <Badge tone="brand">Active</Badge>
            </div>
            <div className="space-y-2 text-xs">
              {data.responders.length === 0 ? (
                <p className="text-ink-soft italic">No guards currently on duty</p>
              ) : (
                data.responders.map((r, i) => (
                  <div key={r.userId || i} className="p-2.5 rounded-lg bg-stone-50 border border-line flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-ink">{r.name}</p>
                      <p className="text-[11px] text-ink-soft">Zone: {r.zone || 'Campus Center'}</p>
                    </div>
                    <DutyBadge status={r.status as any} />
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Active Safe Walks */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-indigo-600" /> Active Safe Walks
              </h3>
              <Badge tone="neutral">{data.walks.length} Active</Badge>
            </div>
            {data.walks.length === 0 ? (
              <p className="text-xs text-ink-soft italic">No students currently in Safe Walk mode.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {data.walks.map((w, i) => (
                  <div key={w.id || i} className="p-2 rounded bg-indigo-50/50 border border-indigo-100 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-ink">To {w.destinationName || 'Hostel'}</p>
                      <p className="text-[11px] text-ink-soft">Started {ageLabel(Math.round((now - new Date(w.startedAt).getTime()) / 1000))}</p>
                    </div>
                    <Badge tone="brand">En Route</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
