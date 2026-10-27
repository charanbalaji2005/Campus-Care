'use client';

import * as React from 'react';
import {
  LifeBuoy, Search, Filter, Clock, CheckCircle2, AlertTriangle, MessageSquare, Lock,
  Send, BookOpen, Plus, Edit3, Archive, RefreshCw, UserCheck, Sparkles, ArrowRight,
  ShieldCheck, ChevronDown, ThumbsUp, ThumbsDown, Eye, FileText, User
} from 'lucide-react';
import { PageHeader, Card, Button, Input, Textarea, Select, Badge } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_PRIORITIES,
  type SupportCategory,
  type SupportStatus,
  type SupportPriority,
} from '@campuscare/shared';

interface Ticket {
  _id: string;
  ticketNumber: string;
  subject: string;
  category: SupportCategory;
  description: string;
  attachments: string[];
  preferredChannel: 'in_app' | 'email';
  status: SupportStatus;
  priority: SupportPriority;
  campus: string;
  studentId: {
    _id: string;
    fullName: string;
    email: string;
    department?: string;
    academicYear?: number;
    studentId?: string;
  };
  assignedTo?: {
    _id: string;
    fullName: string;
    email: string;
    role: string;
  } | null;
  assignedAt?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    _id: string;
    senderId: any;
    senderRole: string;
    senderName: string;
    message: string;
    attachments: string[];
    isInternal: boolean;
    createdAt: string;
  }>;
  statusHistory: Array<{
    status: SupportStatus;
    actorName: string;
    actorRole: string;
    reason: string;
    timestamp: string;
  }>;
  feedback?: {
    helpful: boolean;
    comment: string;
    submittedAt: string;
  };
  publishedAsFaqId?: string | null;
}

interface FaqItem {
  _id: string;
  title: string;
  slug: string;
  category: SupportCategory;
  summary: string;
  content: string;
  instructions: string[];
  status: 'draft' | 'published' | 'archived';
  helpfulCount: number;
  unhelpfulCount: number;
  views: number;
  authorName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  unanswered: number;
  new: number;
  open: number;
  assigned: number;
  awaitingStudent: number;
  answered: number;
  resolved: number;
  reopened: number;
  closed: number;
  overdueSla: number;
  faqCount: number;
  avgFirstResponseHours: number;
  byCategory: Record<string, number>;
}

export default function SupportCenterConsolePage() {
  const [activeTab, setActiveTab] = React.useState<'queue' | 'faqs'>('queue');
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [faqs, setFaqs] = React.useState<FaqItem[]>([]);
  const [totalTickets, setTotalTickets] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  // Queue Filters
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [assignedFilter, setAssignedFilter] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState('');

  // Selected Ticket for Details Drawer
  const [selectedTicket, setSelectedTicket] = React.useState<Ticket | null>(null);
  const [replyMessage, setReplyMessage] = React.useState('');
  const [isInternalNote, setIsInternalNote] = React.useState(false);
  const [requestMoreInfo, setRequestMoreInfo] = React.useState(false);
  const [submittingReply, setSubmittingReply] = React.useState(false);

  // Status Update & Reason
  const [statusReason, setStatusReason] = React.useState('');

  // Publish as FAQ Modal
  const [faqModalOpen, setFaqModalOpen] = React.useState(false);
  const [faqTitle, setFaqTitle] = React.useState('');
  const [faqCategory, setFaqCategory] = React.useState<SupportCategory>('other');
  const [faqSummary, setFaqSummary] = React.useState('');
  const [faqContent, setFaqContent] = React.useState('');
  const [publishingFaq, setPublishingFaq] = React.useState(false);

  // New/Edit FAQ Modal
  const [faqEditorOpen, setFaqEditorOpen] = React.useState(false);
  const [editingFaqId, setEditingFaqId] = React.useState<string | null>(null);
  const [editorTitle, setEditorTitle] = React.useState('');
  const [editorCategory, setEditorCategory] = React.useState<SupportCategory>('account_verification');
  const [editorSummary, setEditorSummary] = React.useState('');
  const [editorContent, setEditorContent] = React.useState('');
  const [editorInstructions, setEditorInstructions] = React.useState('');
  const [savingFaq, setSavingFaq] = React.useState(false);

  const loadData = React.useCallback(async () => {
    try {
      setRefreshing(true);
      const [statsData, ticketsData, faqsData] = await Promise.all([
        api.get<Stats>('/support/admin/stats'),
        api.get<{ tickets: Ticket[]; total: number }>(
          `/support/admin/tickets?status=${statusFilter}&category=${categoryFilter}&priority=${priorityFilter}&assigned=${assignedFilter}&q=${encodeURIComponent(searchQuery)}`
        ),
        api.get<{ articles: FaqItem[]; total: number }>('/support/admin/faqs'),
      ]);

      setStats(statsData);
      setTickets(ticketsData.tickets);
      setTotalTickets(ticketsData.total);
      setFaqs(faqsData.articles);

      if (selectedTicket) {
        const updated = ticketsData.tickets.find((t) => t._id === selectedTicket._id);
        if (updated) setSelectedTicket(updated);
      }
    } catch (err) {
      console.error('Failed to load support data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, categoryFilter, priorityFilter, assignedFilter, searchQuery, selectedTicket]);

  React.useEffect(() => {
    loadData();
  }, [statusFilter, categoryFilter, priorityFilter, assignedFilter]);

  const handleSendReply = async () => {
    if (!selectedTicket || !replyMessage.trim()) return;
    setSubmittingReply(true);
    try {
      const updated = await api.post<Ticket>(`/support/admin/tickets/${selectedTicket._id}/reply`, {
        message: replyMessage.trim(),
        isInternal: isInternalNote,
        requestMoreInfo,
      });

      setSelectedTicket(updated);
      setReplyMessage('');
      setIsInternalNote(false);
      setRequestMoreInfo(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to send reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleUpdateStatus = async (newStatus: SupportStatus) => {
    if (!selectedTicket) return;
    try {
      const updated = await api.post<Ticket>(`/support/admin/tickets/${selectedTicket._id}/status`, {
        status: newStatus,
        reason: statusReason.trim() || undefined,
      });
      setSelectedTicket(updated);
      setStatusReason('');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const openPublishFaqModal = (ticket: Ticket) => {
    const sanitizedQuestion = ticket.subject
      .replace(/my student id is \w+/gi, '')
      .replace(/\b\d{9,12}\b/g, '')
      .trim();

    const adminAnswer = [...ticket.messages]
      .reverse()
      .find((m) => !m.isInternal && m.senderRole !== 'student');

    setFaqTitle(sanitizedQuestion || ticket.subject);
    setFaqCategory(ticket.category);
    setFaqSummary(ticket.description.slice(0, 160).trim());
    setFaqContent(adminAnswer ? adminAnswer.message : ticket.description);
    setFaqModalOpen(true);
  };

  const handlePublishFaqSubmit = async () => {
    if (!selectedTicket || !faqTitle.trim() || !faqContent.trim()) return;
    setPublishingFaq(true);
    try {
      await api.post(`/support/admin/tickets/${selectedTicket._id}/publish-faq`, {
        title: faqTitle.trim(),
        category: faqCategory,
        summary: faqSummary.trim() || faqTitle.trim(),
        content: faqContent.trim(),
        status: 'published',
      });
      alert('Official Knowledge Base FAQ article created and published successfully!');
      setFaqModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to publish FAQ');
    } finally {
      setPublishingFaq(false);
    }
  };

  const openFaqEditor = (faq?: FaqItem) => {
    if (faq) {
      setEditingFaqId(faq._id);
      setEditorTitle(faq.title);
      setEditorCategory(faq.category);
      setEditorSummary(faq.summary);
      setEditorContent(faq.content);
      setEditorInstructions(faq.instructions?.join('\n') || '');
    } else {
      setEditingFaqId(null);
      setEditorTitle('');
      setEditorCategory('account_verification');
      setEditorSummary('');
      setEditorContent('');
      setEditorInstructions('');
    }
    setFaqEditorOpen(true);
  };

  const handleSaveFaq = async () => {
    if (!editorTitle.trim() || !editorContent.trim()) return;
    setSavingFaq(true);
    try {
      const instructions = editorInstructions
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (editingFaqId) {
        await api.patch(`/support/admin/faqs/${editingFaqId}`, {
          title: editorTitle.trim(),
          category: editorCategory,
          summary: editorSummary.trim() || editorTitle.trim(),
          content: editorContent.trim(),
          instructions,
        });
      } else {
        await api.post('/support/admin/faqs', {
          title: editorTitle.trim(),
          category: editorCategory,
          summary: editorSummary.trim() || editorTitle.trim(),
          content: editorContent.trim(),
          instructions,
          status: 'published',
        });
      }
      setFaqEditorOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to save FAQ');
    } finally {
      setSavingFaq(false);
    }
  };

  const handleArchiveFaq = async (id: string) => {
    if (!confirm('Are you sure you want to archive this knowledge base article?')) return;
    try {
      await api.delete(`/support/admin/faqs/${id}`);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to archive article');
    }
  };

  const getStatusBadge = (status: SupportStatus) => {
    switch (status) {
      case 'new': return <Badge tone="rose">New</Badge>;
      case 'open': return <Badge tone="amber">Open</Badge>;
      case 'assigned': return <Badge tone="brand">Assigned</Badge>;
      case 'awaiting_student': return <Badge tone="neutral">Awaiting Student</Badge>;
      case 'answered': return <Badge tone="brand">Answered</Badge>;
      case 'resolved': return <Badge tone="brand">Resolved</Badge>;
      case 'reopened': return <Badge tone="rose">Reopened</Badge>;
      case 'closed': return <Badge tone="neutral">Closed</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Support Center Management"
          description="Monitor incoming student requests, triage unanswered questions, enforce SLAs, and curate the public knowledge base."
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            loading={refreshing}
            className="rounded-xl border-line"
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('queue')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'queue' ? 'bg-white text-forest shadow-sm' : 'text-ink-soft hover:text-ink-strong'
              }`}
            >
              Ticket Queue ({totalTickets})
            </button>
            <button
              onClick={() => setActiveTab('faqs')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'faqs' ? 'bg-white text-forest shadow-sm' : 'text-ink-soft hover:text-ink-strong'
              }`}
            >
              Knowledge Base ({faqs.length})
            </button>
          </div>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-2xl border border-line bg-white p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Unanswered</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{stats.unanswered}</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Needs admin response</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Awaiting Student</p>
            <p className="text-2xl font-bold text-sky-600 mt-1">{stats.awaitingStudent}</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Info requested</p>
          </div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">Overdue SLA (&gt;24h)</p>
            <p className="text-2xl font-bold text-rose-600 mt-1">{stats.overdueSla}</p>
            <p className="text-[11px] text-rose-700 mt-0.5">Breached target</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Resolved / Closed</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.resolved + stats.closed}</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Successfully handled</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Avg First Response</p>
            <p className="text-2xl font-bold text-forest mt-1">{stats.avgFirstResponseHours}h</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Median turnaround</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Published FAQs</p>
            <p className="text-2xl font-bold text-brand-700 mt-1">{stats.faqCount}</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Self-service articles</p>
          </div>
        </div>
      )}

      {activeTab === 'queue' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className={`${selectedTicket ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-4`}>
            <Card className="p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search ticket #, student, subject..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadData()}
                    className="pl-9 h-10"
                  />
                </div>
                <Button size="sm" variant="default" onClick={loadData} className="shrink-0 h-10">
                  Search
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <label className="text-[10px] uppercase font-bold text-ink-faint mb-1 block">Status</label>
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-8 text-xs py-0"
                  >
                    <option value="all">All Statuses</option>
                    <option value="unanswered">Unanswered Only</option>
                    {SUPPORT_STATUSES.map((s) => (
                      <option key={s} value={s}>{SUPPORT_STATUS_LABELS[s]}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-ink-faint mb-1 block">Category</label>
                  <Select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-8 text-xs py-0"
                  >
                    <option value="all">All Categories</option>
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{SUPPORT_CATEGORY_LABELS[c]}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-ink-faint mb-1 block">Priority</label>
                  <Select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="h-8 text-xs py-0"
                  >
                    <option value="all">All Priorities</option>
                    {SUPPORT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p.toUpperCase()}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-ink-faint mb-1 block">Assignment</label>
                  <Select
                    value={assignedFilter}
                    onChange={(e) => setAssignedFilter(e.target.value)}
                    className="h-8 text-xs py-0"
                  >
                    <option value="all">All Tickets</option>
                    <option value="unassigned">Unassigned Only</option>
                    <option value="me">Assigned to Me</option>
                  </Select>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-slate-50/70 text-ink-faint font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-3.5">Ticket</th>
                      <th className="py-3 px-3.5">Student</th>
                      <th className="py-3 px-3.5">Category</th>
                      <th className="py-3 px-3.5">Status</th>
                      <th className="py-3 px-3.5">Assigned</th>
                      <th className="py-3 px-3.5 text-right">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {tickets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-ink-soft">
                          <LifeBuoy className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                          <p className="font-semibold text-ink-strong">No tickets found</p>
                          <p className="text-xs text-ink-soft">Adjust filters or search query.</p>
                        </td>
                      </tr>
                    ) : (
                      tickets.map((t) => {
                        const isSelected = selectedTicket?._id === t._id;
                        return (
                          <tr
                            key={t._id}
                            onClick={() => setSelectedTicket(t)}
                            className={`cursor-pointer transition-colors hover:bg-brand-50/30 ${
                              isSelected ? 'bg-brand-50/70 font-medium' : ''
                            }`}
                          >
                            <td className="py-3 px-3.5">
                              <span className="font-mono font-bold text-brand-800">#{t.ticketNumber}</span>
                              <p className="text-[11px] text-ink-soft line-clamp-1 max-w-[200px] mt-0.5 font-normal">
                                {t.subject}
                              </p>
                            </td>
                            <td className="py-3 px-3.5">
                              <p className="font-semibold text-ink-strong">{t.studentId?.fullName || 'Student'}</p>
                              <p className="text-[11px] text-ink-faint">
                                {t.studentId?.department || t.studentId?.email?.split('@')[0]}
                              </p>
                            </td>
                            <td className="py-3 px-3.5">
                              <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px]">
                                {SUPPORT_CATEGORY_LABELS[t.category] || t.category}
                              </span>
                            </td>
                            <td className="py-3 px-3.5">{getStatusBadge(t.status)}</td>
                            <td className="py-3 px-3.5">
                              {t.assignedTo ? (
                                <span className="text-[11px] font-medium text-forest flex items-center gap-1">
                                  <UserCheck className="h-3 w-3 text-brand-600" />
                                  {t.assignedTo.fullName}
                                </span>
                              ) : (
                                <span className="text-[11px] text-amber-600 font-medium">Unassigned</span>
                              )}
                            </td>
                            <td className="py-3 px-3.5 text-right text-ink-faint text-[11px]">
                              {new Date(t.createdAt).toLocaleDateString('en-IN', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {selectedTicket && (
            <div className="lg:col-span-5 space-y-4">
              <Card className="p-4 space-y-4 border-brand-200 shadow-md">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-line">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-brand-800">
                        #{selectedTicket.ticketNumber}
                      </span>
                      {getStatusBadge(selectedTicket.status)}
                    </div>
                    <h3 className="text-base font-bold text-ink-strong mt-1 leading-snug">
                      {selectedTicket.subject}
                    </h3>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedTicket(null)}
                    className="h-7 px-2 text-ink-soft text-xs"
                  >
                    Close
                  </Button>
                </div>

                <div className="rounded-xl bg-slate-50 p-3 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center text-forest font-bold">
                      {selectedTicket.studentId?.fullName?.charAt(0) || 'S'}
                    </div>
                    <div>
                      <p className="font-bold text-ink-strong">{selectedTicket.studentId?.fullName}</p>
                      <p className="text-[11px] text-ink-soft">{selectedTicket.studentId?.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-ink-faint">
                      {selectedTicket.studentId?.department || 'SRM-AP'}
                    </p>
                    <p className="text-[11px] text-ink-faint">Campus: {selectedTicket.campus}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {selectedTicket.status !== 'resolved' && selectedTicket.status !== 'closed' && (
                    <Button
                      size="sm"
                      variant="brand"
                      onClick={() => handleUpdateStatus('resolved')}
                      className="text-xs h-8"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Mark Resolved
                    </Button>
                  )}
                  {selectedTicket.status === 'resolved' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUpdateStatus('closed')}
                      className="text-xs h-8"
                    >
                      Close Ticket
                    </Button>
                  )}
                  {(selectedTicket.status === 'resolved' || selectedTicket.status === 'closed') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUpdateStatus('reopened')}
                      className="text-xs h-8"
                    >
                      Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => openPublishFaqModal(selectedTicket)}
                    className="text-xs h-8 ml-auto text-forest font-semibold"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1 text-brand-600" />
                    Publish as FAQ
                  </Button>
                </div>

                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {selectedTicket.messages.map((m, idx) => {
                    const isStaff = m.senderRole !== 'student';
                    return (
                      <div
                        key={idx}
                        className={`rounded-2xl p-3.5 text-xs space-y-1.5 ${
                          m.isInternal
                            ? 'bg-amber-50/80 border border-amber-200 text-amber-950'
                            : isStaff
                            ? 'bg-brand-50/70 border border-brand-200 text-ink-strong'
                            : 'bg-white border border-line text-ink-strong shadow-xs'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold flex items-center gap-1.5">
                            {m.isInternal && <Lock className="h-3 w-3 text-amber-600" />}
                            {m.isInternal ? (
                              <span className="text-amber-800 uppercase font-black tracking-wide text-[10px]">
                                Staff Internal Note
                              </span>
                            ) : (
                              <span>{m.senderName} ({m.senderRole})</span>
                            )}
                          </span>
                          <span className="text-ink-faint">
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed text-xs">{m.message}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-line space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsInternalNote(false)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition ${
                          !isInternalNote
                            ? 'bg-forest text-white'
                            : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
                        }`}
                      >
                        Public Student Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsInternalNote(true)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg flex items-center gap-1 transition ${
                          isInternalNote
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-100 text-amber-800 hover:bg-amber-100'
                        }`}
                      >
                        <Lock className="h-3 w-3" />
                        Internal Staff Note
                      </button>
                    </div>

                    {!isInternalNote && (
                      <label className="text-[11px] flex items-center gap-1.5 text-ink-soft cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requestMoreInfo}
                          onChange={(e) => setRequestMoreInfo(e.target.checked)}
                          className="rounded text-brand-600 focus:ring-brand-500"
                        />
                        Request info (Awaiting Student)
                      </label>
                    )}
                  </div>

                  <Textarea
                    placeholder={
                      isInternalNote
                        ? 'Write internal notes hidden from student (e.g. delegated to hostel supervisor)...'
                        : 'Type your official response to the student...'
                    }
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={3}
                    className="text-xs"
                  />

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant={isInternalNote ? 'default' : 'brand'}
                      onClick={handleSendReply}
                      loading={submittingReply}
                      disabled={!replyMessage.trim()}
                      className="text-xs"
                    >
                      <Send className="h-3 w-3 mr-1" />
                      {isInternalNote ? 'Save Internal Note' : 'Send Student Reply'}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-ink-strong">Campus Knowledge Base Articles</h2>
              <p className="text-xs text-ink-soft">
                Pre-approved guides and solutions published to students across web and mobile.
              </p>
            </div>
            <Button size="sm" variant="brand" onClick={() => openFaqEditor()} className="text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" />
              New Article
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {faqs.map((faq) => (
              <Card key={faq._id} className="p-4 flex flex-col justify-between hover:border-brand-300 transition">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">
                      {SUPPORT_CATEGORY_LABELS[faq.category] || faq.category}
                    </span>
                    <span className="text-[11px] text-ink-faint font-mono">v{faq.version}</span>
                  </div>
                  <h3 className="font-bold text-sm text-ink-strong line-clamp-2">{faq.title}</h3>
                  <p className="text-xs text-ink-soft line-clamp-3 leading-relaxed">{faq.summary}</p>
                </div>

                <div className="pt-3 border-t border-line mt-3 flex items-center justify-between text-[11px] text-ink-faint">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" /> {faq.views}
                    </span>
                    <span className="flex items-center gap-1 text-emerald-700">
                      <ThumbsUp className="h-3 w-3" /> {faq.helpfulCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openFaqEditor(faq)}
                      className="h-7 px-2 text-xs text-ink-soft hover:text-ink-strong"
                    >
                      <Edit3 className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleArchiveFaq(faq._id)}
                      className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700"
                    >
                      <Archive className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {faqModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 space-y-4 shadow-2xl border border-line animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink-strong flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand-600" />
                  Publish Question as Public FAQ
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Sanitize personal identifiers (names, roll numbers, emails) before publishing to the student body.
                </p>
              </div>
              <button
                onClick={() => setFaqModalOpen(false)}
                className="text-ink-soft hover:text-ink-strong font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-ink-strong block mb-1">Public Question / Title</label>
                <Input
                  value={faqTitle}
                  onChange={(e) => setFaqTitle(e.target.value)}
                  placeholder="e.g. How do I access the campus safe walk feature?"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-ink-strong block mb-1">Category</label>
                  <Select
                    value={faqCategory}
                    onChange={(e) => setFaqCategory(e.target.value as SupportCategory)}
                  >
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{SUPPORT_CATEGORY_LABELS[c]}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="font-semibold text-ink-strong block mb-1">Brief Summary</label>
                  <Input
                    value={faqSummary}
                    onChange={(e) => setFaqSummary(e.target.value)}
                    placeholder="Short 1-sentence synopsis"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-ink-strong block mb-1">
                  Official Campus Admin Answer (Markdown supported)
                </label>
                <Textarea
                  value={faqContent}
                  onChange={(e) => setFaqContent(e.target.value)}
                  rows={6}
                  placeholder="Detailed explanation and instructions..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button size="sm" variant="outline" onClick={() => setFaqModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="brand"
                onClick={handlePublishFaqSubmit}
                loading={publishingFaq}
                disabled={!faqTitle.trim() || !faqContent.trim()}
              >
                Approve & Publish FAQ
              </Button>
            </div>
          </div>
        </div>
      )}

      {faqEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-line max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink-strong">
                  {editingFaqId ? 'Edit Knowledge Base Article' : 'Create Knowledge Base Article'}
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Write clear, actionable instructions for SRM University-AP students.
                </p>
              </div>
              <button
                onClick={() => setFaqEditorOpen(false)}
                className="text-ink-soft hover:text-ink-strong font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-ink-strong block mb-1">Article Title</label>
                <Input
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  placeholder="e.g. SOS Emergency Response & Activation Guidance"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-ink-strong block mb-1">Category</label>
                  <Select
                    value={editorCategory}
                    onChange={(e) => setEditorCategory(e.target.value as SupportCategory)}
                  >
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{SUPPORT_CATEGORY_LABELS[c]}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="font-semibold text-ink-strong block mb-1">Summary</label>
                  <Input
                    value={editorSummary}
                    onChange={(e) => setEditorSummary(e.target.value)}
                    placeholder="Short summary displayed in search cards"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-ink-strong block mb-1">
                  Article Body (Markdown supported)
                </label>
                <Textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  rows={8}
                  placeholder="Detailed explanations, guidelines, screenshots..."
                />
              </div>

              <div>
                <label className="font-semibold text-ink-strong block mb-1">
                  Numbered Instructions / Steps (One per line)
                </label>
                <Textarea
                  value={editorInstructions}
                  onChange={(e) => setEditorInstructions(e.target.value)}
                  rows={3}
                  placeholder="Step 1: Open Settings&#10;Step 2: Tap Verify&#10;Step 3: Enter OTP"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button size="sm" variant="outline" onClick={() => setFaqEditorOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="brand"
                onClick={handleSaveFaq}
                loading={savingFaq}
                disabled={!editorTitle.trim() || !editorContent.trim()}
              >
                Save & Publish
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
