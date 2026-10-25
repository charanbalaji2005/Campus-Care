import type { MediaScope } from './enums';
import type { PlatformSettings } from './settings';

export type MediaKind = 'image' | 'video' | 'document';

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export function mediaKindOf(mime: string): MediaKind | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return 'image';
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(mime)) return 'video';
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)) return 'document';
  return null;
}

export type MediaDecision = { allowed: true; kind: MediaKind; maxBytes: number } | { allowed: false; reason: string };

/**
 * Decides whether a chat attachment may be sent. Images and videos are only allowed
 * when the Super Admin has switched them on for that chat type (they are off by default).
 * The same function is used by the API (enforcement) and the web app (to hide the button).
 */
export function chatMediaDecision(settings: Pick<PlatformSettings, 'chat'>, scope: MediaScope, mime: string, sizeBytes?: number): MediaDecision {
  const kind = mediaKindOf(mime);
  if (kind !== 'image' && kind !== 'video') {
    return { allowed: false, reason: 'Only images and videos can be sent in chat.' };
  }
  const policy = settings.chat.media[scope];
  if (!policy) return { allowed: false, reason: 'Media sharing is not available here.' };
  if (kind === 'image' && !policy.images) return { allowed: false, reason: 'Image sending is turned off by your administrator.' };
  if (kind === 'video' && !policy.videos) return { allowed: false, reason: 'Video sending is turned off by your administrator.' };
  const maxBytes = (kind === 'image' ? settings.chat.maxImageMb : settings.chat.maxVideoMb) * 1024 * 1024;
  if (sizeBytes !== undefined && sizeBytes > maxBytes) {
    return { allowed: false, reason: `This ${kind} is larger than ${kind === 'image' ? settings.chat.maxImageMb : settings.chat.maxVideoMb} MB.` };
  }
  return { allowed: true, kind, maxBytes };
}

export function acceptAttributeFor(policy: { images: boolean; videos: boolean }): string {
  return [...(policy.images ? IMAGE_MIME_TYPES : []), ...(policy.videos ? VIDEO_MIME_TYPES : [])].join(',');
}
