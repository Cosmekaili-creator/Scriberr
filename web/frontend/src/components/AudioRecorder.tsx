import { useState, useEffect, useRef } from "react";
import { getSupportedAudioMimeType } from "@/utils/mediaUtils";
import { useTranslation } from "@/i18n";
import WaveSurfer from "wavesurfer.js";
import RecordPlugin from "wavesurfer.js/dist/plugins/record.js";
import {
	Mic,
	Square,
	Play,
	Pause,
	Upload,
	Loader2,
	ChevronDown,
	Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AudioRecorderProps {
	isOpen: boolean;
	onClose: () => void;
	onRecordingComplete: (blob: Blob, title: string) => void;
}

export function AudioRecorder({
	isOpen,
	onClose,
	onRecordingComplete,
}: AudioRecorderProps) {
	const { t } = useTranslation();
	const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
	const [record, setRecord] = useState<RecordPlugin | null>(null);
	const [isRecording, setIsRecording] = useState(false);
	const [isPaused, setIsPaused] = useState(false);
	const [recordingTime, setRecordingTime] = useState(0);
	const [title, setTitle] = useState("");
	const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>(
		[],
	);
	const [selectedDevice, setSelectedDevice] = useState("");
	const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

	const micContainerRef = useRef<HTMLDivElement>(null);

	// Initialize WaveSurfer and RecordPlugin when dialog opens
	useEffect(() => {
		if (!isOpen) return;

		let activeStream: MediaStream | null = null;
		let ws: WaveSurfer | null = null;

		const init = async () => {
			try {
				// 1. Request permission first to ensure device labels are available (Safari/Firefox requirement)
				// We stop this stream immediately after getting permission
				activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });

				// 2. Get devices now that we have permission
				const devices = await RecordPlugin.getAvailableAudioDevices();
				setAvailableDevices(devices);

				// Set default device if none selected
				if (devices.length > 0) {
					// Check if current selected device still exists
					const deviceExists = devices.some(d => d.deviceId === selectedDevice);
					if (!selectedDevice || !deviceExists) {
						setSelectedDevice(devices[0].deviceId);
					}
				}

				// 3. Initialize WaveSurfer
				if (!micContainerRef.current) return;

				ws = WaveSurfer.create({
					container: micContainerRef.current,
					waveColor: "rgb(168, 85, 247)", // purple-500
					progressColor: "rgb(147, 51, 234)", // purple-600
					height: 80,
					normalize: true,
					interact: false,
				});

				setWavesurfer(ws);

				const recordPlugin = ws.registerPlugin(
					RecordPlugin.create({
						renderRecordedAudio: false,
						scrollingWaveform: true,
						continuousWaveform: true,
						continuousWaveformDuration: 30,
						mimeType: getSupportedAudioMimeType() || undefined,
						mediaRecorderTimeslice: 1000,
					}),
				);

				// Handle recording end and progress events
				recordPlugin.on("record-end", (blob: Blob) => {
					setRecordedBlob(blob);
					setIsRecording(false);
					setIsPaused(false);
				});

				recordPlugin.on("record-progress", (time: number) => {
					setRecordingTime(time);
				});

				setRecord(recordPlugin);

			} catch (error) {
				console.error("Failed to initialize recorder:", error);
			} finally {
				// Stop the temporary stream used for permissions
				if (activeStream) {
					activeStream.getTracks().forEach(track => track.stop());
				}
			}
		};

		// Use setTimeout to ensure the DOM element is ready
		const timeoutId = setTimeout(init, 100);

		return () => {
			clearTimeout(timeoutId);
			if (ws) {
				ws.destroy();
			}
			if (activeStream) {
				activeStream.getTracks().forEach(track => track.stop());
			}
		};
	}, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

	// Handle background recording - prevent page unload warnings, keep screen on
	useEffect(() => {
		const originalTitle = document.title;
		let wakeLock: WakeLockSentinel | null = null;

		const acquireWakeLock = async () => {
			if (!('wakeLock' in navigator)) return;
			try {
				wakeLock = await navigator.wakeLock.request('screen');
			} catch {
				// Non-critical — device may not support it or permission denied
			}
		};

		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (isRecording) {
				e.preventDefault();
				e.returnValue =
					"Recording in progress. Are you sure you want to leave?";
				return e.returnValue;
			}
		};

		// Wake lock is released automatically when the page is hidden;
		// re-acquire it when the user comes back to the app.
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				acquireWakeLock();
			}
		};

		if (isRecording) {
			document.title = `🔴 Recording... - ${originalTitle}`;
			window.addEventListener("beforeunload", handleBeforeUnload);
			document.addEventListener("visibilitychange", handleVisibilityChange);
			acquireWakeLock();
		} else {
			document.title = originalTitle;
		}

		return () => {
			document.title = originalTitle;
			window.removeEventListener("beforeunload", handleBeforeUnload);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			wakeLock?.release().catch(() => {});
		};
	}, [isRecording]);

	// Start recording
	const startRecording = async () => {
		if (!record) {
			alert("Recorder not initialized. Please close and reopen the dialog.");
			return;
		}

		try {
			// The Record plugin automatically wraps these options in { audio: ... }
			// So we should pass MediaTrackConstraints directly, NOT MediaStreamConstraints
			// Use 'exact' for deviceId to ensure the specific mic is used
			const constraints: MediaTrackConstraints = {
				deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: true,
				channelCount: 1,
			};

			await record.startRecording(constraints);
			setIsRecording(true);
			setIsPaused(false);
			setRecordingTime(0);
			setRecordedBlob(null);
		} catch (error) {
			console.error("Failed to start recording:", error);
			alert(
				"Failed to start recording. Please check microphone permissions and try again.",
			);
		}
	};

	// Stop recording
	const stopRecording = () => {
		if (!record) return;
		record.stopRecording();
	};

	// Pause/Resume recording
	const togglePauseRecording = () => {
		if (!record) return;

		if (isPaused) {
			record.resumeRecording();
			setIsPaused(false);
		} else {
			record.pauseRecording();
			setIsPaused(true);
		}
	};

	// Format time in mm:ss
	const formatTime = (timeMs: number) => {
		const minutes = Math.floor(timeMs / 60000);
		const seconds = Math.floor((timeMs % 60000) / 1000);
		return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	};

	// Handle upload
	const handleUpload = async () => {
		if (!recordedBlob) return;

		setIsUploading(true);
		try {
			await onRecordingComplete(
				recordedBlob,
				title || `Recording ${new Date().toISOString()}`,
			);
			// Reset state
			setRecordedBlob(null);
			setTitle("");
			setRecordingTime(0);
			onClose();
		} catch (error) {
			console.error("Failed to upload recording:", error);
			alert("Failed to upload recording");
		} finally {
			setIsUploading(false);
		}
	};

	// Perform the actual teardown and close
	const handleClose = () => {
		if (isRecording) {
			stopRecording();
		}
		setRecordedBlob(null);
		setTitle("");
		setRecordingTime(0);
		setIsRecording(false);
		setIsPaused(false);
		onClose();
	};

	// Guard close: show confirm when a recording is in progress
	const requestClose = () => {
		if (isRecording) {
			setShowDiscardConfirm(true);
		} else {
			handleClose();
		}
	};

	return (
		<>
		<AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('recorder.discardTitle')}</AlertDialogTitle>
					<AlertDialogDescription>{t('recorder.discardDescription')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t('recorder.discardCancel')}</AlertDialogCancel>
					<AlertDialogAction onClick={handleClose}>{t('recorder.discardConfirm')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) requestClose(); }}>
			<DialogContent className="sm:max-w-[600px] bg-white dark:bg-carbon-800 border-carbon-200 dark:border-carbon-700">
				<DialogHeader>
					<DialogTitle className="text-carbon-900 dark:text-carbon-100 text-xl font-bold">
						{t('recorder.title')}
					</DialogTitle>
					<DialogDescription className="text-carbon-600 dark:text-carbon-400">
						{t('recorder.description')}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Title Input */}
					<div className="space-y-2">
						<label className="text-sm font-medium text-carbon-700 dark:text-carbon-300">
							{t('recorder.titleLabel')}
						</label>
						<Input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder={t('recorder.titlePlaceholder')}
							className="bg-white dark:bg-carbon-800 border-carbon-300 dark:border-carbon-600 text-carbon-900 dark:text-carbon-100"
							disabled={isRecording}
						/>
					</div>

					{/* Microphone Selection */}
					{availableDevices.length > 1 && (
						<div className="space-y-2">
							<label className="text-sm font-medium text-carbon-700 dark:text-carbon-300">
								{t('recorder.microphone')}
							</label>
							<DropdownMenu>
								<DropdownMenuTrigger asChild disabled={isRecording}>
									<Button
										variant="outline"
										className="w-full justify-between bg-white dark:bg-carbon-800 border-carbon-300 dark:border-carbon-600 hover:bg-carbon-50 dark:hover:bg-carbon-700"
									>
										<div className="flex items-center gap-2">
											<Settings className="h-4 w-4" />
											<span className="truncate">
												{availableDevices.find(
													(d) => d.deviceId === selectedDevice,
												)?.label || `Microphone ${selectedDevice.slice(0, 8)}`}
											</span>
										</div>
										<ChevronDown className="h-4 w-4 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent className="w-full min-w-[400px] bg-white dark:bg-carbon-900 border-carbon-200 dark:border-carbon-700">
									{availableDevices.map((device) => (
										<DropdownMenuItem
											key={device.deviceId}
											onClick={() => setSelectedDevice(device.deviceId)}
											className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-carbon-100 dark:hover:bg-carbon-700"
										>
											<Mic className="h-4 w-4 text-carbon-500" />
											<div className="flex-1">
												<div className="text-sm font-medium text-carbon-900 dark:text-carbon-100">
													{device.label ||
														`Microphone ${device.deviceId.slice(0, 8)}`}
												</div>
												<div className="text-xs text-carbon-500 dark:text-carbon-400">
													Device ID: {device.deviceId.slice(0, 20)}...
												</div>
											</div>
											{selectedDevice === device.deviceId && (
												<div className="h-2 w-2 bg-brand-500 rounded-full"></div>
											)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)}

					{/* Recording Time */}
					<div className="text-center">
						<div className="text-3xl font-mono font-bold text-carbon-900 dark:text-carbon-100 mb-2">
							{formatTime(recordingTime)}
						</div>
						<div className="flex items-center justify-center gap-2 text-sm text-carbon-600 dark:text-carbon-400">
							{isRecording && !isPaused && (
								<div className="h-2 w-2 bg-red-500 rounded-full animate-pulse"></div>
							)}
							<span>
								{isRecording
									? isPaused
										? t('recorder.paused')
										: t('recorder.recording')
									: t('recorder.readyToRecord')}
							</span>
						</div>
						{isRecording && (
							<div className="text-xs text-brand-600 dark:text-brand-400 mt-1">
								{t('recorder.keepScreenOpen')}
							</div>
						)}
					</div>

					{/* Waveform Container */}
					<div className="relative">
						<div
							ref={micContainerRef}
							className="w-full rounded-lg p-4 bg-carbon-50 dark:bg-carbon-800/50 min-h-[120px]"
						/>
						{!isRecording && !recordedBlob && (
							<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
								<div className="text-carbon-400 dark:text-carbon-500 text-sm text-center">
									<Mic className="h-8 w-8 mx-auto mb-2 opacity-50" />
									<div>{t('recorder.waveformHint')}</div>
									{!wavesurfer && (
										<div className="text-xs text-red-400 mt-1">
											{t('recorder.initializing')}
										</div>
									)}
									{wavesurfer && !record && (
										<div className="text-xs text-yellow-400 mt-1">
											{t('recorder.pluginLoading')}
										</div>
									)}
									{wavesurfer && record && (
										<div className="text-xs text-green-400 mt-1">
											{t('recorder.ready')}
										</div>
									)}
								</div>
							</div>
						)}
					</div>

					{/* Recording Controls */}
					<div className="flex justify-center gap-4">
						{!isRecording && !recordedBlob && (
							<Button
								onClick={startRecording}
								size="lg"
								className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-xl font-medium transition-all duration-300 hover:scale-105"
							>
								<Mic className="h-5 w-5 mr-2" />
								{t('recorder.start')}
							</Button>
						)}

						{isRecording && (
							<>
								<Button
									onClick={togglePauseRecording}
									size="lg"
									variant="outline"
									className="border-carbon-300 dark:border-carbon-600 hover:bg-carbon-100 dark:hover:bg-carbon-700 px-6 py-3 rounded-xl"
								>
									{isPaused ? (
										<>
											<Play className="h-5 w-5 mr-2" />
											{t('recorder.resume')}
										</>
									) : (
										<>
											<Pause className="h-5 w-5 mr-2" />
											{t('recorder.pause')}
										</>
									)}
								</Button>
								<Button
									onClick={stopRecording}
									size="lg"
									className="bg-carbon-600 hover:bg-carbon-700 text-white px-6 py-3 rounded-xl"
								>
									<Square className="h-5 w-5 mr-2" />
									{t('recorder.stop')}
								</Button>
							</>
						)}

						{recordedBlob && (
							<Button
								onClick={handleUpload}
								size="lg"
								disabled={isUploading}
								className="bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-medium transition-all duration-300 hover:scale-105"
							>
								{isUploading ? (
									<>
										<Loader2 className="h-5 w-5 mr-2 animate-spin" />
										{t('recorder.uploading')}
									</>
								) : (
									<>
										<Upload className="h-5 w-5 mr-2" />
										{t('recorder.upload')}
									</>
								)}
							</Button>
						)}
					</div>

					{recordedBlob && (
						<div className="text-center text-sm text-green-600 dark:text-green-400">
							{t('recorder.completed')}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
		</>
	);
}
