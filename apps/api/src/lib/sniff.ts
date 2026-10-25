/**
 * Detects the real file type from magic bytes. The client-provided MIME type is never trusted.
 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const hex = (start: number, len: number) => buf.subarray(start, start + len).toString('hex');
  const ascii = (start: number, len: number) => buf.subarray(start, start + len).toString('latin1');

  if (hex(0, 3) === 'ffd8ff') return 'image/jpeg';
  if (hex(0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (hex(0, 4) === '1a45dfa3') return 'video/webm';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'qt  ') return 'video/quicktime';
    if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV', 'NDAS'].includes(brand)) return 'video/mp4';
    return null;
  }
  return null;
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}
