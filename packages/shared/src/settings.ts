import type { DispatchPolicy, MediaScope } from './enums';

export interface MediaScopePolicy {
  images: boolean;
  videos: boolean;
}

export interface PlatformSettings {
  platform: {
    name: string;
    universityName: string;
    supportEmail: string;
    maintenanceMode: boolean;
  };
  registration: {
    studentRegistrationOpen: boolean;
    /** When true, only addresses on an active approved domain may register or sign in with Google. */
    restrictToApprovedDomains: boolean;
    requireEmailVerification: boolean;
  };
  turnstile: {
    enabled: boolean;
    /** Forms that require a Turnstile token (checked on the server). */
    forms: {
      register: boolean;
      login: boolean;
      forgotPassword: boolean;
      resetPassword: boolean;
      resendVerification: boolean;
      incidentSubmit: boolean;
      communityPost: boolean;
    };
  };
  security: {
    sessionIdleMinutes: number;
    sessionAbsoluteHours: number;
    rememberMeDays: number;
    reauthWindowMinutes: number;
    requireMfaForSuperAdmin: boolean;
    requireMfaForAdmins: boolean;
    maxLoginAttempts: number;
    lockoutMinutes: number;
    passwordMinLength: number;
  };
  incidents: {
    anonymousReportingEnabled: boolean;
    /** Categories where anonymous reporting is allowed by university policy. */
    anonymousCategories: string[];
    acknowledgeWithinHours: number;
    resolveWithinDays: number;
    evidenceMaxMb: number;
    evidenceMaxFiles: number;
  };
  chat: {
    communityEnabled: boolean;
    communityPostRateLimitPerMinute: number;
    /**
     * Image and video sending. OFF by default for every chat type —
     * the Super Admin must explicitly turn it on.
     */
    media: Record<MediaScope, MediaScopePolicy>;
    maxImageMb: number;
    maxVideoMb: number;
  };
  sos: {
    enabled: boolean;
    countdownSeconds: number;
    allowCancelAfterSend: boolean;
    emailRecipients: boolean;
    /** No responder acknowledgement within this time → notify backup recipients. */
    escalateAfterSeconds: number;
    /** Still no acknowledgement → notify administrators and the Super Admin. */
    secondEscalationAfterSeconds: number;
    /** Quick triggers (Quick Settings tile, home-screen shortcut) start the countdown straight away. */
    quickTriggerEnabled: boolean;
    /** Body of the countdown notification. Never contains location or case details (it can show on the lock screen). */
    quickTriggerMessage: string;
  };
  map: {
    centerLatitude: number;
    centerLongitude: number;
    zoom: number;
    /** Heatmap cells with fewer reports than this are hidden (k-anonymity). */
    heatmapMinCount: number;
    heatmapDays: number;
  };
  community: {
    lostFoundEnabled: boolean;
    suggestionsEnabled: boolean;
    hazardReportsEnabled: boolean;
    /** Community feed (posts, comments, reactions). */
    feedEnabled: boolean;
    /** Hold every student post for a moderator before it is published. */
    feedPreModeration: boolean;
    /** Allow students to attach images to feed posts (official accounts always can). */
    feedImagesEnabled: boolean;
    /** Community events and RSVPs. */
    eventsEnabled: boolean;
  };
  mobile: {
    /** Builds below this version code must update before they can be used. */
    minSupportedVersionCode: number;
    latestVersionCode: number;
    latestVersionName: string;
    downloadUrl: string;
    updateMessage: string;
    /** Banner shown at the top of the app (e.g. planned downtime). Empty = none. */
    bannerMessage: string;
    bannerSeverity: 'info' | 'warning' | 'critical';
  };
  safeWalk: {
    enabled: boolean;
    graceMinutes: number;
    notifySecurityOnEscalation: boolean;
  };
  locationSharing: {
    enabled: boolean;
    maxDurationMinutes: number;
    retentionHours: number;
  };
  notifications: {
    emailOnCaseUpdate: boolean;
    emailOnNewCaseMessage: boolean;
    emailAppointmentReminders: boolean;
    reminderHoursBefore: number;
  };
  retention: {
    notificationsDays: number;
    communityMessagesDays: number;
    auditLogDays: number;
    closedCaseReviewDays: number;
  };
  inboundEmail: {
    enabled: boolean;
    allowCaseCreation: boolean;
    allowReplies: boolean;
  };
  counsellorDirectory: {
    /** Distinct students who must have shared feedback before a counsellor's ratings, themes or comments are public (minimum 3). */
    feedbackMinimum: number;
    /** Show moderator-approved, anonymised comments on public profiles (ratings and themes are unaffected). */
    showComments: boolean;
  };
  duty: {
    /** How often the app sends a heartbeat while its responder is on duty. */
    heartbeatIntervalSeconds: number;
    /** No heartbeat for this long → the responder is shown as stale/unreachable (never as off duty). */
    staleThresholdSeconds: number;
    /** When false, a responder can only go on duty inside an accepted shift. */
    allowDutyWithoutShift: boolean;
    /** How early a responder may start an accepted shift. */
    shiftStartGraceMinutes: number;
    /** Responders may share their position with dispatch while on duty, with their consent. */
    responderLocationSharing: boolean;
    notifySupervisorsOnStale: boolean;
  };
  dispatch: {
    /** Assign each SOS to the best eligible responder automatically. */
    autoAssign: boolean;
    /** single = one responder at a time; group = the top N responders at once (first to acknowledge owns it). */
    policy: DispatchPolicy;
    groupSize: number;
    /** An assigned responder must acknowledge within this time, or the alert moves to the next responder. */
    ackDeadlineSeconds: number;
    /** Assignment attempts before the alert is handed to the fallback group. */
    maxAttempts: number;
    maxActiveAssignmentsPerResponder: number;
    /** Allow assigning responders who marked themselves busy (only when nobody else is free). */
    allowBusyResponders: boolean;
    /** Locations less precise than this are not used for proximity ranking. */
    trustedLocationAccuracyMeters: number;
    /** Distances are compared in bands of this size, so GPS noise cannot reorder responders. */
    proximityBandMeters: number;
    /** Skills every SOS responder must hold. */
    requiredSkills: string[];
    /** Skills that rank a responder higher. */
    preferredSkills: string[];
    /** How often an alert with no eligible responder is retried. */
    unassignedRetrySeconds: number;
  };
  chatGovernance: {
    /** Exceptional review of private support / complaint chats (explicit permission, reason, re-authentication). */
    privateReviewEnabled: boolean;
    maxReviewMinutes: number;
    requireCaseReference: boolean;
    /** Allow an audited export of the messages within an active review. */
    allowExport: boolean;
  };
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  platform: {
    name: 'CampusCare',
    universityName: 'Your University',
    supportEmail: 'support@example.edu',
    maintenanceMode: false,
  },
  registration: {
    studentRegistrationOpen: true,
    restrictToApprovedDomains: true,
    requireEmailVerification: true,
  },
  turnstile: {
    enabled: true,
    forms: {
      register: true,
      login: true,
      forgotPassword: true,
      resetPassword: true,
      resendVerification: true,
      incidentSubmit: true,
      communityPost: false,
    },
  },
  security: {
    sessionIdleMinutes: 120,
    sessionAbsoluteHours: 24,
    rememberMeDays: 30,
    reauthWindowMinutes: 10,
    requireMfaForSuperAdmin: true,
    requireMfaForAdmins: false,
    maxLoginAttempts: 8,
    lockoutMinutes: 15,
    passwordMinLength: 10,
  },
  incidents: {
    anonymousReportingEnabled: true,
    anonymousCategories: ['ragging', 'cyber_abuse', 'security', 'infrastructure', 'hostel', 'transport', 'other'],
    acknowledgeWithinHours: 24,
    resolveWithinDays: 30,
    evidenceMaxMb: 10,
    evidenceMaxFiles: 5,
  },
  chat: {
    communityEnabled: true,
    communityPostRateLimitPerMinute: 6,
    media: {
      support: { images: false, videos: false },
      community: { images: false, videos: false },
      case: { images: false, videos: false },
      counselling: { images: false, videos: false },
    },
    maxImageMb: 10,
    maxVideoMb: 50,
  },
  sos: {
    enabled: true,
    countdownSeconds: 10,
    allowCancelAfterSend: true,
    emailRecipients: true,
    escalateAfterSeconds: 120,
    secondEscalationAfterSeconds: 300,
    quickTriggerEnabled: true,
    quickTriggerMessage: 'An SOS will be sent to Campus Security when the countdown ends. Tap Cancel if this was a mistake.',
  },
  map: {
    // Approximate centre of the SRM University-AP campus (Neerukonda, Amaravati). Adjust in Super Admin → Safety map.
    centerLatitude: 16.4636,
    centerLongitude: 80.5074,
    zoom: 16,
    heatmapMinCount: 5,
    heatmapDays: 90,
  },
  community: {
    lostFoundEnabled: true,
    suggestionsEnabled: true,
    hazardReportsEnabled: true,
    feedEnabled: true,
    feedPreModeration: false,
    feedImagesEnabled: true,
    eventsEnabled: true,
  },
  mobile: {
    minSupportedVersionCode: 1,
    latestVersionCode: 1,
    latestVersionName: '1.0.0',
    downloadUrl: '',
    updateMessage: 'A new version of CampusCare is available.',
    bannerMessage: '',
    bannerSeverity: 'info',
  },
  safeWalk: {
    enabled: true,
    graceMinutes: 10,
    notifySecurityOnEscalation: true,
  },
  locationSharing: {
    enabled: true,
    maxDurationMinutes: 120,
    retentionHours: 24,
  },
  notifications: {
    emailOnCaseUpdate: true,
    emailOnNewCaseMessage: true,
    emailAppointmentReminders: true,
    reminderHoursBefore: 24,
  },
  retention: {
    notificationsDays: 180,
    communityMessagesDays: 365,
    auditLogDays: 2555,
    closedCaseReviewDays: 1825,
  },
  inboundEmail: {
    enabled: false,
    allowCaseCreation: false,
    allowReplies: true,
  },
  counsellorDirectory: {
    feedbackMinimum: 3,
    showComments: true,
  },
  duty: {
    heartbeatIntervalSeconds: 45,
    staleThresholdSeconds: 120,
    allowDutyWithoutShift: false,
    shiftStartGraceMinutes: 15,
    responderLocationSharing: true,
    notifySupervisorsOnStale: true,
  },
  dispatch: {
    autoAssign: true,
    policy: 'single',
    groupSize: 2,
    ackDeadlineSeconds: 60,
    maxAttempts: 4,
    maxActiveAssignmentsPerResponder: 1,
    allowBusyResponders: false,
    trustedLocationAccuracyMeters: 100,
    proximityBandMeters: 250,
    requiredSkills: [],
    preferredSkills: ['first_aid'],
    unassignedRetrySeconds: 30,
  },
  chatGovernance: {
    privateReviewEnabled: true,
    maxReviewMinutes: 30,
    requireCaseReference: true,
    allowExport: false,
  },
};

/** Validated bounds for duty and dispatch settings (enforced on the server, shown in the console). */
export const DUTY_LIMITS = {
  heartbeatIntervalSeconds: { min: 15, max: 300 },
  staleThresholdSeconds: { min: 60, max: 1800 },
  ackDeadlineSeconds: { min: 15, max: 600 },
  maxAttempts: { min: 1, max: 10 },
  groupSize: { min: 1, max: 5 },
  maxActiveAssignmentsPerResponder: { min: 1, max: 5 },
  maxReviewMinutes: { min: 5, max: 240 },
} as const;

/** Settings that are safe to send to any signed-in client (no internal policy detail). */
export interface PublicSettings {
  platformName: string;
  universityName: string;
  registrationOpen: boolean;
  turnstile: { enabled: boolean; siteKey: string | null; forms: PlatformSettings['turnstile']['forms'] };
  googleSignInEnabled: boolean;
  anonymousReportingEnabled: boolean;
  anonymousCategories: string[];
  chatMedia: PlatformSettings['chat']['media'];
  maxImageMb: number;
  maxVideoMb: number;
  communityEnabled: boolean;
  sos: { enabled: boolean; countdownSeconds: number; allowCancelAfterSend: boolean; quickTriggerEnabled: boolean; quickTriggerMessage: string };
  safeWalkEnabled: boolean;
  map: PlatformSettings['map'];
  community: PlatformSettings['community'];
  mobile: PlatformSettings['mobile'];
  maintenanceMode: boolean;
  supportEmail: string;
  accountEmailDomain: string;
  locationSharingEnabled: boolean;
  maxLocationShareMinutes: number;
  evidenceMaxMb: number;
  evidenceMaxFiles: number;
  passwordMinLength: number;
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue; // ignore unknown keys
    const current = out[k];
    if (current && typeof current === 'object' && !Array.isArray(current) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(current, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}
