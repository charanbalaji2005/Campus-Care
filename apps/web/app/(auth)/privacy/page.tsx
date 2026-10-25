import Link from 'next/link';

export const metadata = { title: 'Privacy' };

/** Plain-language summary. The university must review and replace this with its approved privacy notice. */
export default function PrivacyPage() {
  const sections: [string, string][] = [
    ['What we collect', 'Your name, university email, student ID, department and year; optional phone number; reports you submit and their attachments; counselling appointment requests; messages you send; and, only when you choose, your location.'],
    ['Who can see your reports', 'Only staff formally authorised to handle that type of case — for example the Anti-Ragging Committee for ragging reports. General administrators see routing information, not your description. Other students never see your reports.'],
    ['Anonymous reports', 'Where university policy allows, your name is hidden from case handlers. CampusCare keeps a protected, pseudonymous link so only you can follow and reply to the case. Details you write or attach may still identify you — think about this before sharing.'],
    ['Counselling', 'Counselling notes are stored separately from complaints and can only be read by your counsellor (or a professional with a specific, recorded authorisation). Administrators see only anonymous totals.'],
    ['Location', 'Location is used only when you share it — for an SOS alert or time-limited live sharing — and is automatically deleted after the retention period.'],
    ['Security', 'Data is encrypted in transit; passwords are hashed with Argon2id; sensitive access is recorded in a tamper-evident audit log.'],
    ['Your choices', 'You can update your profile, control community name display and email notifications, manage trusted contacts and stop location sharing at any time from your Privacy Centre.'],
  ];
  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-sm font-semibold text-brand-700">← Back</Link>
      <h1 className="page-title mt-4">Privacy notice (summary)</h1>
      <p className="mt-2 text-sm text-ink-soft">This summary is provided by the CampusCare software. Your university’s approved privacy notice and applicable law take precedence.</p>
      <div className="mt-8 space-y-6">
        {sections.map(([h, b]) => (
          <section key={h} className="card p-5">
            <h2 className="font-semibold">{h}</h2>
            <p className="mt-2 text-sm leading-relaxed">{b}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
