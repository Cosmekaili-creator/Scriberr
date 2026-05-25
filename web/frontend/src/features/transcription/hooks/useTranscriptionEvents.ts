import { useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import type { AudioFile } from '@/features/transcription/hooks/useAudioFiles';

interface JobUpdateEvent {
    type: string;
    payload: {
        job_id: string;
        status: string;
        error?: string;
        progress?: number;
    };
}

// Shared SSE connection logic. Pass jobId=null to open a global wildcard connection
// (receives events for all jobs). Pass a specific jobId to subscribe to one job only.
function useSSEConnection(jobId: string | null) {
    const { token } = useAuth();
    const queryClient = useQueryClient();
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!token) return;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // null or undefined jobId → global wildcard connection (no query param)
        const url = jobId ? `/api/v1/events?job_id=${jobId}` : '/api/v1/events';

        const connect = async () => {
            try {
                const response = await fetch(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    throw new Error(`SSE connection failed: ${response.status}`);
                }

                if (!response.body) {
                    throw new Error('No response body');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;

                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith(':')) continue;

                        if (trimmed.startsWith('data: ')) {
                            const data = trimmed.slice(6);
                            try {
                                const event = JSON.parse(data);
                                handleEvent(event);
                            } catch (e) {
                                console.error('Failed to parse SSE data:', e);
                            }
                        }
                    }
                }
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    const errorMsg = (error as Error).message;
                    if (!errorMsg.includes('Error in input stream')) {
                        console.error('SSE connection error, reconnecting in 5s...', error);
                        setTimeout(() => {
                            if (!abortController.signal.aborted) {
                                connect();
                            }
                        }, 5000);
                    }
                }
            }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handleEvent = (event: any) => {
            if (event.type === 'job_update') {
                const payload = event.payload as JobUpdateEvent['payload'];

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                queryClient.setQueriesData({ queryKey: ['audioFiles'] }, (oldData: any) => {
                    if (!oldData) return oldData;

                    if (oldData.pages) {
                        return {
                            ...oldData,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            pages: oldData.pages.map((page: any) => ({
                                ...page,
                                jobs: page.jobs.map((job: AudioFile) => {
                                    if (job.id === payload.job_id) {
                                        return {
                                            ...job,
                                            status: payload.status,
                                            error_message: payload.error || job.error_message,
                                        };
                                    }
                                    return job;
                                }),
                            })),
                        };
                    }

                    if (oldData.jobs) {
                        return {
                            ...oldData,
                            jobs: oldData.jobs.map((job: AudioFile) => {
                                if (job.id === payload.job_id) {
                                    return {
                                        ...job,
                                        status: payload.status,
                                        error_message: payload.error || job.error_message,
                                    };
                                }
                                return job;
                            }),
                        };
                    }

                    return oldData;
                });
            }
        };

        connect();

        return () => {
            abortController.abort();
        };
    }, [token, queryClient, jobId]);
}

/**
 * Opens a single global SSE connection that receives events for ALL jobs.
 * Use this instead of useTranscriptionEvents to avoid the HTTP/1.1 6-connection limit.
 */
export const useGlobalTranscriptionEvents = () => {
    useSSEConnection(null);
};

/**
 * Opens a per-job SSE connection. Prefer useGlobalTranscriptionEvents when
 * monitoring multiple concurrent jobs to avoid exhausting the connection pool.
 */
export const useTranscriptionEvents = (jobId: string | null) => {
    useSSEConnection(jobId);
};
