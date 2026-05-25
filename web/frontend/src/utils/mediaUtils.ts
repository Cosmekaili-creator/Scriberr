// MIME type candidates in preference order.
// 'audio/webm;codecs=opus' is ideal on Chrome/Firefox desktop.
// 'audio/mp4' is the iOS Safari / Chrome on iOS fallback.
const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
];

/**
 * Returns the best supported MIME type for MediaRecorder in the current browser.
 * Returns an empty string if none of the candidates are supported
 * (the browser will then pick its own default).
 */
export function getSupportedAudioMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

/**
 * Derives a safe file extension from a blob's MIME type.
 */
export function extensionFromMimeType(mimeType: string): string {
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
}
