import { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { Play, Pause, AlertCircle } from "lucide-react";
import { AudioVisualizer } from "./AudioVisualizer";
import { cn } from "@/lib/utils";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export interface EmberPlayerRef {
    seekTo: (time: number) => void;
    playPause: () => void;
    isPlaying: () => boolean;
}

export interface EmberPlayerProps {
    src?: string;
    audioId?: string;
    className?: string;
    onTimeUpdate?: (time: number) => void;
    onPlayStateChange?: (isPlaying: boolean) => void;
}

export const EmberPlayer = forwardRef<EmberPlayerRef, EmberPlayerProps>(
    ({ src, audioId, className, onTimeUpdate, onPlayStateChange }, ref) => {
        const audioRef = useRef<HTMLAudioElement>(null);
        const progressRef = useRef<HTMLDivElement>(null);

        const [isPlaying, setIsPlaying] = useState(false);
        const [currentTime, setCurrentTime] = useState(0);
        const [duration, setDuration] = useState(0);
        const [error, setError] = useState<string | null>(null);
        const [playbackSpeed, setPlaybackSpeed] = useState(1);
        const [showSpeedMenu, setShowSpeedMenu] = useState(false);

        // Visualizer Interaction State
        const [hoverTime, setHoverTime] = useState(0);
        const [isHovering, setIsHovering] = useState(false);
        const [isDragging, setIsDragging] = useState(false);

        // --- 1. Parent Control (ForwardRef) ---
        useImperativeHandle(ref, () => ({
            seekTo: (time: number) => {
                if (!Number.isFinite(time) || time < 0) return;
                if (audioRef.current) {
                    audioRef.current.currentTime = time;
                    setCurrentTime(time);
                }
            },
            playPause: () => togglePlay(),
            isPlaying: () => isPlaying
        }));

        // --- 2. URL Logic ---
        let streamUrl = src;
        if (!streamUrl && audioId) {
            streamUrl = `/api/v1/transcription/${audioId}/audio`;
        }

        // --- 3. Audio Handlers ---
        const togglePlay = () => {
            if (!audioRef.current) return;
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play().catch(e => {
                    console.error("Playback failed:", e);
                    setError("Playback failed.");
                });
            }
        };

        const handleTimeUpdate = () => {
            if (audioRef.current && !isDragging) {
                const time = audioRef.current.currentTime;
                setCurrentTime(time);
                onTimeUpdate?.(time);
            }
        };

        const handleLoadedMetadata = () => {
            if (audioRef.current) {
                setDuration(audioRef.current.duration);
                setError(null);
            }
        };

        const handleSpeedChange = (speed: number) => {
            setPlaybackSpeed(speed);
            setShowSpeedMenu(false);
            if (audioRef.current) {
                audioRef.current.playbackRate = speed;
            }
        };

        // --- 4. Advanced Scrubber Logic ---
        const calculateTimeFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
            if (!progressRef.current || !duration) return 0;
            const rect = progressRef.current.getBoundingClientRect();
            let x = e.clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            return (x / rect.width) * duration;
        }, [duration]);

        const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
            setIsDragging(true);
            const time = calculateTimeFromEvent(e);
            if (audioRef.current && Number.isFinite(time) && time >= 0) {
                audioRef.current.currentTime = time;
                setCurrentTime(time);
            }
        };

        // Global mouse listeners for dragging outside the component
        useEffect(() => {
            const handleGlobalMouseMove = (e: MouseEvent) => {
                if (isDragging && audioRef.current && progressRef.current) {
                    const time = calculateTimeFromEvent(e);
                    if (Number.isFinite(time) && time >= 0) {
                        audioRef.current.currentTime = time;
                        setCurrentTime(time);
                    }
                }
            };

            const handleGlobalMouseUp = () => {
                setIsDragging(false);
            };

            if (isDragging) {
                window.addEventListener("mousemove", handleGlobalMouseMove);
                window.addEventListener("mouseup", handleGlobalMouseUp);
            }

            return () => {
                window.removeEventListener("mousemove", handleGlobalMouseMove);
                window.removeEventListener("mouseup", handleGlobalMouseUp);
            };
        }, [isDragging, calculateTimeFromEvent]);

        useEffect(() => {
            if (!showSpeedMenu) return;
            const close = () => setShowSpeedMenu(false);
            window.addEventListener("click", close);
            return () => window.removeEventListener("click", close);
        }, [showSpeedMenu]);

        const handleHoverMove = (e: React.MouseEvent<HTMLDivElement>) => {
            if (!progressRef.current || !duration) return;
            const rect = progressRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = Math.min(Math.max(0, x / rect.width), 1);
            setHoverTime(percent * duration);
        };

        // Sync State
        useEffect(() => {
            onPlayStateChange?.(isPlaying);
        }, [isPlaying, onPlayStateChange]);


        const formatTime = (time: number) => {
            if (isNaN(time)) return "00:00";
            const min = Math.floor(time / 60);
            const sec = Math.floor(time % 60);
            return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
        };

        const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
        const hoverPercent = duration > 0 ? hoverTime / duration : 0;

        if (error) {
            return (
                <div className="w-full h-32 flex items-center justify-center text-[var(--error)] bg-[var(--error)]/10 rounded-[var(--radius-card)] border border-[var(--error)]/20">
                    <AlertCircle className="w-5 h-5 mr-2" />
                    {error}
                </div>
            );
        }

        return (
            <div
                className={cn(
                    "relative w-full rounded-[var(--radius-card)] bg-transparent",
                    className
                )}
            >
                {/* Visualizer Layer — clipped independently so dropdown can escape */}
                <div className="absolute inset-0 z-0 h-full w-full pointer-events-none opacity-40 overflow-hidden rounded-[var(--radius-card)]">
                    <AudioVisualizer
                        audioRef={audioRef}
                        isPlaying={isPlaying}
                        isHovering={isHovering}
                        hoverPercent={hoverPercent}
                    />
                </div>

                {/* Controls Layer */}
                <div className="relative z-10 flex flex-col px-1 py-1 gap-3">
                    {/* Top Row: [Play + Speed] ... [Time] */}
                    <div className="flex items-center justify-between">
                        {/* Left cluster: play button + speed pill */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={togglePlay}
                                className="flex h-12 w-12 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-white shadow-lg shadow-orange-500/20 hover:scale-105 active:scale-95 transition-all focus:outline-none cursor-pointer"
                            >
                                {isPlaying ? (
                                    <Pause size={20} fill="currentColor" />
                                ) : (
                                    <Play size={20} fill="currentColor" className="ml-0.5" />
                                )}
                            </button>

                            {/* Speed selector — pill button style */}
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(v => !v); }}
                                    className={cn(
                                        "h-8 px-3 rounded-full border text-xs font-mono font-semibold transition-all cursor-pointer",
                                        playbackSpeed !== 1
                                            ? "bg-[image:var(--brand-gradient)] text-white border-transparent shadow-sm"
                                            : "bg-[var(--secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-main)]"
                                    )}
                                    title="Playback speed"
                                >
                                    {playbackSpeed}×
                                </button>
                                {showSpeedMenu && (
                                    <div
                                        className="absolute top-full mt-1 left-0 z-50 min-w-[80px] bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl shadow-[var(--shadow-float)] overflow-hidden"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {SPEED_OPTIONS.map(speed => (
                                            <button
                                                key={speed}
                                                onClick={() => handleSpeedChange(speed)}
                                                className={cn(
                                                    "block w-full px-4 py-2 text-left text-xs font-mono hover:bg-[var(--secondary)] transition-colors cursor-pointer",
                                                    speed === playbackSpeed
                                                        ? "text-[var(--brand-solid)] font-bold bg-[var(--brand-light)]"
                                                        : "text-[var(--text-primary)]"
                                                )}
                                            >
                                                {speed}×
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col items-end">
                            <span className="font-mono text-xs font-medium text-[var(--text-secondary)] tabular-nums tracking-wide">
                                {formatTime(currentTime)}{" "}
                                <span className="text-[var(--text-tertiary)] mx-0.5">/</span>{" "}
                                <span className="text-[var(--text-tertiary)]">
                                    {formatTime(duration)}
                                </span>
                            </span>
                            <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-0.5 opacity-80">
                                {isPlaying ? "Playing" : "Ready"}
                            </span>
                        </div>
                    </div>

                    {/* Bottom Row: Interactive Scrubber */}
                    <div
                        ref={progressRef}
                        className="relative w-full h-5 flex items-center group cursor-pointer mt-1"
                        onMouseMove={handleHoverMove}
                        onMouseEnter={() => setIsHovering(true)}
                        onMouseLeave={() => setIsHovering(false)}
                        onMouseDown={handleScrubberMouseDown}
                    >
                        {/* Tooltip */}
                        <div
                            className={cn(
                                "absolute bottom-full mb-3 px-2 py-1 rounded bg-[var(--text-primary)] text-[10px] font-mono text-[var(--bg-main)] shadow-sm pointer-events-none transition-opacity duration-200 z-30",
                                isHovering ? "opacity-100" : "opacity-0"
                            )}
                            style={{
                                left: `${duration > 0 ? (hoverTime / duration) * 100 : 0}%`,
                                transform: "translateX(-50%)",
                            }}
                        >
                            {formatTime(hoverTime)}
                        </div>

                        {/* Track Background - Darker for visibility on white */}
                        <div className="absolute w-full h-[4px] bg-[var(--border-focus)] rounded-full overflow-hidden group-hover:h-[6px] transition-all">
                            {/* Progress Fill */}
                            <div
                                className="h-full bg-[image:var(--brand-gradient)] shadow-sm transition-all duration-100 ease-linear"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        {/* Thumb Indicator - White with Shadow, visible on track */}
                        <div
                            className={cn(
                                "absolute h-3.5 w-3.5 bg-white border border-[var(--border-subtle)] rounded-full shadow-md ml-[-7px] pointer-events-none transition-all duration-100 ease-linear",
                                isHovering || isDragging
                                    ? "scale-100 opacity-100"
                                    : "scale-0 opacity-0"
                            )}
                            style={{ left: `${progressPercent}%` }}
                        />
                    </div>
                </div>

                {/* Hidden Audio Element */}
                <audio
                    ref={audioRef}
                    src={streamUrl}
                    preload="metadata"
                    crossOrigin="use-credentials" // Sends cookies AND allows Web Audio API access (with backend support)
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                    onError={(e) => {
                        console.error("Audio Load Error", e);
                        setError("Unable to load audio stream.");
                    }}
                />
            </div>
        );
    }
);

EmberPlayer.displayName = "EmberPlayer";
