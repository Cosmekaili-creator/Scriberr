/**
 * RealtimeRecorderDialog — records microphone audio while streaming it to the
 * server in real time (AssemblyAI / Deepgram).
 *
 * Audio is simultaneously:
 *   • buffered locally via MediaRecorder (for the final upload)
 *   • streamed as PCM-16 16 kHz frames via AudioWorklet → WebSocket
 *
 * On Stop:
 *   1. MediaRecorder.stop() → gathers the complete blob
 *   2. useRealtimeStream.stop() → closes the audio pipeline + WS
 *   3. useRealtimeStream.finalize(blob) → uploads the audio file
 *   4. Navigate to the audio detail view
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Square, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js';
import { getSupportedAudioMimeType } from '@/utils/mediaUtils';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeStream } from './useRealtimeStream';
import { LiveTranscriptPanel } from './LiveTranscriptPanel';

interface RealtimeRecorderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  provider: 'assemblyai' | 'deepgram';
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sRem = s % 60;
  return `${m}:${String(sRem).padStart(2, '0')}`;
}

export function RealtimeRecorderDialog({
  isOpen,
  onClose,
  provider,
}: RealtimeRecorderDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getAuthHeaders, isAuthenticated } = useAuth();

  // Fetch the user's default profile to inherit language and diarize settings.
  // Uses the same query key as GlobalUploadContext → shared TanStack Query cache.
  const { data: defaultProfile } = useQuery<{ parameters?: Record<string, unknown> } | null>({
    queryKey: ['user', 'default-profile'],
    queryFn: async () => {
      const resp = await fetch('/api/v1/user/default-profile', { headers: getAuthHeaders() });
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
  const profileLanguage = (defaultProfile?.parameters?.language as string | undefined) ?? '';
  // Read diarize from the user's profile so a solo-speaker profile (diarize=false)
  // doesn't trigger false multi-speaker detection in the live stream.
  // Default to true (useful for multi-person meetings) when the profile has no opinion.
  const profileDiarize = defaultProfile?.parameters?.diarize !== false;

  const [title, setTitle] = useState('');
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Live speaker renaming.
  // speakerInputs: what the user has typed (not yet confirmed).
  // speakerNames:  confirmed names applied to the live transcript display.
  const [speakerInputs, setSpeakerInputs] = useState<Record<string, string>>({});
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const {
    status,
    jobId,
    segments,
    partial,
    speakers,
    error,
    start: startStream,
    stop: stopStream,
    finalize,
  } = useRealtimeStream();

  const isRecording = status === 'streaming' || status === 'starting';
  const isStopping = status === 'stopping';

  // Enumerate audio devices when dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    RecordPlugin.getAvailableAudioDevices().then((devices) => {
      setAvailableDevices(devices);
      if (devices.length > 0 && !selectedDevice) {
        setSelectedDevice(devices[0].deviceId);
      }
    });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on close.
  useEffect(() => {
    if (!isOpen) {
      stopAll();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recording timer.
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 100), 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const stopAll = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const handleStart = async () => {
    chunksRef.current = [];
    setRecordingTime(0);
    setSpeakerInputs({});
    setSpeakerNames({});

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      // Set up MediaRecorder but do NOT start it yet.
      // We start it only after the WS + AudioWorklet are ready so that
      // MediaRecorder and Deepgram both begin capturing at exactly the same
      // moment — preventing the "first sentence cut" where the user's opening
      // words fall in the ~1 s gap before the worklet is loaded.
      const mimeType = getSupportedAudioMimeType() || 'audio/webm;codecs=opus';
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Open the WS + load AudioWorklet.  After this resolves the "En direct"
      // indicator is visible and audio is already flowing to the provider.
      await startStream(stream, {
        provider,
        language: profileLanguage,
        diarize: profileDiarize,
        title: title || undefined,
      });

      // Start recording AFTER the stream is live — both Deepgram and the local
      // buffer now start from exactly the same audio moment.
      mr.start(1000); // 1 s timeslices
    } catch (err) {
      console.error('RealtimeRecorder: start failed', err);
    }
  };

  const handleStop = async () => {
    // 1. Stop MediaRecorder and collect the blob.
    const blob = await new Promise<Blob>((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === 'inactive') {
        resolve(new Blob(chunksRef.current));
        return;
      }
      mr.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: mr.mimeType }));
      };
      mr.stop();
    });

    // 2. Close the audio pipeline + WS.
    await stopStream();
    stopAll();

    // 3. Upload the recorded blob.
    if (!blob.size) return;
    setIsUploading(true);
    try {
      await finalize(blob);

      // 4. Persist any confirmed speaker names.
      const currentJobId = jobId; // capture before async gaps
      const mappings = Object.entries(speakerNames)
        .filter(([, name]) => name.trim())
        .map(([original_speaker, custom_name]) => ({ original_speaker, custom_name: custom_name.trim() }));
      if (mappings.length > 0 && currentJobId) {
        await fetch(`/api/v1/transcription/${currentJobId}/speakers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ mappings }),
        }).catch(() => { /* non-fatal — user can rename later */ });
      }

      if (currentJobId) {
        onClose();
        navigate(`/audio/${currentJobId}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isRecording && !isStopping) onClose();
  };

  const providerLabel = provider === 'assemblyai' ? 'AssemblyAI' : 'Deepgram';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg glass-card border-[var(--border-subtle)]">
        <DialogHeader>
          <DialogTitle>{t('realtime.recorder.title')}</DialogTitle>
          <DialogDescription>
            {t('realtime.recorder.description')}{' '}
            <span className="font-medium text-[var(--brand-solid)]">{providerLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Title input */}
          <Input
            placeholder={t('recorder.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isRecording || isStopping}
          />

          {/* Microphone selector */}
          {availableDevices.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full min-w-0 justify-between"
                  disabled={isRecording || isStopping}
                >
                  <span className="truncate">
                    {availableDevices.find((d) => d.deviceId === selectedDevice)?.label ||
                      t('recorder.defaultMic')}
                  </span>
                  <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {availableDevices.map((device) => (
                  <DropdownMenuItem
                    key={device.deviceId}
                    onClick={() => setSelectedDevice(device.deviceId)}
                  >
                    {device.label || device.deviceId}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Status bar */}
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            {status === 'starting' && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-solid)]" />
                <span>
                  {t('realtime.status.starting').replace('{provider}', providerLabel)}
                </span>
              </>
            )}
            {status === 'streaming' && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="font-medium text-red-500">{t('realtime.status.streaming')}</span>
                <span className="ml-1 tabular-nums">{formatDuration(recordingTime)}</span>
              </>
            )}
            {status === 'stopping' && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('realtime.status.stopping')}</span>
              </>
            )}
            {status === 'ended' && (
              <span className="text-emerald-600">{t('realtime.status.ended')}</span>
            )}
            {status === 'error' && error && (
              <span className="text-red-500">
                {t('realtime.error.providerFailed').replace('{error}', error)}
              </span>
            )}
          </div>

          {/* Live transcript panel — shown when recording */}
          {(isRecording || status === 'ended' || status === 'stopping') && (
            <LiveTranscriptPanel
              segments={segments}
              partial={partial}
              speakers={speakers}
              speakerNames={speakerNames}
            />
          )}

          {/* Inline speaker rename — one row per detected speaker */}
          {speakers.length > 0 && (isRecording || status === 'ended' || status === 'stopping') && (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                {t('realtime.speakers.detected')}
              </p>
              {speakers.map((original, idx) => (
                <div key={original} className="flex items-center gap-2">
                  {/* Speaker number pill */}
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--brand-light)] text-[var(--brand-solid)] shrink-0 min-w-[5rem] text-center">
                    {t('realtime.speakers.label').replace('{n}', String(idx + 1))}
                  </span>
                  {/* Name input */}
                  <Input
                    className="h-7 text-sm flex-1"
                    placeholder={speakerNames[original] || t('realtime.speakers.inputPlaceholder')}
                    value={speakerInputs[original] ?? ''}
                    onChange={(e) =>
                      setSpeakerInputs((prev) => ({ ...prev, [original]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const name = (speakerInputs[original] ?? '').trim();
                        if (name) setSpeakerNames((prev) => ({ ...prev, [original]: name }));
                      }
                    }}
                  />
                  {/* Rename button */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs shrink-0 px-2"
                    onClick={() => {
                      const name = (speakerInputs[original] ?? '').trim();
                      if (name) setSpeakerNames((prev) => ({ ...prev, [original]: name }));
                    }}
                  >
                    {t('realtime.speakers.rename')}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            {!isRecording && !isStopping && status !== 'ended' && (
              <Button
                onClick={handleStart}
                className="bg-gradient-to-br from-[#FFAB40] to-[#FF3D00] text-white border-none hover:opacity-90"
              >
                <Mic className="h-4 w-4 mr-2" />
                {t('recorder.start')}
              </Button>
            )}

            {(isRecording || status === 'stopping') && (
              <Button
                onClick={handleStop}
                disabled={isStopping || isUploading}
                variant="destructive"
              >
                {isStopping || isUploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Square className="h-4 w-4 mr-2" />
                )}
                {t('recorder.stop')}
              </Button>
            )}

            {!isRecording && !isStopping && (
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
