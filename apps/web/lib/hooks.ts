'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { PublicSettings, Role } from '@campuscare/shared';
import { api, ApiError } from './api';

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, (p: string) => api.get<T>(p), { revalidateOnFocus: true, shouldRetryOnError: false, ...config });
}

export interface Me {
  user: {
    id: string; fullName: string; email: string; emailVerified: boolean; role: Role; permissions: string[]; accountStatus: string;
    studentId: string | null; department: string | null; academicYear: number | null; phone: string | null; hostel: string | null; mfaEnabled: boolean;
    committeeMemberships: { committeeId: string; position: 'chair' | 'member' }[];
    privacy?: { showNameInCommunity: boolean; allowEmailNotifications: boolean };
  };
  session: { mfaVerified: boolean; method: string; expiresAt: string; idleExpiresAt: string };
  mfaRequired: boolean;
  homePath: string;
}

export function useMe() {
  return useApi<Me>('/auth/me', { revalidateOnFocus: true, dedupingInterval: 10_000 });
}

export function usePublicSettings() {
  return useApi<PublicSettings>('/auth/public-settings', { revalidateOnFocus: false, dedupingInterval: 60_000 });
}

// ------------------------------------------------------------------ realtime (Socket.IO, ticket-authenticated)
let socketPromise: Promise<Socket> | null = null;

async function connectSocket(): Promise<Socket> {
  const { io } = await import('socket.io-client');
  const { ticket, path } = await api.post<{ ticket: string; url: string; path: string }>('/auth/realtime-ticket');
  const url = process.env.NEXT_PUBLIC_REALTIME_URL || window.location.origin;
  const socket = io(url, { path, auth: { ticket }, transports: ['websocket'], reconnection: true });
  // Each reconnect needs a fresh single-use ticket.
  socket.io.on('reconnect_attempt', async () => {
    try {
      const t = await api.post<{ ticket: string }>('/auth/realtime-ticket');
      socket.auth = { ticket: t.ticket };
    } catch {
      /* signed out */
    }
  });
  return socket;
}

export function getSocket() {
  socketPromise ??= connectSocket().catch((e) => {
    socketPromise = null;
    throw e;
  });
  return socketPromise;
}

/** Subscribes to a server-authorised room and listens to events; falls back silently if realtime is unavailable. */
export function useRealtime(room: string | null, events: Record<string, (payload: unknown) => void>) {
  const handlers = useRef(events);
  handlers.current = events;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!room) return;
    let socket: Socket | null = null;
    let cancelled = false;
    const bound: [string, (p: unknown) => void][] = [];
    getSocket()
      .then((s) => {
        if (cancelled) return;
        socket = s;
        const subscribe = () => s.emit('subscribe', { room }, (r: { ok: boolean }) => setConnected(Boolean(r?.ok)));
        subscribe();
        s.on('connect', subscribe);
        bound.push(['connect', subscribe]);
        for (const name of Object.keys(handlers.current)) {
          const fn = (p: unknown) => handlers.current[name]?.(p);
          s.on(name, fn);
          bound.push([name, fn]);
        }
      })
      .catch(() => setConnected(false));
    return () => {
      cancelled = true;
      if (socket) {
        socket.emit('unsubscribe', { room });
        bound.forEach(([n, f]) => socket!.off(n, f));
      }
    };
  }, [room]);
  return connected;
}

/** User-level notifications channel (joined automatically by the server). */
export function useUserEvents(events: Record<string, (payload: unknown) => void>) {
  const handlers = useRef(events);
  handlers.current = events;
  useEffect(() => {
    let socket: Socket | null = null;
    const bound: [string, (p: unknown) => void][] = [];
    getSocket()
      .then((s) => {
        socket = s;
        for (const name of Object.keys(handlers.current)) {
          const fn = (p: unknown) => handlers.current[name]?.(p);
          s.on(name, fn);
          bound.push([name, fn]);
        }
      })
      .catch(() => undefined);
    return () => { if (socket) bound.forEach(([n, f]) => socket!.off(n, f)); };
  }, []);
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
