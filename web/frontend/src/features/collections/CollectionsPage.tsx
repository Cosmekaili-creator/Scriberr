import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, Trash2, Pencil } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
    useCollections,
    useCreateCollection,
    useUpdateCollection,
    useDeleteCollection,
    type Collection,
} from "./hooks/useCollections";
import { CreateCollectionDialog } from "./CreateCollectionDialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function CollectionsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { data, isLoading } = useCollections();
    const createMutation = useCreateCollection();
    const updateMutation = useUpdateCollection();
    const deleteMutation = useDeleteCollection();

    const [showCreate, setShowCreate] = useState(false);
    const [editing, setEditing] = useState<Collection | null>(null);
    const [deleting, setDeleting] = useState<Collection | null>(null);

    const collections = data?.collections ?? [];

    return (
        <MainLayout className="min-h-screen bg-[var(--bg-main)]" header={<Header />}>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                    {t('collections.title')}
                </h1>
                <Button
                    onClick={() => setShowCreate(true)}
                    className="bg-[image:var(--brand-gradient)] text-white border-none hover:opacity-90"
                >
                    <Plus className="w-4 h-4 mr-2" />
                    {t('collections.create')}
                </Button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-solid)]" />
                </div>
            ) : collections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <FolderOpen className="w-12 h-12 text-[var(--text-tertiary)] mb-4" />
                    <p className="text-lg font-medium text-[var(--text-secondary)]">{t('collections.empty')}</p>
                    <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('collections.emptyDesc')}</p>
                    <Button className="mt-6" onClick={() => setShowCreate(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        {t('collections.create')}
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {collections.map((col) => (
                        <div
                            key={col.id}
                            className={cn(
                                "glass-card rounded-[var(--radius-card)] p-5 border border-[var(--border-subtle)]",
                                "flex flex-col gap-3 cursor-pointer group hover:shadow-[var(--shadow-float)] transition-shadow"
                            )}
                            onClick={() => navigate(`/collections/${col.id}`)}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div
                                        className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: col.color }}
                                    />
                                    <h3 className="font-semibold text-[var(--text-primary)] truncate">{col.name}</h3>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setEditing(col); }}
                                        className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--text-secondary)] cursor-pointer"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setDeleting(col); }}
                                        className="p-1.5 rounded hover:bg-[var(--error)]/10 text-[var(--error)] cursor-pointer"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            {col.description && (
                                <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{col.description}</p>
                            )}
                            <p className="text-xs text-[var(--text-tertiary)] mt-auto">
                                {col.recording_count} {col.recording_count === 1
                                    ? t('collections.recordings')
                                    : t('collections.recordingsPlural')}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            <CreateCollectionDialog
                open={showCreate}
                onOpenChange={setShowCreate}
                onSave={async (data) => { await createMutation.mutateAsync(data); }}
            />

            <CreateCollectionDialog
                open={!!editing}
                onOpenChange={(v) => { if (!v) setEditing(null); }}
                initial={editing}
                onSave={async (data) => {
                    if (!editing) return;
                    await updateMutation.mutateAsync({ id: editing.id, ...data });
                    setEditing(null);
                }}
            />

            <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
                <AlertDialogContent className="glass-card border-[var(--border-subtle)]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('collections.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('collections.deleteConfirm')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('collections.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                if (!deleting) return;
                                await deleteMutation.mutateAsync(deleting.id);
                                setDeleting(null);
                            }}
                            className="bg-[var(--error)] text-white hover:bg-[var(--error)]/90"
                        >
                            {t('collections.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </MainLayout>
    );
}
