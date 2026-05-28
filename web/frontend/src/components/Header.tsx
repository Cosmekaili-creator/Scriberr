import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Upload, Settings, LogOut, Home, Plus, Grip, Zap, Video, Users, MonitorSpeaker, FolderOpen, Radio } from "lucide-react";
import { AScribeLogo } from "./AScribeLogo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { AudioRecorder } from "./AudioRecorder";
import { SystemAudioRecorder } from "./SystemAudioRecorder";
import { RealtimeRecorderDialog } from "@/features/transcription/realtime/RealtimeRecorderDialog";
import { QuickTranscriptionDialog } from "@/features/transcription/components/QuickTranscriptionDialog";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { isVideoFile, isAudioFile } from "../utils/fileProcessor";
import { useGlobalUpload } from "@/contexts/GlobalUploadContext";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";

interface FileWithType {
	file: File;
	isVideo: boolean;
}

interface HeaderProps {
	onFileSelect?: (files: File | File[] | FileWithType | FileWithType[]) => void;
	onMultiTrackClick?: () => void;
}

export function Header({ onFileSelect, onMultiTrackClick }: HeaderProps) {
	const navigate = useNavigate();
	const { logout, isAdmin, getAuthHeaders } = useAuth();
	const { t } = useTranslation();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const videoFileInputRef = useRef<HTMLInputElement>(null);
	const [isRecorderOpen, setIsRecorderOpen] = useState(false);
	const [isRealtimeRecorderOpen, setIsRealtimeRecorderOpen] = useState(false);
	const [isSystemRecorderOpen, setIsSystemRecorderOpen] = useState(false);
	const [isQuickTranscriptionOpen, setIsQuickTranscriptionOpen] = useState(false);
	// Detect real-time provider from the user's default profile.
	const { data: defaultProfile } = useQuery({
		queryKey: ['user', 'default-profile'],
		queryFn: async () => {
			const resp = await fetch('/api/v1/user/default-profile', {
				headers: getAuthHeaders(),
			});
			if (!resp.ok) return null;
			return resp.json();
		},
		staleTime: 60_000,
	});

	const realtimeProvider: 'assemblyai' | 'deepgram' | null = (() => {
		const family = (defaultProfile as { parameters?: { model_family?: string } } | null)?.parameters?.model_family;
		if (family === 'assemblyai') return 'assemblyai';
		if (family === 'deepgram') return 'deepgram';
		return null;
	})();

	// Use global upload context as fallback when props are not provided
	const globalUpload = useGlobalUpload();

	// Determine which handlers to use (prop or global context)
	const effectiveFileSelect = onFileSelect ?? globalUpload.handleFileSelect;
	const effectiveMultiTrackClick = onMultiTrackClick ?? globalUpload.openMultiTrackDialog;
	const effectiveRecordingComplete = globalUpload.handleRecordingComplete;

	const handleUploadClick = () => {
		fileInputRef.current?.click();
	};

	const handleVideoUploadClick = () => {
		videoFileInputRef.current?.click();
	};

	const handleSystemRecordClick = () => {
		setIsSystemRecorderOpen(true);
	};

	const handleQuickTranscriptionClick = () => {
		setIsQuickTranscriptionOpen(true);
	};

	const handleMultiTrackClick = () => {
		effectiveMultiTrackClick();
	};

	const handleSettingsClick = () => {
		navigate("/settings");
	};

	const handleAdminClick = () => {
		navigate("/admin/users");
	};

	const handleLogout = () => {
		logout();
	};

	const handleHomeClick = () => {
		navigate("/");
	};

	const handleCollectionsClick = () => {
		navigate("/collections");
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (files && files.length > 0) {
			const fileArray = Array.from(files);

			// Check for video files that were incorrectly uploaded via audio upload
			const videoFiles = fileArray.filter(file => isVideoFile(file));
			if (videoFiles.length > 0) {
				alert(t('header.videoFilesError'));
				event.target.value = "";
				return;
			}

			// Filter to only audio files
			const audioFiles = fileArray.filter(file => isAudioFile(file));
			if (audioFiles.length > 0) {
				effectiveFileSelect(audioFiles.length === 1 ? audioFiles[0] : audioFiles);
				// Reset the input so the same files can be selected again
				event.target.value = "";
			} else {
				// No valid audio files found
				alert(t('header.audioFilesError'));
				event.target.value = "";
			}
		}
	};

	const handleVideoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (files && files.length > 0) {
			// Filter to only video files
			const videoFiles = Array.from(files).filter(file => file.type.startsWith("video/"));
			if (videoFiles.length > 0) {
				// Pass video files with type marker
				const filesWithType: FileWithType[] = videoFiles.map(file => ({ file, isVideo: true }));
				effectiveFileSelect(filesWithType.length === 1 ? filesWithType[0] : filesWithType);
				// Reset the input so the same files can be selected again
				event.target.value = "";
			}
		}
	};

	const handleRecordingComplete = async (blob: Blob, title: string) => {
		// Use global recording complete handler
		await effectiveRecordingComplete(blob, title);
	};


	return (
		<header className="sticky top-4 sm:top-6 z-50 glass rounded-[var(--radius-card)] px-4 py-3 sm:px-6 sm:py-4 transition-all duration-500 shadow-[var(--shadow-float)] border border-[var(--border-subtle)]">
			<div className="flex items-center justify-between">
				{/* Left side - Logo navigates home */}
				<AScribeLogo onClick={handleHomeClick} />

				{/* Right side - Live button, Plus (Add Audio), Grip Menu, Theme Switcher */}
				<div className="flex items-center gap-2 sm:gap-3">
					{/* Transcription en direct — primary action, shown when a realtime provider is configured */}
					{realtimeProvider && (
						<Button
							onClick={() => setIsRealtimeRecorderOpen(true)}
							variant="default"
							size="icon"
							className="bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-[0_4px_12px_rgba(16,185,129,0.4)] hover:shadow-[0_6px_16px_rgba(16,185,129,0.5)] border-none h-8 w-8 sm:h-10 sm:w-10 rounded-lg transition-all hover:scale-105 active:scale-95 cursor-pointer"
						>
							<Radio className="h-4 w-4 sm:h-5 sm:w-5" />
							<span className="sr-only">{t('header.liveTranscription')}</span>
						</Button>
					)}

					{/* Add Audio (+) */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="default"
								size="icon"
								className="bg-gradient-to-br from-[#FFAB40] to-[#FF3D00] text-white shadow-[0_4px_12px_rgba(255,61,0,0.4)] hover:shadow-[0_6px_16px_rgba(255,61,0,0.5)] border-none h-8 w-8 sm:h-10 sm:w-10 rounded-lg transition-all hover:scale-105 active:scale-95 cursor-pointer"
							>
								<Plus className="h-5 w-5 sm:h-6 sm:w-6" />
								<span className="sr-only">{t('header.addAudio')}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="w-64 glass-card p-2 rounded-[var(--radius-card)] shadow-[var(--shadow-float)] border-[var(--border-subtle)]"
						>
							{/* 1. Transcription rapide */}
							<DropdownMenuItem
								onClick={handleQuickTranscriptionClick}
								className="group flex items-center gap-3 px-3 py-3 cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)] transition-colors"
							>
								<div className="p-2 bg-amber-500/10 rounded-[var(--radius-btn)] text-amber-600 group-focus:text-[var(--brand-solid)]">
									<Zap className="h-4 w-4" />
								</div>
								<div>
									<div className="font-medium text-sm">{t('header.quickTranscribe')}</div>
									<div className="text-xs text-[var(--text-secondary)]">
										{t('header.quickTranscribeDesc')}
									</div>
								</div>
							</DropdownMenuItem>

							{/* 2. Enregistrer l'audio du système */}
							<DropdownMenuItem
								onClick={handleSystemRecordClick}
								className="group flex items-center gap-3 px-3 py-3 cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)] transition-colors"
							>
								<div className="p-2 bg-blue-500/10 rounded-[var(--radius-btn)] text-blue-600 group-focus:text-[var(--brand-solid)]">
									<MonitorSpeaker className="h-4 w-4" />
								</div>
								<div>
									<div className="font-medium text-sm">{t('header.recordSystemAudio')}</div>
									<div className="text-xs text-[var(--text-secondary)]">
										{t('header.recordSystemAudioDesc')}
									</div>
								</div>
							</DropdownMenuItem>

							{/* 3. Téléverser — section label + flat items */}
							<DropdownMenuSeparator className="my-1 bg-[var(--border-subtle)]" />
							<DropdownMenuLabel className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
								{t('header.upload')}
							</DropdownMenuLabel>
							<DropdownMenuItem
								onClick={handleUploadClick}
								className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)] transition-colors"
							>
								<div className="p-2 bg-[var(--brand-light)] rounded-[var(--radius-btn)] text-[var(--brand-solid)]">
									<Upload className="h-4 w-4" />
								</div>
								<div className="font-medium text-sm">{t('header.uploadFiles')}</div>
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={handleVideoUploadClick}
								className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)] transition-colors"
							>
								<div className="p-2 bg-purple-500/10 rounded-[var(--radius-btn)] text-purple-600">
									<Video className="h-4 w-4" />
								</div>
								<div className="font-medium text-sm">{t('header.uploadVideos')}</div>
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={handleMultiTrackClick}
								className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)] transition-colors"
							>
								<div className="p-2 bg-indigo-500/10 rounded-[var(--radius-btn)] text-indigo-600">
									<Users className="h-4 w-4" />
								</div>
								<div className="font-medium text-sm">{t('header.uploadTracks')}</div>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Main Menu (Grip) */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 sm:h-10 sm:w-10 hover:bg-[var(--secondary)] rounded-[var(--radius-btn)] cursor-pointer text-[var(--text-secondary)]"
							>
								<Grip className="h-4 w-4 sm:h-5 sm:w-5" />
								<span className="sr-only">{t('header.openMenu')}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48 glass-card border-[var(--border-subtle)] p-2 rounded-[var(--radius-card)] shadow-[var(--shadow-float)]">
							<DropdownMenuItem onClick={handleHomeClick} className="cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--secondary)] py-2.5">
								<Home className="h-4 w-4 mr-2" />
								{t('header.home')}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={handleCollectionsClick} className="cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--secondary)] py-2.5">
								<FolderOpen className="h-4 w-4 mr-2" />
								{t('collections.title')}
							</DropdownMenuItem>
							{isAdmin && (
								<DropdownMenuItem onClick={handleSettingsClick} className="cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--secondary)] py-2.5">
									<Settings className="h-4 w-4 mr-2" />
									{t('header.settings')}
								</DropdownMenuItem>
							)}
							{isAdmin && (
								<DropdownMenuItem onClick={handleAdminClick} className="cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--secondary)] py-2.5">
									<Users className="h-4 w-4 mr-2" />
									{t('header.adminUsers')}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onClick={handleLogout} className="cursor-pointer rounded-[var(--radius-btn)] focus:bg-[var(--error)]/10 text-[var(--error)] py-2.5">
								<LogOut className="h-4 w-4 mr-2" />
								{t('header.logout')}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Theme Switcher (icon-only) */}
					<ThemeSwitcher />

					{/* Hidden file input */}
					<input
						ref={fileInputRef}
						type="file"
						accept="audio/*"
						multiple
						onChange={handleFileChange}
						className="hidden"
					/>

					{/* Hidden video file input */}
					<input
						ref={videoFileInputRef}
						type="file"
						accept="video/*"
						multiple
						onChange={handleVideoFileChange}
						className="hidden"
					/>
				</div>
			</div>

			{/* Audio Recorder Dialog (local models) */}
			<AudioRecorder
				isOpen={isRecorderOpen}
				onClose={() => setIsRecorderOpen(false)}
				onRecordingComplete={handleRecordingComplete}
			/>

			{/* Real-time Recorder Dialog (AssemblyAI / Deepgram) */}
			{realtimeProvider && (
				<RealtimeRecorderDialog
					isOpen={isRealtimeRecorderOpen}
					onClose={() => setIsRealtimeRecorderOpen(false)}
					provider={realtimeProvider}
				/>
			)}

			{/* System Audio Recorder Dialog */}
			<SystemAudioRecorder
				isOpen={isSystemRecorderOpen}
				onClose={() => setIsSystemRecorderOpen(false)}
				onRecordingComplete={effectiveRecordingComplete}
			/>

			{/* Quick Transcription Dialog */}
			<QuickTranscriptionDialog
				isOpen={isQuickTranscriptionOpen}
				onClose={() => setIsQuickTranscriptionOpen(false)}
			/>

		</header>
	);
}
