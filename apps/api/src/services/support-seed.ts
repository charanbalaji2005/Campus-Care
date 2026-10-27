import { FaqArticle } from '../models/support';
import { logger } from '../lib/logger';

export const INITIAL_FAQ_ARTICLES = [
  {
    title: 'Account Registration & University Email Verification',
    slug: 'account-registration-email-verification',
    category: 'account_verification',
    summary: 'How to register for CampusCare using your official @srmap.edu.in university address and verify your inbox.',
    content: `CampusCare requires an official SRM University-AP email address (@srmap.edu.in) for all student accounts.

### Step-by-Step Registration:
1. Open CampusCare and select **Create Account**.
2. Enter your full legal name as recorded on your university registration.
3. Enter your student email address ending with \`@srmap.edu.in\` (e.g. \`student_name@srmap.edu.in\`).
4. Set a strong password with at least 10 characters, including uppercase, lowercase, and numbers.
5. Solve the Cloudflare Turnstile human security verification challenge.
6. Submit the form. A 6-digit verification code will be dispatched to your university inbox immediately.
7. Enter the 6-digit code in CampusCare within 15 minutes to verify your account.

> Note: If you do not see the verification email, check your Outlook **Junk** or **Spam** folder. Ensure your university inbox is not full.`,
    instructions: [
      'Enter your @srmap.edu.in university email',
      'Choose a secure password (min 10 characters with upper, lower, numbers)',
      'Complete Cloudflare Turnstile verification',
      'Enter the 6-digit OTP code received in your Outlook inbox',
    ],
    status: 'published',
  },
  {
    title: 'Manual Student Verification & Status Review',
    slug: 'manual-student-verification-status',
    category: 'account_verification',
    summary: 'What to do if your student account requires manual verification by campus administrators.',
    content: `Some student accounts are marked for manual verification to verify enrollment credentials, department, and academic year.

### When is manual verification required?
- If your university email was recently provisioned by campus IT.
- If automated directory verification could not confirm your active enrollment status.
- If you were asked to upload your Student ID Card or admission slip for verification.

### What administrators review:
- Valid Student ID card image with legible student roll number and barcode.
- Department, course (B.Tech, B.Sc, M.Tech, etc.), and academic year matching student registry.
- Clear headshot photograph matching university records.

Verification requests are typically processed within **1 business day** by Campus Administration. You will receive an in-app notification once your account is verified.`,
    instructions: [
      'Navigate to Profile > Student Verification',
      'Upload a clear photograph of your SRM University-AP Student ID Card',
      'Confirm your Department and Academic Year',
      'Campus Admins will review and activate full verified student access within 24 hours',
    ],
    status: 'published',
  },
  {
    title: 'Login, Password Reset & Account Recovery',
    slug: 'login-password-reset-account-recovery',
    category: 'login_password',
    summary: 'Recover your password if locked out, troubleshoot Turnstile challenges, and manage recovery codes.',
    content: `If you forget your password or suspect unauthorized access to your account, you can reset your password securely at any time.

### Resetting Your Password:
1. On the CampusCare login screen, tap **Forgot Password?**.
2. Enter your registered \`@srmap.edu.in\` address.
3. Complete the security Turnstile verification.
4. Tap **Send Reset Link**. A secure single-use password reset link will arrive in your university email.
5. Click the link and enter your new password. All existing mobile and web sessions will be invalidated for security.

### Account Lockout Protection:
- For your safety, 5 consecutive failed login attempts will trigger a 15-minute cooldown.
- If you have Two-Factor Authenticator (TOTP) enabled and lost your device, use one of your 10-character backup recovery codes generated during setup.`,
    instructions: [
      'Select Forgot Password on the login screen',
      'Enter your @srmap.edu.in email and pass the security check',
      'Check your university inbox for the password reset email',
      'Set a fresh password and log in with your updated credentials',
    ],
    status: 'published',
  },
  {
    title: 'SOS Emergency Response & Quick Activation',
    slug: 'sos-emergency-response-guidance',
    category: 'sos_safety',
    summary: 'How the emergency SOS feature works, responder dispatch timelines, and when to use it.',
    content: `The SOS feature is designed for acute emergencies where you feel unsafe, face immediate danger, or require urgent campus medical or security assistance.

### How SOS Works:
1. Tap the prominent **SOS** button on the home screen or lock-screen emergency shortcut.
2. A 3-second safety countdown begins. If triggered accidentally, tap **Cancel** immediately.
3. Once activated:
   - Your real-time GPS coordinates and profile are immediately dispatched to on-duty Campus Security Officers and Supervisors.
   - The nearest active responder is assigned automatically.
   - A live emergency tracking screen shows the assigned officer's name, call button, and estimated arrival.
   - If an officer does not acknowledge within 2 minutes, the alert escalates to senior duty supervisors.

> **CRITICAL WARNING:** Use SOS ONLY for genuine emergencies. For general campus questions or maintenance requests, use this Support Center instead. If you are in immediate external danger outside campus jurisdiction, contact national emergency services at 112.`,
    instructions: [
      'Tap the SOS button in CampusCare or lock-screen widget',
      'Allow the 3-second countdown to complete or tap Cancel if pressed accidentally',
      'Keep your phone powered on with GPS active',
      'Follow the live instructions and communicate with the responding officer if safe to do so',
    ],
    status: 'published',
  },
  {
    title: 'GPS Permissions & Location Accuracy Guidelines',
    slug: 'gps-permissions-location-accuracy',
    category: 'gps_location',
    summary: 'Why location permissions are needed, privacy safeguards, and ensuring high accuracy on campus.',
    content: `CampusCare only accesses your device location when you actively trigger a safety feature: raising an SOS, starting an active Safe Walk, or sharing location with trusted contacts.

### Does CampusCare track you in the background?
**NO.** CampusCare respects your privacy. When you are simply browsing the app, viewing announcements, or asking support questions, background location tracking is completely disabled.

### Optimizing GPS Accuracy on SRM-AP Campus:
- Set Location Permission to **"While using the app"** or **"Allow all the time"** (required for continuous Safe Walk escort).
- Enable **Precise Location** (Google Location Accuracy) in Android Settings > Location.
- Ensure Wi-Fi scanning is enabled, which helps pinpoint campus building floors and indoor zones (e.g., Admin Block, Neeraja Hostel, Paari Hostel).`,
    instructions: [
      'Go to Android Settings > Apps > CampusCare > Permissions',
      'Grant Location permission with "Precise Location" enabled',
      'Turn on Wi-Fi and Bluetooth scanning for indoor positioning',
    ],
    status: 'published',
  },
  {
    title: 'Incident & Complaint Reporting Process',
    slug: 'incident-complaint-reporting-process',
    category: 'incidents_complaints',
    summary: 'How to file confidential or anonymous incident reports, committee routing, and tracking.',
    content: `Students can report campus safety concerns, harassment, ragging, infrastructure hazards, and violations through the formal Incident Reporting system.

### Reporting Options:
- **Identified Report:** Your name and student details are visible only to the authorized investigating committee (e.g. Internal Complaints Committee, Anti-Ragging Committee).
- **Anonymous Report:** Your identity is cryptographically concealed from all handlers and administrators. You receive a unique case tracking PIN to check progress without disclosing your personal details.

### What Happens After Submission:
1. Automated AI classification suggests the appropriate committee and priority.
2. The authorized committee acknowledges receipt within 24 hours.
3. You can exchange secure messages with the handling officer directly through the case chat.
4. When resolved, you receive a full outcome summary and can appeal or reopen within 14 days if unsatisfied.`,
    instructions: [
      'Go to the Incidents tab and tap Report an Incident',
      'Select category (e.g. Ragging, Harassment, Infrastructure, Lost Item)',
      'Choose whether to report with your identity or Anonymously',
      'Provide location, description, and optional photo evidence',
      'Submit and monitor case updates in My Reports',
    ],
    status: 'published',
  },
  {
    title: 'Safe Walk: Virtual Campus Escort & ETA Tracking',
    slug: 'safe-walk-virtual-escort-tracking',
    category: 'safe_walk',
    summary: 'Stay connected with trusted campus peers or duty security while walking late at night.',
    content: `Safe Walk provides peace of mind when travelling across campus after dark, between academic blocks, libraries, and hostels.

### Safe Walk Features:
- **Set Destination & Estimated Time:** Choose your destination on campus (e.g. Central Library to Hostel Block 4) and your estimated walking duration.
- **Trusted Circle Sharing:** Select up to 3 trusted campus contacts who receive a secure link to follow your progress on a live map.
- **Safety Check-in Timer:** If you do not tap "I Have Arrived Safely" within 5 minutes after your expected ETA, CampusCare prompts you to check in.
- **Auto-Escalation:** If you do not respond to the safety prompt, an alert is automatically dispatched to the Security Control Room with your last known coordinates.`,
    instructions: [
      'Open Safe Walk from the Home or Safety menu',
      'Select your starting point, campus destination, and estimated minutes',
      'Pick trusted friends to share your journey with',
      'Tap Start Walk and tap "Arrived Safely" when you reach your destination',
    ],
    status: 'published',
  },
  {
    title: 'Counselling Appointments & Medical Confidentiality',
    slug: 'counselling-appointments-confidentiality',
    category: 'counselling_appointments',
    summary: 'Book private sessions with university psychologists and understand confidentiality boundaries.',
    content: `SRM University-AP provides licensed, professional psychological counselling to assist students with stress, anxiety, academic pressure, relationships, and well-being.

### Strict Confidentiality Guarantee:
- Counselling records, session notes, and appointments are stored in a dedicated, isolated clinical enclave.
- **Super Admins, Campus Admins, Security Officers, and Professors CANNOT read counselling notes or conversation history.**
- Only your assigned licensed counsellor has access to your clinical notes.

### How to Book an Appointment:
1. Tap **Counselling** in the app navigation.
2. Choose your preferred session mode: **In-Person** at the Campus Wellness Center, or **Private Video Call**.
3. Select an available date, time slot, and your preferred counsellor.
4. Confirm your booking. You will receive private reminder notifications before your scheduled session.`,
    instructions: [
      'Tap Counselling on the bottom navigation or Safety tab',
      'Select In-Person or Video Consultation mode',
      'Choose an available date and time slot from the counsellor calendar',
      'Add optional private notes for your counsellor and tap Confirm Booking',
    ],
    status: 'published',
  },
  {
    title: 'Community Guidelines & Safe Discussion Rules',
    slug: 'community-guidelines-reporting-content',
    category: 'community',
    summary: 'Rules for posting in campus discussion channels, moderation standards, and reporting content.',
    content: `CampusCare community channels are designed to foster a safe, supportive, and respectful campus environment for all SRM University-AP students and staff.

### Community Standards:
- **Respect and Civility:** Treat all campus community members with dignity. Hate speech, discrimination, harassment, bullying, and intimidation are strictly prohibited.
- **Academic Integrity:** Do not post exam answers, unauthorized assignment solutions, or faculty materials.
- **No Spam or Unauthorized Commercial Ads:** Commercial promotions, unauthorized ticket sales, or referral links are not permitted.
- **Official Broadcasts:** Official channels (e.g., #announcements, #safety-notices) are read-only and reserved for verified campus authority alerts.

### Reporting Inappropriate Content:
If you encounter a post or message that violates community guidelines:
1. Long-press or tap the options menu on the message/post.
2. Select **Report Content**.
3. Choose a reason (Harassment, Inappropriate Language, Spam, Safety Hazard).
4. Our student and staff moderators review reported content within 2 hours. Violating content is removed immediately.`,
    instructions: [
      'Review university community standards before posting',
      'Maintain respectful, constructive discussions in student channels',
      'Use the Report Content button to alert moderators to harmful messages',
    ],
    status: 'published',
  },
  {
    title: 'Notifications & Device Permissions Management',
    slug: 'notifications-permissions-management',
    category: 'notifications',
    summary: 'Configure push alerts, quiet hours, and ensure critical emergency broadcasts are never missed.',
    content: `CampusCare uses notifications to deliver urgent safety alerts, support ticket updates, and campus announcements.

### Notification Categories:
- **Critical Safety Alerts (SOS & Campus Emergencies):** These alerts bypass "Do Not Disturb" and silent modes on supported Android devices so you are never caught unaware during severe weather or campus lockdowns.
- **Support & Ticket Updates:** In-app and push notifications when a Campus Admin replies to your question or changes your ticket status.
- **Community & Events:** Announcements regarding campus workshops, student council activities, and cultural events. You can customize frequency or mute these in Profile > Notification Preferences.

### Troubleshooting Missing Notifications:
- Check that Battery Optimization is disabled for CampusCare in Android Settings > Battery > Unrestricted.
- Confirm Notifications are set to **Allow** in Android App Info.`,
    instructions: [
      'Navigate to Profile > Notifications in CampusCare',
      'Customize preferences for community and event notifications',
      'Keep Critical Safety Alerts enabled for campus emergency broadcasts',
    ],
    status: 'published',
  },
  {
    title: 'Privacy, Data Protection & Account Troubleshooting',
    slug: 'privacy-data-protection-troubleshooting',
    category: 'other',
    summary: 'How your data is protected, requesting data exports, and troubleshooting technical issues.',
    content: `CampusCare adheres to strict student privacy and data security principles.

### Key Privacy Protections:
- **Zero-Trust Access Control:** Only authorized personnel with explicit need can access operational data.
- **End-to-End Audit Trail:** Every administrative action, ticket assignment, and record inspection is permanently logged in an immutable audit ledger.
- **No Third-Party Advertising:** CampusCare is an internal university safety tool and never sells, licenses, or shares student data with external commercial advertisers.

### Exporting or Deleting Your Data:
You have the right to request a complete archive of your CampusCare activity. Go to **Profile > Privacy & Data > Request Data Export**. A download link will be prepared and sent to your verified university email.

### General App Troubleshooting:
- If screens fail to load, verify your Wi-Fi or mobile data connectivity.
- Clear app cache in Android Settings > Apps > CampusCare > Storage > Clear Cache.
- Ensure you are running the latest version of the CampusCare APK.`,
    instructions: [
      'Review your privacy settings under Profile > Privacy & Data',
      'Export your activity data at any time via the Data Export tool',
      'Clear app cache if you experience persistent display issues',
      'Contact Campus Support if you require technical troubleshooting assistance',
    ],
    status: 'published',
  },
];

export async function seedFaqArticlesIfEmpty() {
  try {
    const count = await FaqArticle.countDocuments();
    if (count > 0) {
      return;
    }
    logger.info('Knowledge Base is empty. Pre-seeding 11 core university FAQ articles...');
    for (const article of INITIAL_FAQ_ARTICLES) {
      await FaqArticle.create({
        ...article,
        views: Math.floor(Math.random() * 50) + 10,
        helpfulCount: Math.floor(Math.random() * 20) + 5,
        unhelpfulCount: 0,
      });
    }
    logger.info('Knowledge Base successfully seeded with 11 core articles.');
  } catch (err) {
    logger.error({ err }, 'Failed to seed FAQ articles');
  }
}
