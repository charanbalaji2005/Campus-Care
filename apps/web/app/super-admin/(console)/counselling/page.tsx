'use client';

import { useState } from 'react';
import {
  Lock,
  UserCheck,
  RefreshCw,
  Clock,
  Sparkles,
  Users,
  CalendarCheck,
  ArrowRightLeft,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { humanize } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Progress,
  Skeleton,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';

interface WorkloadData {
  counsellors: {
    id: string;
    name: string;
    email: string;
    department: string;
    activeCaseload: number;
    capacity: number;
    openCapacity: number;
    acceptingRequests: boolean;
    slotsPublished: boolean;
  }[];
  unassignedQueue: {
    id: string;
    studentName: string;
    studentId: string | null;
    department: string | null;
    mode: string;
    reason: string;
    statusReason: string;
    createdAt: string;
  }[];
  unassignedCount: number;
  recentAssignments: {
    id: string;
    action: string;
    appointmentId: string;
    actorId: string | null;
    at: string;
    meta?: {
      algorithmVersion?: string;
      counsellorId?: string;
      score?: number;
      reason?: string;
      breakdown?: {
        counsellorName?: string;
        reasons?: string[];
      };
    };
  }[];
  algorithm: {
    version: string;
    defaultMaxCaseload: number;
    weights: {
      workload: number;
      availability: number;
      continuity: number;
      fairRotation: number;
    };
  };
}

interface StatsData {
  byStatus: Record<string, number>;
  byMonth: { month: string; count: number }[];
  today: number;
  pending: number;
}

export default function AdminAppointmentsPage() {
  const [activeTab, setActiveTab] = useState('workload');
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [assignCounsellorId, setAssignCounsellorId] = useState('');
  const [assignReason, setAssignReason] = useState('Manual triage by counselling coordinator');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const {
    data: statsData,
    error: statsError,
    mutate: mutateStats,
  } = useApi<StatsData>('/counselling/stats');

  const {
    data: workloadData,
    error: workloadError,
    mutate: mutateWorkload,
  } = useApi<WorkloadData>('/counselling/admin/workload');

  const isLoading = (!statsData && !statsError) || (!workloadData && !workloadError);
  const hasError = statsError || workloadError;

  if (hasError) {
    return (
      <ErrorState
        message={statsError?.message || workloadError?.message || 'Failed to load counselling operations'}
        onRetry={() => {
          mutateStats();
          mutateWorkload();
        }}
      />
    );
  }

  if (isLoading || !statsData || !workloadData) {
    return (
      <div className="space-y-6">
        <PageHeader title="Counselling operations" description="Loading workload and queue metrics..." />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const statuses = Object.entries(statsData.byStatus).map(([s, count]) => ({
    status: humanize(s),
    count,
  }));
  const total = statuses.reduce((a, b) => a + b.count, 0);

  const totalCapacity = workloadData.counsellors.reduce((acc, c) => acc + c.capacity, 0);
  const totalActiveCaseload = workloadData.counsellors.reduce((acc, c) => acc + c.activeCaseload, 0);

  const handleAutoAssign = async (appointmentId: string) => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await api.post<{ assigned: boolean; message: string; counsellorName?: string }>(
        `/counselling/appointments/${appointmentId}/auto-assign`,
        {},
      );
      setActionMessage(
        res.assigned
          ? `Assigned successfully to ${res.counsellorName || 'counsellor'}.`
          : res.message || 'Queued for automatic assignment.',
      );
      await mutateWorkload();
      await mutateStats();
    } catch (err) {
      setActionMessage((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest || !assignCounsellorId) return;
    setActionLoading(true);
    try {
      await api.post(`/counselling/appointments/${selectedRequest}/reassign`, {
        counsellorId: assignCounsellorId,
        reason: assignReason,
      });
      setSelectedRequest(null);
      setAssignCounsellorId('');
      setActionMessage('Counsellor assigned successfully.');
      await mutateWorkload();
      await mutateStats();
    } catch (err) {
      setActionMessage((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counselling operations & workload"
        description="Fair, workload-aware counsellor assignment, queue monitoring, and care capacity."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              mutateWorkload();
              mutateStats();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh Queue
          </Button>
        }
      />

      <Alert tone="neutral" icon={<Lock className="h-4 w-4" />}>
        Confidentiality guard active: Administrators see workload, queue status, and non-sensitive matching factors only.
        Private session notes and student clinical narratives are confidential to assigned counsellors.
      </Alert>

      {actionMessage && (
        <Alert
          tone={actionMessage.includes('fail') ? 'rose' : 'brand'}
          icon={actionMessage.includes('fail') ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
        >
          {actionMessage}
        </Alert>
      )}

      {/* Primary KPI Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending assignment"
          value={workloadData.unassignedCount}
          tone={workloadData.unassignedCount > 0 ? 'amber' : 'brand'}
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          hint="Requests awaiting counsellor"
        />
        <StatCard
          label="Active counsellors"
          value={workloadData.counsellors.filter((c) => c.acceptingRequests).length}
          tone="brand"
          icon={<Users className="h-5 w-5 text-emerald-600" />}
          hint={`${workloadData.counsellors.length} total registered`}
        />
        <StatCard
          label="Caseload utilization"
          value={`${totalActiveCaseload}/${totalCapacity}`}
          tone="dark"
          icon={<CalendarCheck className="h-5 w-5 text-slate-700" />}
          hint={`${Math.round((totalActiveCaseload / (totalCapacity || 1)) * 100)}% capacity used`}
        />
        <StatCard
          label="All-time sessions"
          value={total}
          tone="brand"
          icon={<Sparkles className="h-5 w-5 text-emerald-700" />}
          hint={`${statsData.today} session(s) today`}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-100 p-1 rounded-xl">
          <TabsTrigger value="workload" className="text-sm font-medium">
            <Users className="h-4 w-4 mr-2" /> Counsellor Workload ({workloadData.counsellors.length})
          </TabsTrigger>
          <TabsTrigger value="queue" className="text-sm font-medium">
            <Clock className="h-4 w-4 mr-2" /> Unassigned Queue ({workloadData.unassignedCount})
          </TabsTrigger>
          <TabsTrigger value="history" className="text-sm font-medium">
            <ArrowRightLeft className="h-4 w-4 mr-2" /> Assignment History
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-sm font-medium">
            <CalendarCheck className="h-4 w-4 mr-2" /> Analytics & Trends
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Counsellor Workload */}
        <TabsContent value="workload" className="space-y-4 pt-4">
          <Card>
            <CardHeader
              title="Counsellor availability & active caseload"
              description={`Algorithm Version: ${workloadData.algorithm.version} (Workload: ${workloadData.algorithm.weights.workload}%, Availability: ${workloadData.algorithm.weights.availability}%, Continuity: ${workloadData.algorithm.weights.continuity}%, Fair Rotation: ${workloadData.algorithm.weights.fairRotation}%)`}
            />
            <div className="overflow-x-auto p-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                    <th className="pb-3">Counsellor</th>
                    <th className="pb-3">Department</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Active Caseload</th>
                    <th className="pb-3">Open Capacity</th>
                    <th className="pb-3">Schedule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workloadData.counsellors.map((c) => {
                    const usagePercent = Math.min(100, Math.round((c.activeCaseload / c.capacity) * 100));
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/50">
                        <td className="py-3">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="text-xs text-slate-500">{c.email}</div>
                        </td>
                        <td className="py-3 text-slate-600">{c.department}</td>
                        <td className="py-3">
                          {c.acceptingRequests ? (
                            <Badge tone="brand">Accepting</Badge>
                          ) : (
                            <Badge tone="neutral">Paused</Badge>
                          )}
                        </td>
                        <td className="py-3 w-48">
                          <div className="flex items-center justify-between text-xs font-medium mb-1">
                            <span>
                              {c.activeCaseload} / {c.capacity} cases
                            </span>
                            <span className="text-slate-500">{usagePercent}%</span>
                          </div>
                          <Progress value={usagePercent} className="h-2" />
                        </td>
                        <td className="py-3 font-semibold text-emerald-700">
                          {c.openCapacity} openings
                        </td>
                        <td className="py-3">
                          {c.slotsPublished ? (
                            <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                              <CheckCircle className="h-3.5 w-3.5" /> Published
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">No recurring slots</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 2: Priority Unassigned Queue */}
        <TabsContent value="queue" className="space-y-4 pt-4">
          <Card>
            <CardHeader
              title="Requests pending counsellor assignment"
              description="Requests where no counsellor was initially chosen or where auto-assignment was queued."
            />
            <div className="p-4">
              {workloadData.unassignedQueue.length === 0 ? (
                <EmptyState
                  icon={<UserCheck className="h-10 w-10 text-emerald-600" />}
                  title="Queue is clear"
                  description="All counselling requests have been successfully matched and assigned to active counsellors."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                        <th className="pb-3">Student</th>
                        <th className="pb-3">Mode</th>
                        <th className="pb-3">Triage Reason</th>
                        <th className="pb-3">Queue Status</th>
                        <th className="pb-3">Requested</th>
                        <th className="pb-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {workloadData.unassignedQueue.map((req) => (
                        <tr key={req.id} className="hover:bg-slate-50/50">
                          <td className="py-3">
                            <div className="font-semibold text-slate-900">{req.studentName}</div>
                            <div className="text-xs text-slate-500">
                              {req.studentId || 'ID: Confidential'}  {req.department || 'Student'}
                            </div>
                          </td>
                          <td className="py-3">
                            <Badge tone="neutral">{humanize(req.mode)}</Badge>
                          </td>
                          <td className="py-3 text-slate-700 max-w-xs truncate">{req.reason}</td>
                          <td className="py-3">
                            <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-md">
                              {req.statusReason}
                            </span>
                          </td>
                          <td className="py-3 text-xs text-slate-500">
                            {new Date(req.createdAt).toLocaleDateString('en-IN', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 text-right space-x-2">
                            <Button
                              size="sm"
                              variant="brand"
                              loading={actionLoading}
                              onClick={() => handleAutoAssign(req.id)}
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-1" /> Auto-Assign
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedRequest(req.id);
                                setAssignReason('Manual coordinator triage');
                              }}
                            >
                              Manual
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Tab 3: Assignment History */}
        <TabsContent value="history" className="space-y-4 pt-4">
          <Card>
            <CardHeader
              title="Recent counsellor assignments & reassignments"
              description="Transparent audit log of automated scoring and coordinator actions."
            />
            <div className="p-4">
              {workloadData.recentAssignments.length === 0 ? (
                <EmptyState
                  title="No recent assignments"
                  description="Recent counsellor auto-assignments and transfers will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {workloadData.recentAssignments.map((a) => (
                    <div
                      key={a.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge tone={a.action.includes('auto') ? 'brand' : 'amber'}>
                            {a.action === 'counsellor.auto_assigned' ? 'Auto-Assigned' : 'Reassigned'}
                          </Badge>
                          <span className="font-semibold text-slate-800">
                            Appointment #{a.appointmentId.slice(-6)}
                          </span>
                          {a.meta?.score && (
                            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                              Score: {a.meta.score} pts
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600">
                          {a.meta?.breakdown?.reasons?.join('  ') ||
                            a.meta?.reason ||
                            'Standard assignment workflow'}
                        </div>
                      </div>
                      <div className="text-xs text-slate-400 whitespace-nowrap">
                        {new Date(a.at).toLocaleString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Tab 4: Analytics */}
        <TabsContent value="analytics" className="space-y-6 pt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Appointments per month" />
              <div className="h-72 p-4">
                <ResponsiveContainer>
                  <BarChart data={statsData.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="month" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" name="Appointments" fill="#059669" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="By status" />
              <div className="h-72 p-4">
                <ResponsiveContainer>
                  <BarChart data={statuses} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis type="number" allowDecimals={false} fontSize={12} />
                    <YAxis type="category" dataKey="status" width={110} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" name="Appointments" fill="#064E3B" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Manual Assignment Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Manual Counsellor Assignment</h3>
                <p className="text-xs text-slate-500">Assign a specific available counsellor to this request.</p>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 font-bold"
                onClick={() => setSelectedRequest(null)}
              >
                ?
              </button>
            </div>
            <form onSubmit={handleManualAssign} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Select Counsellor *
                </label>
                <select
                  required
                  value={assignCounsellorId}
                  onChange={(e) => setAssignCounsellorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm"
                >
                  <option value="">-- Choose an eligible counsellor --</option>
                  {workloadData.counsellors
                    .filter((c) => c.acceptingRequests)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.department})  {c.activeCaseload}/{c.capacity} cases
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Reason for Assignment / Transfer *
                </label>
                <input
                  required
                  type="text"
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                  placeholder="e.g. Student request, specific departmental specialty"
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedRequest(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="brand"
                  loading={actionLoading}
                  disabled={!assignCounsellorId}
                >
                  Confirm Assignment
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
