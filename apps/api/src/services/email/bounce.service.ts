import tls from 'node:tls';
import { logger } from '../../lib/logger';

/**
 * Bounce tracking for Gmail / Google Workspace SMTP. Gmail accepts a message first and reports a
 * missing mailbox ("550 5.1.1 … does not exist") later, as a Delivery Status Notification in the
 * sending account's inbox. That notice is the only bounce record Gmail offers, so it is read here.
 *
 * Read-only by construction: the mailbox is opened with EXAMINE and messages are fetched with
 * BODY.PEEK, so nothing is marked read, moved or deleted. Only mailer-daemon notices are fetched, and
 * only the failed address, status code and diagnostic line are kept (never message bodies).
 */

export interface BounceNotice {
  /** Address that could not be delivered to (lower-case). */
  recipient: string;
  /** Enhanced status code, e.g. "5.1.1". */
  status: string;
  /** Sanitised diagnostic line, e.g. "550 5.1.1 The email account that you tried to reach does not exist." */
  diagnostic: string;
  /** Message-ID of the original message, when the notice includes its headers. */
  originalMessageId: string | null;
  /** Permanent (5.x.x) failures; 4.x.x notices are only delays. */
  permanent: boolean;
  receivedAt: Date | null;
}

/** Parses one raw DSN message. Returns null if it is not a delivery failure notice. */
export function parseBounce(raw: string): BounceNotice | null {
  const text = raw.replace(/\r\n/g, '\n');
  const header = (name: string) => text.match(new RegExp(`^${name}:\\s*(.+(?:\\n[ \\t].+)*)`, 'im'))?.[1]?.replace(/\n[ \t]+/g, ' ').trim() ?? null;
  const recipient = (header('Final-Recipient') ?? header('Original-Recipient') ?? header('X-Failed-Recipients'))
    ?.replace(/^rfc822;\s*/i, '').replace(/[<>]/g, '').trim().toLowerCase();
  const status = header('Status')?.match(/[245]\.\d{1,3}\.\d{1,3}/)?.[0] ?? null;
  if (!recipient || !recipient.includes('@') || !status) return null;
  const diag = (header('Diagnostic-Code') ?? '').replace(/^smtp;\s*/i, '').replace(/(\d{3})-(\d\.\d+\.\d+)/g, '$1 $2').replace(/\s+/g, ' ');
  // The original message's headers follow the status part; its Message-ID is the last one in the notice.
  const ids = [...text.matchAll(/^Message-ID:\s*(<[^>\s]+>)/gim)].map((m) => m[1]!);
  const date = header('Arrival-Date') ?? header('Date');
  return {
    recipient,
    status,
    diagnostic: diag.slice(0, 200) || `Status ${status}`,
    originalMessageId: ids.length > 1 ? ids[ids.length - 1]! : null,
    permanent: status.startsWith('5'),
    receivedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null,
  };
}

/** Minimal IMAP client (enough for LOGIN, EXAMINE, UID SEARCH, UID FETCH, LOGOUT), with literal support. */
class Imap {
  private buf = Buffer.alloc(0);
  private waiting: { tag: string; resolve: (r: { text: string; literals: Buffer[]; ok: boolean }) => void } | null = null;
  private lines: string[] = [];
  private literals: Buffer[] = [];
  private seq = 0;

  private constructor(private sock: tls.TLSSocket) {
    sock.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.drain();
    });
  }

  static connect(host: string, timeoutMs: number): Promise<Imap> {
    return new Promise((resolve, reject) => {
      const sock = tls.connect(993, host, { servername: host });
      sock.setTimeout(timeoutMs, () => sock.destroy(new Error('IMAP timeout')));
      sock.once('error', reject);
      const c = new Imap(sock);
      c.waiting = { tag: '*', resolve: () => resolve(c) }; // greeting
    });
  }

  private drain() {
    for (;;) {
      const eol = this.buf.indexOf('\r\n');
      if (eol < 0) return;
      const line = this.buf.subarray(0, eol).toString('utf8');
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        const n = Number(lit[1]);
        if (this.buf.length < eol + 2 + n) return; // wait for the whole literal
        this.literals.push(Buffer.from(this.buf.subarray(eol + 2, eol + 2 + n)));
        this.lines.push(line);
        this.buf = this.buf.subarray(eol + 2 + n);
        continue;
      }
      this.buf = this.buf.subarray(eol + 2);
      this.lines.push(line);
      const w = this.waiting;
      if (!w) continue;
      const done = w.tag === '*' ? line.startsWith('* OK') : line.startsWith(`${w.tag} `);
      if (done) {
        const result = { text: this.lines.join('\n'), literals: this.literals, ok: w.tag === '*' || line.startsWith(`${w.tag} OK`) };
        this.lines = [];
        this.literals = [];
        this.waiting = null;
        w.resolve(result);
      }
    }
  }

  cmd(command: string): Promise<{ text: string; literals: Buffer[]; ok: boolean }> {
    const tag = `c${++this.seq}`;
    return new Promise((resolve) => {
      this.waiting = { tag, resolve };
      this.sock.write(`${tag} ${command}\r\n`);
    });
  }

  close() {
    this.sock.end();
  }
}

const quote = (s: string) => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;
const imapDate = (d: Date) => `${d.getUTCDate()}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}-${d.getUTCFullYear()}`;

/**
 * Reads recent delivery-failure notices from a Gmail mailbox (read-only). Throws with a sanitised
 * message if the mailbox cannot be opened (e.g. IMAP disabled for the account).
 */
export async function fetchGmailBounces(user: string, pass: string, opts: { sinceDays?: number; max?: number; host?: string; timeoutMs?: number } = {}): Promise<BounceNotice[]> {
  const imap = await Imap.connect(opts.host ?? 'imap.gmail.com', opts.timeoutMs ?? 20_000);
  try {
    const login = await imap.cmd(`LOGIN ${quote(user)} ${quote(pass.replace(/\s/g, ''))}`);
    if (!login.ok) throw new Error('IMAP sign-in refused (enable IMAP for this Gmail account; the app password is shared with SMTP)');
    const box = await imap.cmd('EXAMINE INBOX'); // read-only
    if (!box.ok) throw new Error('Could not open the inbox read-only');
    const since = imapDate(new Date(Date.now() - (opts.sinceDays ?? 7) * 86400_000));
    const search = await imap.cmd(`UID SEARCH SINCE ${since} FROM "mailer-daemon"`);
    const uids = (search.text.match(/^\* SEARCH ?(.*)$/m)?.[1] ?? '').split(' ').filter(Boolean).slice(-(opts.max ?? 50));
    const notices: BounceNotice[] = [];
    for (const uid of uids) {
      const f = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[]<0.65536>)`); // PEEK: never marks it read
      const raw = f.literals[0]?.toString('utf8');
      const n = raw ? parseBounce(raw) : null;
      if (n) notices.push(n);
    }
    await imap.cmd('LOGOUT').catch(() => undefined);
    return notices;
  } finally {
    imap.close();
  }
}

/** Gmail and Google Workspace accounts use the same IMAP host. */
export function supportsGmailBounces(service: string | null | undefined): boolean {
  return !!service && /gmail|google/i.test(service);
}

export function logBounceError(err: unknown) {
  logger.warn({ err: (err as Error).message?.slice(0, 200) }, 'email bounce check failed');
}
