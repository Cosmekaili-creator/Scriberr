import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Sparkles, GitMerge, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { useCollection, useRemoveFromCollection } from "./hooks/useCollections";
import { useSummaryTemplates } from "@/features/transcription/hooks/useTranscriptionSummary";
import { useAuth } from "@/features/auth/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

// ---- Streaming summarize dialog ----

interface SummarizeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    collectionId: string;
    mode: "summarize" | "combine";
}

function SummarizeDialog({ open, onOpenChange, collectionId, mode }: SummarizeDialogProps) {
    const { t } = useTranslation();
    const { getAuthHeaders } = useAuth();
    const { data: templates = [] } = useSummaryTemplates();

    const [models, setModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [selectedTemplate, setSelectedTemplate] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [result, setResult] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    const loadModels = async () => {
        try {
            const res = await fetch("/api/v1/chat/models", { headers: getAuthHeaders() });
            if (res.ok) {
                const data = await res.json();
                const list: string[] = data.models || [];
                setModels(list);
                if (list.length && !selectedModel) setSelectedModel(list[0]);
            }
        } catch { /* ignore */ }
    };

    const handleOpen = (v: boolean) => {
        if (v) { loadModels(); setResult(""); }
        else { abortRef.current?.abort(); }
        onOpenChange(v);
    };

    const run = async () => {
        if (!selectedModel) return;
        setStreaming(true);
        setResult("");
        abortRef.current = new AbortController();

        const endpoint = mode === "summarize"
            ? `/api/v1/collections/${collectionId}/summarize`
            : `/api/v1/collections/${collectionId}/combine`;

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify({
                    model: selectedModel,
                    template_id: selectedTemplate || undefined,
                }),
                signal: abortRef.current.signal,
            });

            if (!res.body) throw new Error("No stream");
            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                setResult((prev) => prev + decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            if ((e as Error).name !== "AbortError") {
                setResult((prev) => prev + "\n\n[Error: " + (e as Error).message + "]");
            }
        } finally {
            setStreaming(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogContent className="sm:max-w-2xl glass-card border-[var(--border-subtle)] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        {mode === "summarize" ? t('collections.summarize') : t('collections.combine')}
                    </DialogTitle>
                </DialogHeader>

                {!result && !streaming && (
                    <div className="space-y-4 py-2 flex-1">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-[var(--text-primary)]">
                                {t('collections.selectModel')}
                            </label>
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="w-full px-3 py-2 text-sm rounded-[var(--radius-btn)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)]"
                            >
                                {models.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>

                        {templates.length > 0 && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-[var(--text-primary)]">
                                    {t('collections.selectTemplate')}
                                </label>
                                <select
                                    value={selectedTemplate}
                                    onChange={(e) => setSelectedTemplate(e.target.value)}
                                    className="w-full px-3 py-2 text-sm rounded-[var(--radius-btn)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)]"
                                >
                                    <option value="">{t('collections.noTemplate')}</option>
                                    {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                )}

                {(streaming || result) && (
                    <div className="flex-1 overflow-y-auto py-2 min-h-0">
                        {streaming && !result && (
                            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t('collections.summarizing')}
                            </div>
                        )}
                        {result && (
                            <div className="prose prose-sm dark:prose-invert max-w-none text-[var(--text-primary)]">
                                <ReactMarkdown
                                    remarkPlugins={[remarkMath]}
                                    rehypePlugins={[rehypeRaw, rehypeKatex, rehypeHighlight]}
                                >
                                    {result}
                                </ReactMarkdown>
                                {streaming && <span className="animate-pulse">▋</span>}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpen(false)}>
                        {t('collections.cancel')}
                    </Button>
                    {!result && (
                        <Button onClick={run} disabled={streaming || !selectedModel}>
                            {streaming && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            <Sparkles className="w-4 h-4 mr-2" />
                            {mode === "summarize" ? t('collections.summarize') : t('collections.combine')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ---- Main page ----

export function CollectionDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { data, isLoading } = useCollection(id ?? "");
    const removeMutation = useRemoveFromCollection();
    const [summarizeOpen, setSummarizeOpen] = useState(false);
    const [combineOpen, setCombineOpen] = useState(false);

    const collection = data?.collection;
    const recordings = data?.recordings ?? [];

    return (
        <MainLayout className="min-h-screen bg-[var(--bg-main)]" header={<Header />}>
            <button
                onClick={() => navigate("/collections")}
                className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6 transition-colors cursor-pointer"
            >
                <ArrowLeft className="w-4 h-4" />
                {t('collections.backToCollections')}
            </button>

            {isLoading ? (
                <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-solid)]" />
                </div>
            ) : !collection ? (
                <p className="text-[var(--text-secondary)]">Collection not found.</p>
            ) : (
                <>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-4 h-4 rounded-full flex-shrink-0"
                                style={{ backgroundColor: collection.color }}
                            />
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                                    {collection.name}
                                </h1>
                                {collection.description && (
                                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">{collection.description}</p>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-2 flex-shrink-0">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCombineOpen(true)}
                                disabled={recordings.every((r) => !r.summary)}
                            >
                                <GitMerge className="w-4 h-4 mr-1.5" />
                                {t('collections.combine')}
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => setSummarizeOpen(true)}
                                className="bg-[image:var(--brand-gradient)] text-white border-none hover:opacity-90"
                                disabled={recordings.every((r) => !r.transcript)}
                            >
                                <Sparkles className="w-4 h-4 mr-1.5" />
                                {t('collections.summarize')}
                            </Button>
                        </div>
                    </div>

                    {recordings.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center">
                            <p className="text-lg font-medium text-[var(--text-secondary)]">{t('collections.noRecordings')}</p>
                            <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('collections.noRecordingsDesc')}</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {recordings.map((rec) => (
                                <div
                                    key={rec.id}
                                    className="glass-card rounded-[var(--radius-card)] px-4 py-3 border border-[var(--border-subtle)] flex items-center justify-between gap-3 group"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm text-[var(--text-primary)] truncate">
                                            {rec.title || rec.id}
                                        </p>
                                        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                                            {rec.status}
                                            {rec.summary ? " · summarized" : ""}
                                        </p>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => navigate(`/audio/${rec.id}`)}
                                            className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--text-secondary)] cursor-pointer"
                                            title="Open"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                await removeMutation.mutateAsync({
                                                    collectionId: id!,
                                                    recordingId: rec.id,
                                                });
                                            }}
                                            className="p-1.5 rounded hover:bg-[var(--error)]/10 text-[var(--error)] cursor-pointer"
                                            title={t('collections.removeFromCollection')}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            <SummarizeDialog
                open={summarizeOpen}
                onOpenChange={setSummarizeOpen}
                collectionId={id ?? ""}
                mode="summarize"
            />
            <SummarizeDialog
                open={combineOpen}
                onOpenChange={setCombineOpen}
                collectionId={id ?? ""}
                mode="combine"
            />
        </MainLayout>
    );
}
