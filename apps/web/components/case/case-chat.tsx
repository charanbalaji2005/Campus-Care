'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { useApi, usePublicSettings } from '@/lib/hooks';
import { ChatThread, type ChatAttachment, type ChatMessageView } from '@/components/chat/chat-thread';

/** Complaint-specific conversation. Every request is authorised by the server for this one case. */
export function CaseChat({ caseId, closed, privacyNote }: { caseId: string; closed: boolean; privacyNote: string }) {
  const { data: settings } = usePublicSettings();
  const { data: readState, mutate } = useApi<{ otherSideLastReadAt: string | null }>(`/incidents/${caseId}/read-state`, { refreshInterval: 20000 });
  const lastSeen = React.useRef<string | null>(null);

  return (
    <ChatThread
      fileKind="case"
      mediaScope="case"
      media={settings?.chatMedia.case}
      limits={settings ? { maxImageMb: settings.maxImageMb, maxVideoMb: settings.maxVideoMb } : undefined}
      room={`case:${caseId}`}
      realtimeEvent="case:message"
      readOnly={closed}
      readOnlyReason="This case is closed, so the conversation is read-only."
      privacyNote={privacyNote}
      emptyText="No messages yet. Use this space to share more details or ask a question about this case."
      load={(cursor) => api.get(`/incidents/${caseId}/messages${cursor ? `?before=${cursor}` : ''}`)}
      send={(input) => api.post<{ message: ChatMessageView }>(`/incidents/${caseId}/messages`, input).then((r) => { void mutate(); return r; })}
      upload={(file) => api.upload<ChatAttachment>(`/incidents/${caseId}/attachments`, file)}
      otherSideLastReadAt={readState?.otherSideLastReadAt}
      onSeen={(id) => {
        if (lastSeen.current === id) return;
        lastSeen.current = id;
        void api.post(`/incidents/${caseId}/read-receipts`, { upToMessageId: id }).catch(() => undefined);
      }}
    />
  );
}
