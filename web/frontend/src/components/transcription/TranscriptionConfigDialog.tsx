import { useState, useEffect, memo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Check, XCircle } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useTranslation } from "@/i18n";
import {
    FormField, Section, InfoBanner, SelectField, SwitchField, SliderField, AdvancedAccordion,
    inputClassName,
} from "@/components/transcription/FormHelpers";

// ============================================================================
// Types & Constants
// ============================================================================

export interface WhisperXParams {
    model_family: string;
    model: string;
    model_cache_only: boolean;
    model_dir?: string;
    device: string;
    device_index: number;
    batch_size: number;
    compute_type: string;
    threads: number;
    output_format: string;
    verbose: boolean;
    task: string;
    language?: string;
    align_model?: string;
    interpolate_method: string;
    no_align: boolean;
    return_char_alignments: boolean;
    vad_method: string;
    vad_onset: number;
    vad_offset: number;
    chunk_size: number;
    diarize: boolean;
    min_speakers?: number;
    max_speakers?: number;
    diarize_model: string;
    speaker_embeddings: boolean;
    temperature: number;
    best_of: number;
    beam_size: number;
    patience: number;
    length_penalty: number;
    suppress_tokens?: string;
    suppress_numerals: boolean;
    initial_prompt?: string;
    condition_on_previous_text: boolean;
    fp16: boolean;
    temperature_increment_on_fallback: number;
    compression_ratio_threshold: number;
    logprob_threshold: number;
    no_speech_threshold: number;
    max_line_width?: number;
    max_line_count?: number;
    highlight_words: boolean;
    segment_resolution: string;
    hf_token?: string;
    print_progress: boolean;
    attention_context_left: number;
    attention_context_right: number;
    is_multi_track_enabled: boolean;
    api_key?: string;
    max_new_tokens?: number;
}

interface TranscriptionConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStartTranscription: (params: WhisperXParams & { profileName?: string; profileDescription?: string }) => void;
    loading?: boolean;
    isProfileMode?: boolean;
    initialParams?: WhisperXParams;
    initialName?: string;
    initialDescription?: string;
    isMultiTrack?: boolean;
    title?: string;
}

const DEFAULT_PARAMS: WhisperXParams = {
    model_family: "whisper",
    model: "small",
    model_cache_only: false,
    device: "cpu",
    device_index: 0,
    batch_size: 8,
    compute_type: "float32",
    threads: 0,
    output_format: "all",
    verbose: true,
    task: "transcribe",
    interpolate_method: "nearest",
    no_align: false,
    return_char_alignments: false,
    vad_method: "pyannote",
    vad_onset: 0.5,
    vad_offset: 0.363,
    chunk_size: 30,
    diarize: false,
    diarize_model: "pyannote",
    speaker_embeddings: false,
    temperature: 0,
    best_of: 5,
    beam_size: 5,
    patience: 1.0,
    length_penalty: 1.0,
    suppress_numerals: false,
    condition_on_previous_text: false,
    fp16: true,
    temperature_increment_on_fallback: 0.2,
    compression_ratio_threshold: 2.4,
    logprob_threshold: -1.0,
    no_speech_threshold: 0.6,
    highlight_words: false,
    segment_resolution: "sentence",
    print_progress: false,
    attention_context_left: 256,
    attention_context_right: 256,
    is_multi_track_enabled: false,
    api_key: "",
};

const WHISPER_MODELS = [
    "tiny", "tiny.en", "base", "base.en", "small", "small.en",
    "medium", "medium.en", "large", "large-v1", "large-v2", "large-v3"
];

const LANGUAGES = [
    { value: "auto", label: "Auto-detect" },
    { value: "af", label: "Afrikaans" },
    { value: "ar", label: "Arabic" },
    { value: "hy", label: "Armenian" },
    { value: "az", label: "Azerbaijani" },
    { value: "be", label: "Belarusian" },
    { value: "bs", label: "Bosnian" },
    { value: "bg", label: "Bulgarian" },
    { value: "ca", label: "Catalan" },
    { value: "zh", label: "Chinese" },
    { value: "hr", label: "Croatian" },
    { value: "cs", label: "Czech" },
    { value: "da", label: "Danish" },
    { value: "nl", label: "Dutch" },
    { value: "en", label: "English" },
    { value: "et", label: "Estonian" },
    { value: "fi", label: "Finnish" },
    { value: "fr", label: "French" },
    { value: "gl", label: "Galician" },
    { value: "de", label: "German" },
    { value: "el", label: "Greek" },
    { value: "he", label: "Hebrew" },
    { value: "hi", label: "Hindi" },
    { value: "hu", label: "Hungarian" },
    { value: "is", label: "Icelandic" },
    { value: "id", label: "Indonesian" },
    { value: "it", label: "Italian" },
    { value: "ja", label: "Japanese" },
    { value: "kn", label: "Kannada" },
    { value: "kk", label: "Kazakh" },
    { value: "ko", label: "Korean" },
    { value: "lv", label: "Latvian" },
    { value: "lt", label: "Lithuanian" },
    { value: "mk", label: "Macedonian" },
    { value: "ms", label: "Malay" },
    { value: "mr", label: "Marathi" },
    { value: "mi", label: "Maori" },
    { value: "ne", label: "Nepali" },
    { value: "no", label: "Norwegian" },
    { value: "fa", label: "Persian" },
    { value: "pl", label: "Polish" },
    { value: "pt", label: "Portuguese" },
    { value: "ro", label: "Romanian" },
    { value: "ru", label: "Russian" },
    { value: "sr", label: "Serbian" },
    { value: "sk", label: "Slovak" },
    { value: "sl", label: "Slovenian" },
    { value: "es", label: "Spanish" },
    { value: "sw", label: "Swahili" },
    { value: "sv", label: "Swedish" },
    { value: "tl", label: "Tagalog" },
    { value: "ta", label: "Tamil" },
    { value: "th", label: "Thai" },
    { value: "tr", label: "Turkish" },
    { value: "uk", label: "Ukrainian" },
    { value: "ur", label: "Urdu" },
    { value: "vi", label: "Vietnamese" },
    { value: "cy", label: "Welsh" },
];

const CANARY_LANGUAGES = [
    { value: "en", label: "English" },
    { value: "de", label: "German" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
];


// ============================================================================
// Main Component
// ============================================================================

export const TranscriptionConfigDialog = memo(function TranscriptionConfigDialog({
    open,
    onOpenChange,
    onStartTranscription,
    loading = false,
    isProfileMode = false,
    initialParams,
    initialName = "",
    initialDescription = "",
    isMultiTrack = false,
    title,
}: TranscriptionConfigDialogProps) {
    const [params, setParams] = useState<WhisperXParams>(DEFAULT_PARAMS);
    const [profileName, setProfileName] = useState("");
    const [profileDescription, setProfileDescription] = useState("");

    // OpenAI validation state
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
    const [validationMessage, setValidationMessage] = useState("");
    const { t } = useTranslation();
    const { getAuthHeaders } = useAuth();
    const [availableModels, setAvailableModels] = useState<string[]>(["whisper-1"]);

    // Reset when dialog opens
    useEffect(() => {
        if (open) {
            const baseParams = initialParams || DEFAULT_PARAMS;
            setParams({
                ...baseParams,
                is_multi_track_enabled: isMultiTrack,
                diarize: isMultiTrack ? false : baseParams.diarize
            });
            setProfileName(initialName);
            setProfileDescription(initialDescription);
        }
    }, [open, initialParams, initialName, initialDescription, isMultiTrack]);

    const updateParam = <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => {
        setParams(prev => {
            const newParams = { ...prev, [key]: value };
            if (key === 'model_family') {
                if (value === 'whisper') {
                    newParams.diarize_model = 'pyannote';
                } else if (value === 'assemblyai') {
                    newParams.model = 'universal-2';
                } else if (value === 'deepgram') {
                    newParams.model = 'nova-2';
                }
            }
            return newParams;
        });
    };

    const validateAPIKey = async () => {
        setIsValidating(true);
        setValidationStatus('idle');
        try {
            const response = await fetch('/api/v1/config/openai/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ api_key: params.api_key }),
            });
            const data = await response.json();
            if (response.ok && data.valid) {
                setValidationStatus('valid');
                setAvailableModels(data.models || ["whisper-1"]);
                setValidationMessage(t('transcription.config.apiKeyValid'));
            } else {
                setValidationStatus('invalid');
                setValidationMessage(data.error || t('transcription.config.apiKeyInvalid'));
            }
        } catch {
            setValidationStatus('invalid');
            setValidationMessage(t('transcription.config.validationFailed'));
        } finally {
            setIsValidating(false);
        }
    };

    const handleSubmit = () => {
        if (isProfileMode) {
            onStartTranscription({ ...params, profileName, profileDescription });
        } else {
            onStartTranscription(params);
        }
    };

    const dialogTitle = title || (isProfileMode
        ? (initialName ? t('transcription.config.editProfile').replace('{name}', initialName) : t('transcription.config.newProfile'))
        : t('transcription.config.title')
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-full sm:max-w-2xl w-[calc(100vw-1rem)] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl"
                style={{ boxShadow: 'var(--shadow-float)' }}
            >
                {/* Header */}
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-[var(--border-subtle)]">
                    <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">
                        {dialogTitle}
                    </DialogTitle>
                    <DialogDescription className="text-[var(--text-secondary)] text-sm mt-1">
                        {isProfileMode
                            ? t('transcription.config.profileDescription')
                            : t('transcription.config.description')
                        }
                    </DialogDescription>
                </DialogHeader>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

                    {/* Profile Name/Description (if profile mode) */}
                    {isProfileMode && (
                        <div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                            <FormField label={t('transcription.config.profileName')} htmlFor="profileName">
                                <Input
                                    id="profileName"
                                    value={profileName}
                                    onChange={(e) => setProfileName(e.target.value)}
                                    placeholder={t('transcription.config.profileNamePlaceholder')}
                                    className={inputClassName}
                                    required
                                />
                            </FormField>
                            <FormField label={t('transcription.config.profileDescriptionLabel')} htmlFor="profileDesc" optional>
                                <Textarea
                                    id="profileDesc"
                                    value={profileDescription}
                                    onChange={(e) => setProfileDescription(e.target.value)}
                                    placeholder={t('transcription.config.profileDescPlaceholder')}
                                    className={`${inputClassName} resize-none min-h-[80px]`}
                                    rows={2}
                                />
                            </FormField>
                        </div>
                    )}

                    {/* Model Family Selection */}
                    <SelectField
                        label={t('transcription.config.modelFamily')}
                        description={t('transcription.config.modelFamilyDesc')}
                        value={params.model_family}
                        onValueChange={(v) => updateParam('model_family', v)}
                        options={[
                            { value: "whisper", label: "Whisper (local)" },
                            { value: "nvidia_parakeet", label: "NVIDIA Parakeet (local)" },
                            { value: "nvidia_canary", label: "NVIDIA Canary (local)" },
                            { value: "mistral_voxtral", label: "Mistral Voxtral (local)" },
                            { value: "openai", label: "OpenAI Whisper (cloud)" },
                            { value: "assemblyai", label: "AssemblyAI (cloud)" },
                            { value: "deepgram", label: "Deepgram (cloud)" },
                        ]}
                    />

                    {/* Multi-track notice (when transcribing a known multi-track job) */}
                    {isMultiTrack && (
                        <InfoBanner variant="info" title={t('transcription.config.multiTrackTitle')}>
                            {t('transcription.config.multiTrackDesc')}
                        </InfoBanner>
                    )}

                    {/* Multi-track toggle (editable in profile mode; locked when transcribing a multi-track file) */}
                    {(isProfileMode || isMultiTrack) && (
                        <SwitchField
                            id="is_multi_track_enabled"
                            label={t('transcription.config.multiTrackEnabled')}
                            description={t('transcription.config.multiTrackEnabledHelp')}
                            checked={params.is_multi_track_enabled}
                            onCheckedChange={(v) => {
                                updateParam('is_multi_track_enabled', v);
                                if (v) updateParam('diarize', false);
                            }}
                            disabled={isMultiTrack}
                        />
                    )}

                    {/* Model-Specific Configuration */}
                    {params.model_family === "whisper" && (
                        <WhisperConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack} />
                    )}
                    {params.model_family === "nvidia_parakeet" && (
                        <ParakeetConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack} />
                    )}
                    {params.model_family === "nvidia_canary" && (
                        <CanaryConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack} />
                    )}
                    {params.model_family === "openai" && (
                        <OpenAIConfig
                            params={params} updateParam={updateParam}
                            isValidating={isValidating} validationStatus={validationStatus}
                            validationMessage={validationMessage} availableModels={availableModels}
                            onValidate={validateAPIKey}
                        />
                    )}
                    {params.model_family === "mistral_voxtral" && (
                        <VoxtralConfig params={params} updateParam={updateParam} />
                    )}
                    {params.model_family === "assemblyai" && (
                        <AssemblyAIConfig params={params} updateParam={updateParam} />
                    )}
                    {params.model_family === "deepgram" && (
                        <DeepgramConfig params={params} updateParam={updateParam} />
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
                        onClick={handleSubmit}
                        disabled={loading || (isProfileMode && !profileName.trim())}
                        className="rounded-xl text-white cursor-pointer bg-gradient-to-r from-[#FFAB40] to-[#FF3D00] hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {t('transcription.config.starting')}
                            </>
                        ) : (
                            isProfileMode ? t('transcription.config.saveProfile') : t('transcription.config.startTranscription')
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
});

// ============================================================================
// Shared Diarization Section
// ============================================================================

function DiarizationSection({ id, params, updateParam, description }: {
    id: string;
    params: WhisperXParams;
    updateParam: <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => void;
    description?: string;
}) {
    const { t } = useTranslation();
    return (
        <Section title={t('transcription.config.speakerDiarization')} description={description}>
            <div className="space-y-4">
                <SwitchField id={id} label={t('transcription.config.enableSpeakerIdent')} checked={params.diarize} onCheckedChange={(v) => updateParam('diarize', v)} />

                {params.diarize && (
                    <div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                        <SelectField
                            label={t('transcription.config.diarizationModel')}
                            value={params.diarize_model}
                            onValueChange={(v) => updateParam('diarize_model', v)}
                            options={[
                                { value: "pyannote", label: "Pyannote" },
                                { value: "nvidia_sortformer", label: "NVIDIA Sortformer" },
                            ]}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField label={t('transcription.config.minSpeakers')} optional>
                                <Input
                                    type="number" min={1} max={20} placeholder="Auto"
                                    value={params.min_speakers || ""}
                                    onChange={(e) => updateParam('min_speakers', e.target.value ? parseInt(e.target.value) : undefined)}
                                    className={inputClassName}
                                />
                            </FormField>
                            <FormField label={t('transcription.config.maxSpeakers')} optional>
                                <Input
                                    type="number" min={1} max={20} placeholder="Auto"
                                    value={params.max_speakers || ""}
                                    onChange={(e) => updateParam('max_speakers', e.target.value ? parseInt(e.target.value) : undefined)}
                                    className={inputClassName}
                                />
                            </FormField>
                        </div>

                        {params.diarize_model === "pyannote" && (
                            <>
                                <FormField label={t('transcription.config.hfToken')} description={t('transcription.config.paramDesc.hf_token')}>
                                    <Input
                                        type="password" placeholder="hf_..."
                                        value={params.hf_token || ""}
                                        onChange={(e) => updateParam('hf_token', e.target.value || undefined)}
                                        className={inputClassName}
                                    />
                                </FormField>

                                <div className="pt-3 border-t border-[var(--border-subtle)]">
                                    <p className="text-xs text-[var(--text-tertiary)] mb-3">Voice Detection Tuning (for noisy/distant audio)</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField label={t('transcription.config.vadOnset')} description={t('transcription.config.paramDesc.vad_onset')}>
                                            <Input
                                                type="number" min={0.1} max={0.9} step={0.05}
                                                value={params.vad_onset}
                                                onChange={(e) => updateParam('vad_onset', parseFloat(e.target.value) || 0.5)}
                                                className={inputClassName}
                                            />
                                        </FormField>
                                        <FormField label={t('transcription.config.vadOffset')} description={t('transcription.config.paramDesc.vad_offset')}>
                                            <Input
                                                type="number" min={0.1} max={0.9} step={0.05}
                                                value={params.vad_offset}
                                                onChange={(e) => updateParam('vad_offset', parseFloat(e.target.value) || 0.363)}
                                                className={inputClassName}
                                            />
                                        </FormField>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </Section>
    );
}

// ============================================================================
// Model-Specific Configuration Components
// ============================================================================

interface ConfigProps {
    params: WhisperXParams;
    updateParam: <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => void;
    isMultiTrack?: boolean;
}

function WhisperConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <Section title={t('transcription.config.modelSettings')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SelectField label={t('transcription.config.modelSize')} description={t('transcription.config.paramDesc.model')} value={params.model} onValueChange={(v) => updateParam('model', v)} options={WHISPER_MODELS} />
                    <SelectField label={t('transcription.config.language')} description={t('transcription.config.paramDesc.language')} value={params.language || "auto"} onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)} options={LANGUAGES} />
                    <SelectField label={t('transcription.config.task')} description={t('transcription.config.paramDesc.task')} value={params.task} onValueChange={(v) => updateParam('task', v)} options={[{ value: "transcribe", label: t('transcription.config.transcribe') }, { value: "translate", label: t('transcription.config.translateToEnglish') }]} />
                    <SelectField label={t('transcription.config.device')} description={t('transcription.config.paramDesc.device')} value={params.device} onValueChange={(v) => updateParam('device', v)} options={[{ value: "cpu", label: "CPU" }, { value: "cuda", label: "GPU (CUDA)" }]} />
                </div>
            </Section>

            {!isMultiTrack && (
                <DiarizationSection id="diarize" params={params} updateParam={updateParam} description={t('transcription.config.diarizeSectionDesc')} />
            )}

            <AdvancedAccordion>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SelectField label={t('transcription.config.computeType')} description={t('transcription.config.paramDesc.compute_type')} value={params.compute_type} onValueChange={(v) => updateParam('compute_type', v)} options={[{ value: "float32", label: t('transcription.config.float32') }, { value: "float16", label: t('transcription.config.float16') }, { value: "int8", label: t('transcription.config.int8') }]} />
                    <FormField label={t('transcription.config.batchSize')} description={t('transcription.config.paramDesc.batch_size')}>
                        <Input type="number" min={1} max={64} value={params.batch_size} onChange={(e) => updateParam('batch_size', parseInt(e.target.value) || 8)} className={inputClassName} />
                    </FormField>
                    <FormField label={t('transcription.config.beamSize')} description={t('transcription.config.paramDesc.beam_size')}>
                        <Input type="number" min={1} max={10} value={params.beam_size} onChange={(e) => updateParam('beam_size', parseInt(e.target.value) || 5)} className={inputClassName} />
                    </FormField>
                    <FormField label={t('transcription.config.temperature')} description={t('transcription.config.paramDesc.temperature')}>
                        <Input type="number" min={0} max={1} step={0.1} value={params.temperature} onChange={(e) => updateParam('temperature', parseFloat(e.target.value) || 0)} className={inputClassName} />
                    </FormField>
                </div>

                <FormField label={t('transcription.config.initialPrompt')} description={t('transcription.config.paramDesc.initial_prompt')} optional>
                    <Textarea
                        placeholder={t('transcription.config.initialPromptPlaceholder')}
                        value={params.initial_prompt || ""}
                        onChange={(e) => updateParam('initial_prompt', e.target.value || undefined)}
                        className={`${inputClassName} resize-none min-h-[80px]`}
                        rows={2}
                    />
                </FormField>

                <SwitchField id="suppress_numerals" label={t('transcription.config.suppressNumerals')} checked={params.suppress_numerals} onCheckedChange={(v) => updateParam('suppress_numerals', v)} />

                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-4">
                    <SwitchField id="no_align" label={t('transcription.config.skipWordAlignment')} checked={params.no_align} onCheckedChange={(v) => updateParam('no_align', v)} />

                    {!params.no_align && (
                        <FormField label={t('transcription.config.alignModel')} description={t('transcription.config.alignModelDesc')} optional>
                            <Input
                                placeholder={t('transcription.config.alignModelPlaceholder')}
                                value={params.align_model || ""}
                                onChange={(e) => updateParam('align_model', e.target.value || undefined)}
                                className={inputClassName}
                            />
                        </FormField>
                    )}
                </div>
            </AdvancedAccordion>
        </div>
    );
}

function ParakeetConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <Section title={t('transcription.config.audioContext')} description={t('transcription.config.audioContextDesc')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <SliderField label={t('transcription.config.leftContext')} value={params.attention_context_left} onValueChange={(v) => updateParam('attention_context_left', v)} min={64} max={512} step={64} />
                    <SliderField label={t('transcription.config.rightContext')} value={params.attention_context_right} onValueChange={(v) => updateParam('attention_context_right', v)} min={64} max={512} step={64} />
                </div>
            </Section>

            {!isMultiTrack && (
                <DiarizationSection id="parakeet_diarize" params={params} updateParam={updateParam} />
            )}
        </div>
    );
}

function CanaryConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <Section title={t('transcription.config.languageSettings')}>
                <SelectField label={t('transcription.config.sourceLanguage')} value={params.language || "en"} onValueChange={(v) => updateParam('language', v)} options={CANARY_LANGUAGES} />
            </Section>

            {!isMultiTrack && (
                <DiarizationSection id="canary_diarize" params={params} updateParam={updateParam} />
            )}
        </div>
    );
}

interface OpenAIConfigProps extends ConfigProps {
    isValidating: boolean;
    validationStatus: 'idle' | 'valid' | 'invalid';
    validationMessage: string;
    availableModels: string[];
    onValidate: () => void;
}

function OpenAIConfig({
    params, updateParam,
    isValidating, validationStatus, validationMessage, availableModels, onValidate
}: OpenAIConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <Section title={t('transcription.config.apiConfiguration')}>
                <div className="space-y-4">
                    <FormField label={t('transcription.config.openaiApiKey')} description={t('transcription.config.openaiApiKeyDesc')}>
                        <div className="flex gap-2">
                            <Input
                                type="password" placeholder="sk-..."
                                value={params.api_key || ""}
                                onChange={(e) => updateParam('api_key', e.target.value)}
                                className={`${inputClassName} flex-1`}
                            />
                            <Button
                                variant="outline" onClick={onValidate} disabled={isValidating}
                                className="shrink-0 rounded-xl border-[var(--border-subtle)] cursor-pointer"
                            >
                                {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : t('transcription.config.validate')}
                            </Button>
                        </div>
                        {validationStatus !== 'idle' && (
                            <div className={`flex items-center gap-2 text-sm mt-2 ${validationStatus === 'valid' ? 'text-[var(--success-solid)]' : 'text-[var(--error)]'}`}>
                                {validationStatus === 'valid' ? <Check className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                <span>{validationMessage}</span>
                            </div>
                        )}
                    </FormField>

                    <SelectField label={t('transcription.config.modelLabel')} value={params.model || "whisper-1"} onValueChange={(v) => updateParam('model', v)} options={availableModels} />
                    <SelectField label={t('transcription.config.language')} value={params.language || "auto"} onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)} options={LANGUAGES} />
                </div>
            </Section>

            {params.model && params.model !== "whisper-1" && (
                <InfoBanner variant="warning" title={t('transcription.config.limitedFeatures')}>
                    {t('transcription.config.limitedFeaturesDesc')}
                </InfoBanner>
            )}
        </div>
    );
}

function VoxtralConfig({ params, updateParam }: ConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <InfoBanner variant="warning" title={t('transcription.config.limitedFeatures')}>
                {t('transcription.config.voxtralLimitedDesc')}
            </InfoBanner>

            <Section title={t('transcription.config.languageSettings')}>
                <SelectField label={t('transcription.config.language')} description={t('transcription.config.languageDesc')} value={params.language || "en"} onValueChange={(v) => updateParam('language', v)} options={LANGUAGES} />
            </Section>

            <AdvancedAccordion>
                <FormField label={t('transcription.config.maxTokens')} description={t('transcription.config.maxTokensDesc')}>
                    <Input
                        type="number" min={1024} max={16384}
                        value={params.max_new_tokens || 8192}
                        onChange={(e) => updateParam('max_new_tokens', parseInt(e.target.value) || 8192)}
                        className={inputClassName}
                    />
                </FormField>
            </AdvancedAccordion>
        </div>
    );
}

function AssemblyAIConfig({ params, updateParam }: ConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <Section title={t('transcription.config.apiConfiguration')}>
                <div className="space-y-4">
                    <FormField
                        label="AssemblyAI API Key"
                        description={t('transcription.config.assemblyaiApiKeyDesc')}
                    >
                        <Input
                            type="password"
                            placeholder={t('transcription.config.apiKeyPlaceholder')}
                            value={params.api_key || ""}
                            onChange={(e) => updateParam('api_key', e.target.value)}
                            className={inputClassName}
                        />
                    </FormField>

                    <SelectField
                        label={t('transcription.config.modelLabel')}
                        description={t('transcription.config.assemblyaiModelDesc')}
                        value={params.model || "universal-2"}
                        onValueChange={(v) => updateParam('model', v)}
                        options={[
                            { value: "universal-2", label: t('transcription.config.universal2') },
                            { value: "universal-3-pro", label: t('transcription.config.universal3pro') },
                        ]}
                    />

                    <SelectField
                        label={t('transcription.config.language')}
                        description={t('transcription.config.assemblyaiLangDesc')}
                        value={params.language || "auto"}
                        onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)}
                        options={LANGUAGES}
                    />

                    <SwitchField
                        id="assemblyai-diarize"
                        label={t('transcription.config.speakerLabels')}
                        checked={params.diarize}
                        onCheckedChange={(v) => updateParam('diarize', v)}
                    />
                </div>
            </Section>

            <InfoBanner variant="info" title={t('transcription.config.cloudTranscription')}>
                {t('transcription.config.assemblyaiCloudDesc')}
            </InfoBanner>
        </div>
    );
}

function DeepgramConfig({ params, updateParam }: ConfigProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-6">
            <Section title={t('transcription.config.apiConfiguration')}>
                <div className="space-y-4">
                    <FormField
                        label="Deepgram API Key"
                        description={t('transcription.config.deepgramApiKeyDesc')}
                    >
                        <Input
                            type="password"
                            placeholder={t('transcription.config.apiKeyPlaceholder')}
                            value={params.api_key || ""}
                            onChange={(e) => updateParam('api_key', e.target.value)}
                            className={inputClassName}
                        />
                    </FormField>

                    <SelectField
                        label={t('transcription.config.modelLabel')}
                        description={t('transcription.config.deepgramModelDesc')}
                        value={params.model || "nova-2"}
                        onValueChange={(v) => updateParam('model', v)}
                        options={[
                            { value: "nova-2",         label: t('transcription.config.nova2') },
                            { value: "nova-2-medical", label: t('transcription.config.nova2medical') },
                            { value: "enhanced",       label: t('transcription.config.enhanced') },
                            { value: "base",           label: t('transcription.config.base') },
                        ]}
                    />

                    <SelectField
                        label={t('transcription.config.language')}
                        description={t('transcription.config.deepgramLangDesc')}
                        value={params.language || "en"}
                        onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)}
                        options={LANGUAGES}
                    />

                    <SwitchField
                        id="deepgram-diarize"
                        label={t('transcription.config.speakerDiarizationLabel')}
                        checked={params.diarize}
                        onCheckedChange={(v) => updateParam('diarize', v)}
                    />
                </div>
            </Section>

            <InfoBanner variant="info" title={t('transcription.config.cloudTranscription')}>
                {t('transcription.config.deepgramCloudDesc')}
            </InfoBanner>
        </div>
    );
}
