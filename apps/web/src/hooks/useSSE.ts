// ─────────────────────────────────────────────
// Server-Sent Events hook for live updates
// ─────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type SSEStatus = 'connecting' | 'connected' | 'disconnected';

export function useSSE() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SSEStatus>('connecting');
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let retryDelay = 2000;

    function connect() {
      const es = new EventSource('/api/stream', { withCredentials: true });
      esRef.current = es;
      setStatus('connecting');

      es.onopen = () => {
        setStatus('connected');
        retryDelay = 2000; // reset on success
      };

      es.addEventListener('change', (e: MessageEvent) => {
        try {
          const msg: { merchantId: string; paymentId: string } = JSON.parse(e.data);
          // Invalidate the specific payment and the list
          qc.invalidateQueries({ queryKey: ['payments', msg.paymentId] });
          qc.invalidateQueries({ queryKey: ['payments'] });
          qc.invalidateQueries({ queryKey: ['events'] });
        } catch { /* ignore malformed */ }
      });

      es.onerror = () => {
        setStatus('disconnected');
        es.close();
        retryRef.current = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 30_000);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [qc]);

  return status;
}
