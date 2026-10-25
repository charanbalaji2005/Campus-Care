import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { chatMediaDecision, mediaKindOf, type MediaScope } from '@campuscare/shared';
import { AppError, badRequest } from '../lib/http';
import { safeFileName, sniffMime } from '../lib/sniff';
import { Evidence, type EvidenceDoc } from '../models/incident';
import { storage } from './storage.service';
import { getSettings } from './settings.service';

export type UploadPurpose = 'evidence' | 'case_chat' | 'chat' | 'lost_found';

/**
 * Validates and stores an uploaded file. The real type comes from the file's bytes,
 * not the browser. Chat media obeys the Super Admin media switches (off by default).
 */
export async function storeUpload(
  file: Express.Multer.File | undefined,
  opts: { purpose: UploadPurpose; uploaderId: string | null; uploaderTag?: string | null; mediaScope?: MediaScope; incidentId?: string | null; channelId?: string | null },
): Promise<EvidenceDoc> {
  if (!file) throw badRequest('Choose a file to upload.');
  const sniffed = sniffMime(file.buffer);
  if (!sniffed) throw new AppError(415, 'unsupported_type', 'This file type is not supported. Use JPG, PNG, WEBP, GIF, PDF, MP4, WEBM or MOV.');
  const settings = await getSettings();

  if (opts.purpose === 'evidence') {
    const kind = mediaKindOf(sniffed);
    if (kind !== 'image' && kind !== 'document' && kind !== 'video') throw new AppError(415, 'unsupported_type', 'Unsupported evidence type.');
    if (file.size > settings.incidents.evidenceMaxMb * 1024 * 1024) throw new AppError(413, 'too_large', `Evidence files must be ${settings.incidents.evidenceMaxMb} MB or smaller.`);
  } else if (opts.purpose === 'lost_found') {
    if (mediaKindOf(sniffed) !== 'image') throw new AppError(415, 'unsupported_type', 'Lost & found photos must be JPG, PNG, WEBP or GIF images.');
    if (file.size > 5 * 1024 * 1024) throw new AppError(413, 'too_large', 'Photos must be 5 MB or smaller.');
  } else {
    const decision = chatMediaDecision(settings, opts.mediaScope ?? 'support', sniffed, file.size);
    if (!decision.allowed) throw new AppError(403, 'media_disabled', decision.reason);
  }

  const { key } = await storage.put(file.buffer);
  return Evidence.create({
    purpose: opts.purpose,
    uploaderId: opts.uploaderId,
    uploaderTag: opts.uploaderTag ?? null,
    incidentId: opts.incidentId ?? null,
    channelId: opts.channelId ?? null,
    storageKey: key,
    originalName: safeFileName(file.originalname),
    mimeType: sniffed,
    sizeBytes: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    scanStatus: 'not_scanned',
  });
}

/**
 * Claims previously uploaded files for a message/case. Only the uploader's own,
 * still-unbound files from the same context can be attached.
 */
export async function bindUploads(ids: string[], match: { uploaderId?: string | null; uploaderTag?: string | null; purpose: UploadPurpose; incidentId?: string; channelId?: string }) {
  if (!ids.length) return [];
  const filter: Record<string, unknown> = { _id: { $in: ids }, purpose: match.purpose, bound: false };
  if (match.uploaderId) filter.uploaderId = match.uploaderId;
  if (match.uploaderTag) filter.uploaderTag = match.uploaderTag;
  if (match.incidentId) filter.incidentId = match.incidentId;
  if (match.channelId) filter.channelId = match.channelId;
  const docs = await Evidence.find(filter).select('+uploaderTag');
  if (docs.length !== ids.length) throw badRequest('One or more attachments are invalid or already used.');
  await Evidence.updateMany({ _id: { $in: docs.map((d) => d._id) } }, { $set: { bound: true, ...(match.incidentId ? { incidentId: match.incidentId } : {}) } });
  return docs;
}

export function attachmentView(e: { _id: unknown; originalName: string; mimeType: string; sizeBytes: number; sha256?: string }) {
  // sha256 lets handlers confirm a file has not changed since it was submitted (evidence integrity).
  return { id: String(e._id), name: e.originalName, mimeType: e.mimeType, sizeBytes: e.sizeBytes, kind: mediaKindOf(e.mimeType), sha256: e.sha256 ?? null };
}

/** Streams a private file after the caller has passed the resource permission check. */
export async function streamFile(res: Response, req: Request, fileId: string, disposition: 'inline' | 'attachment' = 'inline') {
  const doc = await Evidence.findById(fileId).select('+storageKey');
  if (!doc) throw new AppError(404, 'not_found', 'Not found.');
  if (doc.scanStatus === 'infected') throw new AppError(403, 'quarantined', 'This file was quarantined by the malware scanner.');
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Length', String(doc.sizeBytes));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.originalName)}"`);
  const stream = storage.stream(doc.storageKey);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.end();
  });
  stream.pipe(res);
  void req;
}
