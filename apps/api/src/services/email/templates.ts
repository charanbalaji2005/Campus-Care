/** Default email templates. Super Admins can override subject/html/text per key; variables use {{name}}. */
export const TEMPLATE_KEYS = [
  'verify_email',
  'password_reset',
  'password_changed',
  'staff_invite',
  'security_alert',
  'case_acknowledged',
  'case_updated',
  'case_message',
  'appointment_update',
  'appointment_reminder',
  'campus_alert',
  'sos_alert',
  'safe_walk_overdue',
  'trusted_contact_consent',
  'sos_trusted_contact',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const layout = (body: string) => `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#334155">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #E2E8F0">
<tr><td style="background:#064E3B;border-radius:16px 16px 0 0;padding:20px 28px;color:#fff;font-size:18px;font-weight:700">{{platformName}}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:16px 28px;font-size:12px;color:#64748B;border-top:1px solid #E2E8F0">{{universityName}} · In an emergency call 112. Do not reply with sensitive details.</td></tr>
</table></td></tr></table></body></html>`;

const button = (label: string) =>
  `<p><a href="{{link}}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${label}</a></p><p style="font-size:12px;color:#64748B">If the button doesn't work, copy this link: {{link}}</p>`;

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; html: string; text: string }> = {
  verify_email: {
    subject: 'Verify your {{platformName}} email',
    html: layout(`<p>Hi {{name}},</p><p>Confirm your email address to activate your account. This link expires in {{expiresIn}} and can be used once. Opening the link does not verify your account until you tap <strong>Verify my email</strong> on the page that opens.</p>${button('Verify email')}<p>If you didn't create a CampusCare account, you can ignore this email.</p>`),
    text: 'Hi {{name}},\n\nVerify your email: {{link}}\n\nThis link expires in {{expiresIn}} and can be used once. If you did not create an account, ignore this email.',
  },
  password_reset: {
    subject: 'Reset your {{platformName}} password',
    html: layout(`<p>Hi {{name}},</p><p>We received a request to reset your password. The link expires in {{expiresIn}} and can be used once. If you didn't ask for this, you can ignore this email; your password will not change.</p>${button('Reset password')}`),
    text: 'Hi {{name}},\n\nReset your password: {{link}}\n\nThe link expires in {{expiresIn}} and can be used once. If you did not request this, ignore this email.',
  },
  password_changed: {
    subject: 'Your {{platformName}} password was changed',
    html: layout('<p>Hi {{name}},</p><p>Your password was just changed and other sessions were signed out. If this wasn\'t you, reset your password immediately and contact {{supportEmail}}.</p>'),
    text: 'Hi {{name}},\n\nYour password was changed. If this was not you, reset it now and contact {{supportEmail}}.',
  },
  staff_invite: {
    subject: "You've been invited to {{platformName}}",
    html: layout(`<p>Hi {{name}},</p><p>You have been invited to {{platformName}} as <b>{{role}}</b>. Set your password to activate your account. The link expires in 7 days.</p>${button('Accept invitation')}`),
    text: 'Hi {{name}},\n\nYou have been invited as {{role}}. Accept: {{link}}',
  },
  security_alert: {
    subject: '{{platformName}} security notice',
    html: layout('<p>Hi {{name}},</p><p>{{message}}</p><p>If this wasn\'t you, change your password and contact {{supportEmail}}.</p>'),
    text: 'Hi {{name}},\n\n{{message}}\n\nIf this was not you, change your password.',
  },
  case_acknowledged: {
    subject: 'We received your report {{caseNumber}}',
    html: layout(`<p>Your report <b>{{caseNumber}}</b> has been received and routed to the responsible team. You can follow its progress and message the case handlers in the app.</p>${button('View case')}`),
    text: 'Your report {{caseNumber}} has been received. Track it here: {{link}}',
  },
  case_updated: {
    subject: 'Update on case {{caseNumber}}',
    html: layout(`<p>There is an update on case <b>{{caseNumber}}</b>: status is now <b>{{status}}</b>. Sign in to see the details.</p>${button('View case')}`),
    text: 'Case {{caseNumber}} is now {{status}}. Details: {{link}}',
  },
  case_message: {
    subject: 'New message on case {{caseNumber}}',
    html: layout(`<p>You have a new message on case <b>{{caseNumber}}</b>. For your privacy the message is only shown in the app.</p>${button('Open conversation')}`),
    text: 'New message on case {{caseNumber}}. Open: {{link}}',
  },
  appointment_update: {
    subject: 'Your counselling appointment: {{status}}',
    html: layout(`<p>Hi {{name}},</p><p>Your appointment on <b>{{when}}</b> is now <b>{{status}}</b>.</p>${button('View appointment')}`),
    text: 'Your appointment on {{when}} is now {{status}}. {{link}}',
  },
  appointment_reminder: {
    subject: 'Reminder: appointment on {{when}}',
    html: layout(`<p>Hi {{name}},</p><p>This is a reminder of your appointment on <b>{{when}}</b>.</p>${button('View appointment')}`),
    text: 'Reminder: your appointment is on {{when}}. {{link}}',
  },
  campus_alert: {
    subject: '[{{severity}}] {{title}}',
    html: layout('<p><b>{{title}}</b></p><p>{{message}}</p>'),
    text: '{{title}}\n\n{{message}}',
  },
  sos_alert: {
    subject: 'SOS {{alertNumber}} — immediate attention needed',
    html: layout(`<p><b>An SOS alert was raised at {{time}}.</b></p><p>Student: {{studentName}}<br/>Location: {{locationText}}</p><p>Open the responder dashboard to acknowledge.</p>${button('Open responder dashboard')}`),
    text: 'SOS {{alertNumber}} at {{time}}. Student: {{studentName}}. Location: {{locationText}}. Respond: {{link}}',
  },
  safe_walk_overdue: {
    subject: '{{studentName}} has not checked in',
    html: layout('<p>{{studentName}} started a Safe Walk to <b>{{destination}}</b> and expected to arrive by {{expected}}, but has not checked in. Please try to contact them. If you believe they are in danger, call 112.</p>'),
    text: '{{studentName}} has not checked in from a Safe Walk to {{destination}} (expected {{expected}}). Try to contact them; call 112 if they may be in danger.',
  },
  sos_trusted_contact: {
    subject: 'Emergency alert from {{studentName}}',
    html: layout('<p>Hi {{name}},</p><p><b>{{studentName}} raised an emergency SOS at {{time}}.</b> Campus Security has been alerted.</p><p>Location: {{locationText}}</p><p>Please try to contact them. If you believe they are in immediate danger, call 112.</p>'),
    text: 'Hi {{name}}, {{studentName}} raised an emergency SOS at {{time}}. Campus Security has been alerted. Location: {{locationText}}. Try to contact them; call 112 if they may be in immediate danger.',
  },
  trusted_contact_consent: {
    subject: '{{studentName}} added you as a trusted contact',
    html: layout(`<p>Hi {{name}},</p><p>{{studentName}} would like to add you as a trusted contact on {{platformName}}. If you agree, you may receive safety notifications (for example a missed Safe Walk check-in). You can decline.</p>${button('Review request')}`),
    text: '{{studentName}} added you as a trusted contact. Review: {{link}}',
  },
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Variables are HTML-escaped in HTML output to prevent injection via names or titles. */
export function renderTemplate(tpl: { subject: string; html: string; text: string }, vars: Record<string, string>) {
  const fill = (s: string, escape: boolean) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k] ?? '';
    return escape ? escapeHtml(v) : v;
  });
  return { subject: fill(tpl.subject, false).replace(/[\r\n]+/g, ' '), html: fill(tpl.html, true), text: fill(tpl.text, false) };
}
