import { useEffect } from 'react';

const SHARE_CACHE = 'shared-audio-v1';

export function useSharedAudio(onFile: (file: File) => void) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('share') !== 'pending') return;

    window.history.replaceState({}, '', window.location.pathname);
    if (!('caches' in window)) return;

    caches.open(SHARE_CACHE).then(async (cache) => {
      const response = await cache.match('pending-share');
      if (!response) return;
      await cache.delete('pending-share');
      const blob = await response.blob();
      const name = decodeURIComponent(response.headers.get('X-File-Name') || 'recording.m4a');
      const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
      onFile(file);
    });
  }, []); // run once on mount
}
