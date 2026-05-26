import { useState, useEffect, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plus } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
    useCollections,
    useCollectionsForRecording,
    useAddToCollection,
    useRemoveFromCollection,
    useCreateCollection,
} from "./hooks/useCollections";
import { CreateCollectionDialog } from "./CreateCollectionDialog";
import { cn } from "@/lib/utils";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Single recording — enables toggle (add/remove) and shows current membership. */
    recordingId?: string;
    /** Multiple recordings — add-only, no remove. */
    recordingIds?: string[];
}

export function AddToCollectionDialog({ open, onOpenChange, recordingId, recordingIds }: Props) {
    const { t } = useTranslation();
    // Resolve the effective list of IDs (single or bulk).
    const ids = recordingIds ?? (recordingId ? [recordingId] : []);
    const isBulk = ids.length > 1;

    const { data: allCollections } = useCollections();
    // Only query membership for single-item mode.
    const { data: myCollections, isFetching: membershipFetching } = useCollectionsForRecording(
        !isBulk && recordingId ? recordingId : ""
    );
    const addMutation = useAddToCollection();
    const removeMutation = useRemoveFromCollection();
    const createMutation = useCreateCollection();
    const [showCreate, setShowCreate] = useState(false);
    const [pending, setPending] = useState<string | null>(null);

    // Optimistic local membership set — updated immediately on click so UI never lags.
    const [membershipSet, setMembershipSet] = useState<Set<string>>(new Set());

    // Sync from server whenever the membership query resolves.
    // Skip while fetching: during a background refetch the data is still stale,
    // and syncing it would clobber the optimistic update we just applied.
    useEffect(() => {
        if (membershipFetching) return;
        if (!isBulk && myCollections?.collections !== undefined) {
            setMembershipSet(new Set(myCollections.collections.map((c) => c.id)));
        } else if (isBulk) {
            setMembershipSet(new Set());
        }
    }, [myCollections, isBulk, membershipFetching]);

    const handleClick = useCallback(async (collectionId: string) => {
        if (pending) return;
        const wasIn = !isBulk && membershipSet.has(collectionId);

        // Optimistic update — immediately reflects in the UI.
        setMembershipSet((prev) => {
            const next = new Set(prev);
            if (wasIn) next.delete(collectionId);
            else next.add(collectionId);
            return next;
        });

        setPending(collectionId);
        try {
            if (wasIn) {
                await removeMutation.mutateAsync({ collectionId, recordingId: ids[0] });
            } else {
                await addMutation.mutateAsync({ collectionId, recordingIds: ids });
            }
        } catch {
            // Revert on error.
            setMembershipSet((prev) => {
                const next = new Set(prev);
                if (wasIn) next.add(collectionId);
                else next.delete(collectionId);
                return next;
            });
        } finally {
            setPending(null);
        }
    }, [pending, isBulk, membershipSet, ids, addMutation, removeMutation]);

    useEffect(() => {
        if (!open) {
            setShowCreate(false);
            setMembershipSet(new Set());
        }
    }, [open]);

    return (
        <>
            <Dialog open={open && !showCreate} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-sm glass-card border-[var(--border-subtle)]">
                    <DialogHeader>
                        <DialogTitle>
                            {t('collections.addToCollectionTitle')}
                            {isBulk && (
                                <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
                                    ({ids.length} {t('collections.recordingsPlural')})
                                </span>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-1.5 py-2 max-h-64 overflow-y-auto">
                        {(allCollections?.collections ?? []).length === 0 ? (
                            <p className="text-sm text-[var(--text-secondary)] text-center py-4">
                                {t('collections.empty')}
                            </p>
                        ) : (
                            (allCollections?.collections ?? []).map((col) => {
                                const inCol = !isBulk && membershipSet.has(col.id);
                                const loading = pending === col.id;
                                return (
                                    <button
                                        key={col.id}
                                        onClick={() => handleClick(col.id)}
                                        disabled={loading}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-btn)] text-left transition-colors cursor-pointer",
                                            inCol
                                                ? "bg-[var(--brand-light)] text-[var(--brand-solid)]"
                                                : "hover:bg-[var(--secondary)] text-[var(--text-primary)]"
                                        )}
                                    >
                                        <div
                                            className="w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: col.color }}
                                        />
                                        <span className="text-sm font-medium flex-1 truncate">{col.name}</span>
                                        {loading
                                            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                                            : inCol
                                                ? <Check className="w-4 h-4" />
                                                : null
                                        }
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <DialogFooter className="flex-row justify-between sm:justify-between">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCreate(true)}
                            className="text-[var(--text-secondary)]"
                        >
                            <Plus className="w-4 h-4 mr-1" />
                            {t('collections.create')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                            {t('collections.cancel')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <CreateCollectionDialog
                open={showCreate}
                onOpenChange={(v) => { setShowCreate(v); }}
                onSave={async (data) => {
                    const col = await createMutation.mutateAsync(data);
                    if (col?.id) {
                        await addMutation.mutateAsync({ collectionId: col.id, recordingIds: ids });
                    }
                    setShowCreate(false);
                }}
            />
        </>
    );
}
