'use client';

import * as React from 'react';
import {
  LifeBuoy, Search, HelpCircle, MessageSquarePlus, Clock, CheckCircle2,
  BookOpen, PhoneCall, Mail, ShieldAlert, Send, RefreshCw, ThumbsUp,
  ThumbsDown, ChevronDown, ChevronUp, AlertCircle, Lock, ArrowRight,
  Sparkles, Check, Paperclip, MessageSquare, User, Building2
} from 'lucide-react';
import { Button, Input, Textarea, Select, Badge, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  type SupportCategory,
  type SupportStatus,
} from '@campuscare/shared';

interface FaqArticle {
  _id: string;
  title: string;
  slug: string;
  category: SupportCategory;
  summary: string;
  content: string;
  instructions: string[];
  helpfulCount: number;
  unhelpfulCount: number;
  views: number;
  authorName: string;
}

interface TicketMessage {
  _id: string;
  senderRole: string;
  senderName: string;
  message: string;
  attachments: string[];
  createdAt: string;
}

interface StudentTicket {
  _id: string;
  ticketNumber: string;
  subject: string;
  category: SupportCategory;
  description: string;
  attachments: string[];
  preferredChannel: 'in_app' | 'email';
  status: SupportStatus;
  priority: string;
  campus: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
  feedback?: {
    helpful: boolean;
    comment: string;
    submittedAt: string;
  };
}

export function SupportCenter() {
  const [activeTab, setActiveTab] = React.useState<
    'help' | 'ask' | 'my_questions' | 'answered' | 'contacts'
  >('help');

  // Search & FAQ state
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('all');
  const [faqs, setFaqs] = React.useState<FaqArticle[]>([]);
  const [expandedFaqId, setExpandedFaqId] = React.useState<string | null>(null);
  const [loadingFaqs, setLoadingFaqs] = React.useState(true);

  // Ask Question Form state
  const [askSubject, setAskSubject] = React.useState('');
  const [askCategory, setAskCategory] = React.useState<SupportCategory>('account_verification');
  const [askDescription, setAskDescription] = React.useState('');
  const [askAttachment, setAskAttachment] = React.useState('');
  const [askPreferredChannel, setAskPreferredChannel] = React.useState<'in_app' | 'email'>('in_app');
  const [submittingQuestion, setSubmittingQuestion] = React.useState(false);
  const [submitSuccessTicket, setSubmitSuccessTicket] = React.useState<string | null>(null);

  // My Questions state
  const [myTickets, setMyTickets] = React.useState<StudentTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = React.useState(false);
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null);
  const [replyMessage, setReplyMessage] = React.useState('');
  const [submittingReply, setSubmittingReply] = React.useState(false);
  const [reopenReason, setReopenReason] = React.useState('');
  const [feedbackComment, setFeedbackComment] = React.useState('');

  // Load FAQ articles
  const loadFaqs = React.useCallback(async () => {
    try {
      setLoadingFaqs(true);
      const res = await api.get<{ articles: FaqArticle[] }>(
        `/support/faqs?category=${selectedCategory}&q=${encodeURIComponent(searchQuery)}`
      );
      setFaqs(res.articles || []);
    } catch (err) {
      console.error('Failed to load FAQs:', err);
    } finally {
      setLoadingFaqs(false);
    }
  }, [selectedCategory, searchQuery]);

  React.useEffect(() => {
    loadFaqs();
  }, [selectedCategory]);

  // Load My Tickets
  const loadMyTickets = React.useCallback(async () => {
    try {
      setLoadingTickets(true);
      const res = await api.get<{ tickets: StudentTicket[] }>('/support/tickets/my');
      setMyTickets(res.tickets || []);
      if (!selectedTicketId && res.tickets?.length > 0) {
        setSelectedTicketId(res.tickets[0]._id);
      }
    } catch (err) {
      console.error('Failed to load my tickets:', err);
    } finally {
      setLoadingTickets(false);
    }
  }, [selectedTicketId]);

  React.useEffect(() => {
    if (activeTab === 'my_questions') {
      loadMyTickets();
    }
  }, [activeTab]);

  // Ask Question submit handler
  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askSubject.trim() || !askDescription.trim()) return;
    setSubmittingQuestion(true);
    try {
      const attachments = askAttachment.trim() ? [askAttachment.trim()] : [];
      const res = await api.post<StudentTicket>('/support/tickets', {
        subject: askSubject.trim(),
        category: askCategory,
        description: askDescription.trim(),
        attachments,
        preferredChannel: askPreferredChannel,
      });

      setSubmitSuccessTicket(res.ticketNumber);
      setAskSubject('');
      setAskDescription('');
      setAskAttachment('');
      await loadMyTickets();
      setSelectedTicketId(res._id);
    } catch (err: any) {
      alert(err.message || 'Failed to submit question');
    } finally {
      setSubmittingQuestion(false);
    }
  };

  // Reply to ticket
  const handleReply = async (ticketId: string) => {
    if (!replyMessage.trim()) return;
    setSubmittingReply(true);
    try {
      await api.post(`/support/tickets/my/${ticketId}/reply`, {
        message: replyMessage.trim(),
        attachments: [],
      });
      setReplyMessage('');
      await loadMyTickets();
    } catch (err: any) {
      alert(err.message || 'Failed to send reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  // Reopen ticket
  const handleReopenTicket = async (ticketId: string) => {
    try {
      await api.post(`/support/tickets/my/${ticketId}/reopen`, {
        reason: reopenReason.trim() || 'Student requested further assistance',
      });
      setReopenReason('');
      await loadMyTickets();
    } catch (err: any) {
      alert(err.message || 'Failed to reopen ticket');
    }
  };

  // Submit feedback for ticket
  const handleTicketFeedback = async (ticketId: string, helpful: boolean) => {
    try {
      await api.post(`/support/tickets/my/${ticketId}/feedback`, {
        helpful,
        comment: feedbackComment.trim() || undefined,
      });
      alert('Thank you for your feedback!');
      setFeedbackComment('');
      await loadMyTickets();
    } catch (err: any) {
      alert(err.message || 'Failed to submit feedback');
    }
  };

  // Submit FAQ helpfulness feedback
  const handleFaqFeedback = async (faqId: string, helpful: boolean) => {
    try {
      await api.post(`/support/faqs/${faqId}/feedback`, { helpful });
      // Optimistically update counts
      setFaqs((prev) =>
        prev.map((f) =>
          f._id === faqId
            ? {
                ...f,
                helpfulCount: helpful ? f.helpfulCount + 1 : f.helpfulCount,
                unhelpfulCount: !helpful ? f.unhelpfulCount + 1 : f.unhelpfulCount,
              }
            : f
        )
      );
    } catch (err) {
      console.error('Failed to submit FAQ feedback', err);
    }
  };

  const selectedTicket = myTickets.find((t) => t._id === selectedTicketId);

  const getStatusBadge = (status: SupportStatus) => {
    switch (status) {
      case 'new': return <Badge tone="rose">New</Badge>;
      case 'open': return <Badge tone="amber">Open</Badge>;
      case 'assigned': return <Badge tone="brand">Assigned</Badge>;
      case 'awaiting_student': return <Badge tone="neutral">Awaiting Your Reply</Badge>;
      case 'answered': return <Badge tone="brand">Answered</Badge>;
      case 'resolved': return <Badge tone="brand">Resolved</Badge>;
      case 'reopened': return <Badge tone="rose">Reopened</Badge>;
      case 'closed': return <Badge tone="neutral">Closed</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-forest-800 via-forest to-brand-800 text-white p-8 sm:p-10 shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-xs font-semibold backdrop-blur-xs">
            <LifeBuoy className="h-3.5 w-3.5" />
            CampusCare Support Center
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Help, FAQs and answers from your campus team
          </h1>
          <p className="text-emerald-100/90 text-sm sm:text-base leading-relaxed">
            Search our verified knowledge base, ask questions to Campus Admins, and track your active support requests in one secure place.
          </p>

          {/* Quick Search Bar */}
          <div className="pt-2">
            <div className="relative flex items-center max-w-xl">
              <Search className="absolute left-4 h-5 w-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search questions or help topics (e.g. SOS, verification, Safe Walk)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setActiveTab('help');
                    loadFaqs();
                  }
                }}
                className="w-full h-12 pl-12 pr-28 rounded-2xl bg-white text-ink-strong placeholder:text-slate-400 text-sm shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <button
                type="button"
                onClick={() => {
                  setActiveTab('help');
                  loadFaqs();
                }}
                className="absolute right-1.5 h-9 px-4 rounded-xl bg-forest hover:bg-forest-700 text-white text-xs font-bold transition shadow-xs"
              >
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Decorative corner accent */}
        <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none transform translate-x-8 translate-y-8">
          <Building2 className="w-96 h-96 text-white" />
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <button
          onClick={() => setActiveTab('help')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'help'
              ? 'bg-forest text-white shadow-sm'
              : 'text-ink-soft hover:text-ink-strong hover:bg-brand-50'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Help & FAQs
        </button>
        <button
          onClick={() => {
            setActiveTab('ask');
            setSubmitSuccessTicket(null);
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'ask'
              ? 'bg-forest text-white shadow-sm'
              : 'text-ink-soft hover:text-ink-strong hover:bg-brand-50'
          }`}
        >
          <MessageSquarePlus className="h-4 w-4" />
          Ask a Question
        </button>
        <button
          onClick={() => setActiveTab('my_questions')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'my_questions'
              ? 'bg-forest text-white shadow-sm'
              : 'text-ink-soft hover:text-ink-strong hover:bg-brand-50'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          My Questions
          {myTickets.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-forest font-bold">
              {myTickets.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('answered')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'answered'
              ? 'bg-forest text-white shadow-sm'
              : 'text-ink-soft hover:text-ink-strong hover:bg-brand-50'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Answered Questions
        </button>
        <button
          onClick={() => setActiveTab('contacts')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'contacts'
              ? 'bg-forest text-white shadow-sm'
              : 'text-ink-soft hover:text-ink-strong hover:bg-brand-50'
          }`}
        >
          <PhoneCall className="h-4 w-4" />
          Contact Campus Support
        </button>
      </div>

      {/* 1. HELP & FAQS TAB */}
      {activeTab === 'help' && (
        <div className="space-y-6">
          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedCategory === 'all'
                  ? 'bg-brand-700 text-white'
                  : 'bg-white border border-line text-ink-soft hover:bg-slate-50'
              }`}
            >
              All Topics
            </button>
            {SUPPORT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  selectedCategory === cat
                    ? 'bg-brand-700 text-white'
                    : 'bg-white border border-line text-ink-soft hover:bg-slate-50'
                }`}
              >
                {SUPPORT_CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          {/* FAQ Accordion List */}
          <div className="space-y-3">
            {loadingFaqs ? (
              <div className="text-center py-12 text-ink-soft text-sm">Loading articles...</div>
            ) : faqs.length === 0 ? (
              <Card className="p-8 text-center text-ink-soft space-y-2">
                <HelpCircle className="h-8 w-8 mx-auto text-slate-300" />
                <p className="font-semibold text-ink-strong">No help articles match your search</p>
                <p className="text-xs">Try different search keywords or ask a direct question.</p>
              </Card>
            ) : (
              faqs.map((faq) => {
                const isExpanded = expandedFaqId === faq._id;
                return (
                  <Card
                    key={faq._id}
                    className="overflow-hidden border border-line hover:border-brand-200 transition"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedFaqId(isExpanded ? null : faq._id)}
                      className="w-full text-left p-5 flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">
                            {SUPPORT_CATEGORY_LABELS[faq.category] || faq.category}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-ink-strong">{faq.title}</h3>
                        <p className="text-xs text-ink-soft line-clamp-1">{faq.summary}</p>
                      </div>
                      <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-ink-soft">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 pt-2 border-t border-line/60 bg-slate-50/50 space-y-4 text-sm leading-relaxed text-ink-strong">
                        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-xs text-ink-soft">
                          {faq.content}
                        </div>

                        {faq.instructions && faq.instructions.length > 0 && (
                          <div className="rounded-xl bg-white p-4 border border-line space-y-2">
                            <p className="text-xs font-bold text-forest uppercase tracking-wider">
                              Action Steps:
                            </p>
                            <ol className="list-decimal pl-4 text-xs space-y-1 text-ink-strong">
                              {faq.instructions.map((step, idx) => (
                                <li key={idx}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-3 border-t border-line text-xs text-ink-soft">
                          <span>Was this answer helpful?</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleFaqFeedback(faq._id, true)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-line bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-semibold transition"
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                              Yes ({faq.helpfulCount})
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFaqFeedback(faq._id, false)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-line bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                              No ({faq.unhelpfulCount})
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 2. ASK A QUESTION TAB */}
      {activeTab === 'ask' && (
        <div className="max-w-2xl mx-auto space-y-6">
          {submitSuccessTicket ? (
            <Card className="p-8 text-center space-y-4 border-emerald-200 bg-emerald-50/30">
              <div className="h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 mx-auto">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-ink-strong">Question Submitted Successfully!</h3>
                <p className="text-xs text-ink-soft">
                  Your support request has been logged as{' '}
                  <span className="font-mono font-bold text-forest">#{submitSuccessTicket}</span>.
                </p>
                <p className="text-xs text-ink-soft">
                  Our Campus Admin team has been notified and will reply shortly.
                </p>
              </div>
              <div className="pt-2 flex justify-center gap-3">
                <Button
                  size="sm"
                  variant="brand"
                  onClick={() => setActiveTab('my_questions')}
                >
                  View in My Questions
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSubmitSuccessTicket(null)}
                >
                  Ask Another Question
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6 sm:p-8 space-y-6">
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-ink-strong">Ask a Campus Admin</h2>
                <p className="text-xs text-ink-soft">
                  Can't find what you need in Help & FAQs? Submit your question to the campus administration team.
                </p>
              </div>

              {/* Privacy Notice Alert */}
              <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-900 flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Privacy & Security Safeguard</p>
                  <p className="text-amber-800 leading-relaxed">
                    Never include passwords, OTP verification codes, or bank information. For emergency SOS alerts
                    or confidential clinical counselling, please use the separate dedicated SOS and Counselling sections in the app.
                  </p>
                </div>
              </div>

              <form onSubmit={handleAskQuestion} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-ink-strong block mb-1">
                    Subject <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    placeholder="Brief summary of your question (e.g. Can't update hostel room WiFi profile)"
                    value={askSubject}
                    onChange={(e) => setAskSubject(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-ink-strong block mb-1">
                      Category <span className="text-rose-500">*</span>
                    </label>
                    <Select
                      value={askCategory}
                      onChange={(e) => setAskCategory(e.target.value as SupportCategory)}
                    >
                      {SUPPORT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {SUPPORT_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="font-semibold text-ink-strong block mb-1">
                      Preferred Notification Channel
                    </label>
                    <Select
                      value={askPreferredChannel}
                      onChange={(e) => setAskPreferredChannel(e.target.value as 'in_app' | 'email')}
                    >
                      <option value="in_app">In-App Notification</option>
                      <option value="email">University Email (@srmap.edu.in)</option>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-ink-strong block mb-1">
                    Detailed Explanation <span className="text-rose-500">*</span>
                  </label>
                  <Textarea
                    placeholder="Explain what happened, steps you took, or the specific information you need..."
                    value={askDescription}
                    onChange={(e) => setAskDescription(e.target.value)}
                    rows={5}
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-ink-strong block mb-1">
                    Optional Attachment URL (Screenshot / Document)
                  </label>
                  <Input
                    placeholder="https://..."
                    value={askAttachment}
                    onChange={(e) => setAskAttachment(e.target.value)}
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <Button
                    type="submit"
                    variant="brand"
                    loading={submittingQuestion}
                    disabled={!askSubject.trim() || !askDescription.trim()}
                    className="w-full sm:w-auto"
                  >
                    <Send className="h-4 w-4 mr-1.5" />
                    Submit Support Question
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}
      {/* 3. MY QUESTIONS TAB */}
      {activeTab === 'my_questions' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-ink-strong">My Support Questions</h2>
              <p className="text-xs text-ink-soft">
                Track status updates and replies from Campus Administrators.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={loadMyTickets}
              loading={loadingTickets}
              className="text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </Button>
          </div>

          {loadingTickets && myTickets.length === 0 ? (
            <div className="text-center py-12 text-ink-soft text-sm">Loading your questions...</div>
          ) : myTickets.length === 0 ? (
            <Card className="p-12 text-center text-ink-soft space-y-3">
              <MessageSquare className="h-10 w-10 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <p className="font-bold text-ink-strong">You haven't asked any questions yet</p>
                <p className="text-xs">Have a question about campus features? Ask our admin team.</p>
              </div>
              <Button size="sm" variant="brand" onClick={() => setActiveTab('ask')}>
                Ask a Question
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Tickets list */}
              <div className="lg:col-span-5 space-y-2">
                {myTickets.map((t) => {
                  const isSelected = selectedTicket?._id === t._id;
                  return (
                    <Card
                      key={t._id}
                      onClick={() => setSelectedTicketId(t._id)}
                      className={`p-4 cursor-pointer transition border hover:border-brand-300 ${
                        isSelected ? 'border-brand-500 bg-brand-50/20 shadow-xs' : 'border-line'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-mono font-bold text-brand-800">#{t.ticketNumber}</span>
                        {getStatusBadge(t.status)}
                      </div>
                      <h4 className="font-bold text-sm text-ink-strong line-clamp-1">{t.subject}</h4>
                      <p className="text-xs text-ink-soft line-clamp-2 mt-1">{t.description}</p>
                      <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-line/60 text-[11px] text-ink-faint">
                        <span>{SUPPORT_CATEGORY_LABELS[t.category] || t.category}</span>
                        <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Selected Ticket Conversation & Replies */}
              {selectedTicket && (
                <div className="lg:col-span-7">
                  <Card className="p-6 space-y-5 border-brand-200 shadow-md">
                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-line">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-brand-800 text-xs">
                            #{selectedTicket.ticketNumber}
                          </span>
                          {getStatusBadge(selectedTicket.status)}
                        </div>
                        <h3 className="text-base font-bold text-ink-strong mt-1">
                          {selectedTicket.subject}
                        </h3>
                        <p className="text-xs text-ink-soft">
                          Category: {SUPPORT_CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category} ·
                          Opened on {new Date(selectedTicket.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Reopen action if resolved/closed */}
                      {(selectedTicket.status === 'resolved' || selectedTicket.status === 'closed') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReopenTicket(selectedTicket._id)}
                          className="text-xs"
                        >
                          Reopen Question
                        </Button>
                      )}
                    </div>

                    {/* Conversation thread */}
                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                      {selectedTicket.messages.map((m, idx) => {
                        const isStudent = m.senderRole === 'student';
                        return (
                          <div
                            key={idx}
                            className={`rounded-2xl p-4 text-xs space-y-1.5 ${
                              isStudent
                                ? 'bg-slate-50 border border-line ml-4'
                                : 'bg-emerald-50/70 border border-emerald-200 mr-4'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold flex items-center gap-1.5">
                                {!isStudent && (
                                  <span className="inline-flex items-center gap-1 text-emerald-800 font-extrabold text-[10px] uppercase bg-emerald-100/70 px-2 py-0.5 rounded">
                                    <ShieldAlert className="h-3 w-3 text-emerald-700" />
                                    Campus Admin
                                  </span>
                                )}
                                <span>{m.senderName}</span>
                              </span>
                              <span className="text-ink-faint">
                                {new Date(m.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap leading-relaxed text-ink-strong">
                              {m.message}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Feedback Rating (if resolved) */}
                    {selectedTicket.status === 'resolved' && (
                      <div className="rounded-2xl bg-brand-50/40 border border-brand-200 p-4 text-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-forest">Did this answer resolve your question?</p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleTicketFeedback(selectedTicket._id, true)}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-700 font-bold hover:bg-emerald-50 transition"
                            >
                              <ThumbsUp className="h-3.5 w-3.5" /> Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTicketFeedback(selectedTicket._id, false)}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white border border-rose-300 text-rose-700 font-bold hover:bg-rose-50 transition"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" /> No
                            </button>
                          </div>
                        </div>
                        {selectedTicket.feedback && (
                          <p className="text-[11px] text-emerald-800 font-semibold">
                            ✓ Feedback recorded: {selectedTicket.feedback.helpful ? 'Helpful' : 'Needs improvement'}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Reply box (if not closed) */}
                    {selectedTicket.status !== 'closed' && (
                      <div className="pt-2 border-t border-line space-y-2">
                        <Textarea
                          placeholder="Type your response to the campus team..."
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          rows={3}
                          className="text-xs"
                        />
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="brand"
                            onClick={() => handleReply(selectedTicket._id)}
                            loading={submittingReply}
                            disabled={!replyMessage.trim()}
                            className="text-xs"
                          >
                            <Send className="h-3.5 w-3.5 mr-1.5" />
                            Send Reply
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. ANSWERED QUESTIONS TAB */}
      {activeTab === 'answered' && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-ink-strong">Answered Campus Questions</h2>
            <p className="text-xs text-ink-soft">
              Real questions submitted by students and answered by the SRM-AP campus administration team, published with personal information sanitized.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Example Card 1 */}
            <Card className="p-5 space-y-3 border-emerald-200 hover:shadow-md transition">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                  SOS & Safety Features
                </span>
                <span className="text-[11px] text-ink-faint">Verified Answer</span>
              </div>
              <h3 className="font-bold text-sm text-ink-strong">How do I use the SOS feature?</h3>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-ink-strong space-y-1.5 border border-line">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-[11px]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Campus Admin Answer
                </div>
                <p className="leading-relaxed text-ink-soft">
                  Open the SOS section, grant the necessary location permissions, and follow the emergency instructions displayed in the app. Use SOS only for genuine emergencies. If you are in immediate danger, contact local emergency services as well.
                </p>
              </div>
              <p className="text-[11px] text-ink-faint">Answered by Campus Admin · Example response</p>
            </Card>

            {/* Example Card 2 */}
            <Card className="p-5 space-y-3 border-emerald-200 hover:shadow-md transition">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                  Account & Verification
                </span>
                <span className="text-[11px] text-ink-faint">Verified Answer</span>
              </div>
              <h3 className="font-bold text-sm text-ink-strong">What if my student verification is pending?</h3>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-ink-strong space-y-1.5 border border-line">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-[11px]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Campus Admin Answer
                </div>
                <p className="leading-relaxed text-ink-soft">
                  Manual verification is reviewed within 24 hours of submission. Ensure your Student ID card photo is clear and your department matches your admission registry. You will receive an in-app confirmation once approved.
                </p>
              </div>
              <p className="text-[11px] text-ink-faint">Answered by Campus Admin · Example response</p>
            </Card>

            {/* Example Card 3 */}
            <Card className="p-5 space-y-3 border-emerald-200 hover:shadow-md transition">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                  GPS & Location
                </span>
                <span className="text-[11px] text-ink-faint">Verified Answer</span>
              </div>
              <h3 className="font-bold text-sm text-ink-strong">Does CampusCare track my location when the app is closed?</h3>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-ink-strong space-y-1.5 border border-line">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-[11px]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Campus Admin Answer
                </div>
                <p className="leading-relaxed text-ink-soft">
                  No. CampusCare never tracks your location in the background. Location data is accessed solely when you actively trigger an emergency SOS, start a Safe Walk escort session, or manually share your live position.
                </p>
              </div>
              <p className="text-[11px] text-ink-faint">Answered by Campus Admin · Example response</p>
            </Card>

            {/* Example Card 4 */}
            <Card className="p-5 space-y-3 border-emerald-200 hover:shadow-md transition">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                  Counselling Appointments
                </span>
                <span className="text-[11px] text-ink-faint">Verified Answer</span>
              </div>
              <h3 className="font-bold text-sm text-ink-strong">Can administrators see my counselling session notes?</h3>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-ink-strong space-y-1.5 border border-line">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-[11px]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Campus Admin Answer
                </div>
                <p className="leading-relaxed text-ink-soft">
                  No. Psychological counselling records are protected by strict clinical confidentiality. Neither Super Admins, Campus Admins, nor Security Officers have access to your private consultation records.
                </p>
              </div>
              <p className="text-[11px] text-ink-faint">Answered by Campus Admin · Example response</p>
            </Card>
          </div>
        </div>
      )}

      {/* 5. CONTACT CAMPUS SUPPORT TAB */}
      {activeTab === 'contacts' && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-ink-strong">Campus Support Contacts</h2>
            <p className="text-xs text-ink-soft">
              Direct emergency and operational contacts for SRM University-AP.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-5 space-y-3 border-rose-200 bg-rose-50/30">
              <div className="flex items-center gap-2.5 text-rose-800">
                <div className="h-9 w-9 rounded-xl bg-rose-100 flex items-center justify-center font-bold">
                  <PhoneCall className="h-5 w-5 text-rose-700" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-ink-strong">Security Control Room</h4>
                  <p className="text-[11px] text-rose-700 font-semibold">24/7 Emergency Dispatch</p>
                </div>
              </div>
              <p className="text-xs text-ink-soft">
                For immediate on-campus security assistance, perimeter escort, or urgent physical intervention.
              </p>
              <div className="pt-2 flex gap-2">
                <a
                  href="tel:08632343000"
                  className="inline-flex items-center justify-center gap-1.5 w-full h-9 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Call 0863-2343000
                </a>
              </div>
            </Card>

            <Card className="p-5 space-y-3 border-emerald-200 bg-emerald-50/30">
              <div className="flex items-center gap-2.5 text-emerald-800">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center font-bold">
                  <Building2 className="h-5 w-5 text-emerald-700" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-ink-strong">Campus Health Center</h4>
                  <p className="text-[11px] text-emerald-700 font-semibold">Medical Clinic & Ambulance</p>
                </div>
              </div>
              <p className="text-xs text-ink-soft">
                Resident medical doctors, nursing staff, emergency first-aid, and campus ambulance.
              </p>
              <div className="pt-2 flex gap-2">
                <a
                  href="tel:08632343100"
                  className="inline-flex items-center justify-center gap-1.5 w-full h-9 rounded-xl bg-forest hover:bg-forest-700 text-white font-bold text-xs shadow-xs transition"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Call 0863-2343100
                </a>
              </div>
            </Card>

            <Card className="p-5 space-y-3 border-line">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center font-bold">
                  <Mail className="h-5 w-5 text-violet-700" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-ink-strong">Counselling & Wellness</h4>
                  <p className="text-[11px] text-violet-700 font-semibold">Psychological Services</p>
                </div>
              </div>
              <p className="text-xs text-ink-soft">
                Confidential appointments with university clinical psychologists and wellness advisers.
              </p>
              <div className="pt-2 flex gap-2">
                <a
                  href="mailto:counselling@srmap.edu.in"
                  className="inline-flex items-center justify-center gap-1.5 w-full h-9 rounded-xl border border-line bg-white hover:bg-slate-50 text-ink-strong font-semibold text-xs shadow-xs transition"
                >
                  <Mail className="h-3.5 w-3.5" /> counselling@srmap.edu.in
                </a>
              </div>
            </Card>

            <Card className="p-5 space-y-3 border-line">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-sky-100 flex items-center justify-center font-bold">
                  <LifeBuoy className="h-5 w-5 text-sky-700" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-ink-strong">IT Helpdesk</h4>
                  <p className="text-[11px] text-sky-700 font-semibold">Technical & WiFi Support</p>
                </div>
              </div>
              <p className="text-xs text-ink-soft">
                SRM-AP student email provisioning, portal password reset, and hostel network connectivity.
              </p>
              <div className="pt-2 flex gap-2">
                <a
                  href="mailto:it_helpdesk@srmap.edu.in"
                  className="inline-flex items-center justify-center gap-1.5 w-full h-9 rounded-xl border border-line bg-white hover:bg-slate-50 text-ink-strong font-semibold text-xs shadow-xs transition"
                >
                  <Mail className="h-3.5 w-3.5" /> it_helpdesk@srmap.edu.in
                </a>
              </div>
            </Card>

            <Card className="p-5 space-y-3 border-amber-200 bg-amber-50/30">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center font-bold">
                  <ShieldAlert className="h-5 w-5 text-amber-700" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-ink-strong">Anti-Ragging Helpline</h4>
                  <p className="text-[11px] text-amber-800 font-semibold">Toll-Free National 24/7</p>
                </div>
              </div>
              <p className="text-xs text-ink-soft">
                National UGC Anti-Ragging helpline and university anti-ragging squad reporting.
              </p>
              <div className="pt-2 flex gap-2">
                <a
                  href="tel:18001805522"
                  className="inline-flex items-center justify-center gap-1.5 w-full h-9 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Call 1800-180-5522
                </a>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
