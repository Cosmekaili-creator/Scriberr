import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/useAuth';

export interface Collection {
    id: string;
    name: string;
    description?: string;
    color: string;
    recording_count: number;
    created_at: string;
    updated_at: string;
}

export interface CollectionRecording {
    id: string;
    title?: string;
    status: string;
    transcript?: string;
    summary?: string;
    created_at: string;
}

function useApiRequest() {
    const { getAuthHeaders } = useAuth();

    const request = async (url: string, options?: RequestInit) => {
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders(),
                ...options?.headers,
            },
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    };

    return { request, getAuthHeaders };
}

export function useCollections() {
    const { request } = useApiRequest();

    return useQuery<{ collections: Collection[] }>({
        queryKey: ['collections'],
        queryFn: () => request('/api/v1/collections/'),
    });
}

export function useCollection(id: string) {
    const { request } = useApiRequest();

    return useQuery<{ collection: Collection; recordings: CollectionRecording[] }>({
        queryKey: ['collections', id],
        queryFn: () => request(`/api/v1/collections/${id}`),
        enabled: !!id,
    });
}

export function useCollectionsForRecording(recordingId: string) {
    const { request } = useApiRequest();

    return useQuery<{ collections: Collection[] }>({
        queryKey: ['collections', 'for-recording', recordingId],
        queryFn: () => request(`/api/v1/collections/for-recording/${recordingId}`),
        enabled: !!recordingId,
    });
}

export function useCreateCollection() {
    const { request } = useApiRequest();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (data: { name: string; description?: string; color?: string }) =>
            request('/api/v1/collections/', { method: 'POST', body: JSON.stringify(data) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
    });
}

export function useUpdateCollection() {
    const { request } = useApiRequest();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; color?: string }) =>
            request(`/api/v1/collections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['collections'] });
            qc.invalidateQueries({ queryKey: ['collections', vars.id] });
        },
    });
}

export function useDeleteCollection() {
    const { request } = useApiRequest();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (id: string) =>
            request(`/api/v1/collections/${id}`, { method: 'DELETE' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
    });
}

export function useAddToCollection() {
    const { request } = useApiRequest();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: ({ collectionId, recordingIds }: { collectionId: string; recordingIds: string[] }) =>
            request(`/api/v1/collections/${collectionId}/recordings`, {
                method: 'POST',
                body: JSON.stringify({ recording_ids: recordingIds }),
            }),
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['collections', vars.collectionId] });
            qc.invalidateQueries({ queryKey: ['collections'] });
            // Refresh membership state for all affected recordings
            qc.invalidateQueries({ queryKey: ['collections', 'for-recording'] });
        },
    });
}

export function useRemoveFromCollection() {
    const { request } = useApiRequest();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: ({ collectionId, recordingId }: { collectionId: string; recordingId: string }) =>
            request(`/api/v1/collections/${collectionId}/recordings/${recordingId}`, { method: 'DELETE' }),
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['collections', vars.collectionId] });
            qc.invalidateQueries({ queryKey: ['collections'] });
            qc.invalidateQueries({ queryKey: ['collections', 'for-recording', vars.recordingId] });
        },
    });
}
