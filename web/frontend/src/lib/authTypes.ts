declare global {
    interface Window {
        __ascribe_original_fetch?: typeof window.fetch;
    }
}

export {};
