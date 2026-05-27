import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
    id: number;
    username: string;
    role: string;
}

function decodeUser(token: string): AuthUser | null {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (!payload.user_id || !payload.username) return null;
        return { id: payload.user_id, username: payload.username, role: payload.role ?? 'user' };
    } catch {
        return null;
    }
}

interface AuthState {
    token: string | null;
    user: AuthUser | null;
    isAuthenticated: boolean;
    requiresRegistration: boolean;
    isInitialized: boolean;
    setToken: (token: string | null) => void;
    setRequiresRegistration: (requires: boolean) => void;
    setInitialized: (initialized: boolean) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            user: null,
            isAuthenticated: false,
            requiresRegistration: false,
            isInitialized: false,
            setToken: (token) => set({
                token,
                user: token ? decodeUser(token) : null,
                isAuthenticated: !!token,
            }),
            setRequiresRegistration: (requires) => set({ requiresRegistration: requires }),
            setInitialized: (initialized) => set({ isInitialized: initialized }),
            logout: () => {
                set({ token: null, user: null, isAuthenticated: false });
                localStorage.removeItem('auth-storage');
            },
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({ token: state.token }),
            onRehydrateStorage: () => (state) => {
                if (state?.token) {
                    state.user = decodeUser(state.token);
                    state.isAuthenticated = true;
                }
            },
        }
    )
);
