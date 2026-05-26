import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { Collection } from "./hooks/useCollections";

const COLORS = [
    "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
    "#f97316", "#eab308", "#22c55e", "#14b8a6",
    "#3b82f6", "#64748b",
];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: { name: string; description?: string; color: string }) => Promise<void>;
    initial?: Collection | null;
}

export function CreateCollectionDialog({ open, onOpenChange, onSave, initial }: Props) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [color, setColor] = useState(COLORS[0]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setName(initial?.name ?? "");
            setDescription(initial?.description ?? "");
            setColor(initial?.color ?? COLORS[0]);
        }
    }, [open, initial]);

    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            await onSave({ name: name.trim(), description: description.trim() || undefined, color });
            onOpenChange(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md glass-card border-[var(--border-subtle)]">
                <DialogHeader>
                    <DialogTitle>
                        {initial ? t('collections.editTitle') : t('collections.createTitle')}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[var(--text-primary)]">
                            {t('collections.name')}
                        </label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t('collections.namePlaceholder')}
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[var(--text-primary)]">
                            {t('collections.description')}
                        </label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('collections.descriptionPlaceholder')}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[var(--text-primary)]">
                            {t('collections.color')}
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => setColor(c)}
                                    className="w-7 h-7 rounded-full transition-transform hover:scale-110 cursor-pointer"
                                    style={{
                                        backgroundColor: c,
                                        outline: color === c ? `2px solid ${c}` : 'none',
                                        outlineOffset: '2px',
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('collections.cancel')}
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !name.trim()}>
                        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {t('collections.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
