import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { FormField, SelectField, SwitchField, inputClassName } from "@/components/transcription/FormHelpers";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { Globe } from "lucide-react";

export interface SummaryTemplate {
  id?: string;
  name: string;
  description?: string;
  model?: string;
  prompt: string;
  include_speaker_info?: boolean;
  owner_user_id?: string | null;
  is_global?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface SummaryTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (tpl: Omit<SummaryTemplate, 'created_at' | 'updated_at'>) => Promise<void> | void;
  initial?: SummaryTemplate | null;
  showGlobalToggle?: boolean;
}

export function SummaryTemplateDialog({ open, onOpenChange, onSave, initial, showGlobalToggle }: SummaryTemplateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [includeSpeakerInfo, setIncludeSpeakerInfo] = useState(false);
  const [isGlobal, setIsGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const { getAuthHeaders } = useAuth();

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setDescription(initial?.description || "");
      setModel(initial?.model || "");
      setPrompt(initial?.prompt || "");
      setIncludeSpeakerInfo(initial?.include_speaker_info || false);
      setIsGlobal(false);
      // Load models when dialog opens
      (async () => {
        try {
          const res = await fetch('/api/v1/chat/models', { headers: { ...getAuthHeaders() } });
          if (res.ok) {
            const data = await res.json();
            setModels(data.models || []);
            if (!initial?.model && (data.models || []).length) {
              setModel(data.models[0]);
            }
          }
        } catch { /* ignore */ }
      })();
    }
  }, [open, initial, getAuthHeaders]);

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim() || !model.trim()) return;
    try {
      setSaving(true);
      await onSave({
        id: initial?.id,
        name: name.trim(),
        description: description.trim() || undefined,
        model: model.trim(),
        prompt: prompt.trim(),
        include_speaker_info: includeSpeakerInfo,
        is_global: showGlobalToggle ? isGlobal : undefined,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const isFormValid = name.trim() && prompt.trim() && model.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-full sm:max-w-2xl w-[calc(100vw-1rem)] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-[var(--border-subtle)]">
          <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">
            {initial ? t('settings.summary.dialog.editTitle') : t('settings.summary.dialog.newTitle')}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)] text-sm mt-1">
            {t('settings.summary.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {/* Name Field */}
          <FormField label={t('settings.summary.dialog.nameLabel')} htmlFor="templateName">
            <Input
              id="templateName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.summary.dialog.namePlaceholder')}
              className={inputClassName}
            />
          </FormField>

          {/* Model Selection */}
          <SelectField
            label={t('settings.summary.dialog.modelLabel')}
            description={t('settings.summary.dialog.modelDesc')}
            value={model}
            onValueChange={setModel}
            options={models}
          />

          {/* Description Field */}
          <FormField label={t('settings.summary.dialog.descLabel')} htmlFor="templateDesc" optional>
            <Input
              id="templateDesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.summary.dialog.descPlaceholder')}
              className={inputClassName}
            />
          </FormField>

          {/* Prompt Field */}
          <FormField
            label={t('settings.summary.dialog.promptLabel')}
            htmlFor="templatePrompt"
            description={t('settings.summary.dialog.promptDesc')}
          >
            <Textarea
              id="templatePrompt"
              rows={12}
              className={`${inputClassName} resize-y min-h-[200px] max-h-[50vh]`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('settings.summary.dialog.promptPlaceholder')}
            />
          </FormField>

          {/* Include Speaker Info Toggle */}
          <SwitchField
            id="includeSpeakerInfo"
            label={t('settings.summary.dialog.includeSpeakers')}
            checked={includeSpeakerInfo}
            onCheckedChange={setIncludeSpeakerInfo}
          />

          {/* Make Global (admins only, create mode) */}
          {showGlobalToggle && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isGlobal}
                onChange={(e) => setIsGlobal(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-subtle)] accent-[var(--brand-solid)]"
              />
              <Globe className="h-3.5 w-3.5 text-[var(--brand-solid)]" />
              <span className="text-sm text-[var(--text-secondary)]">
                {t('settings.summary.makeGlobal')}
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-[var(--border-subtle)] gap-3 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-main)] cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !isFormValid}
            className="rounded-xl text-white cursor-pointer bg-gradient-to-r from-[#FFAB40] to-[#FF3D00] hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('settings.summary.dialog.saving')}
              </>
            ) : (
              initial ? t('settings.summary.dialog.update') : t('settings.summary.dialog.create')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
