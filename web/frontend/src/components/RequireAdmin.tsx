import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/hooks/useAuth";

interface RequireAdminProps {
    children: ReactNode;
}

export function RequireAdmin({ children }: RequireAdminProps) {
    const { isAdmin, isInitialized } = useAuth();

    if (!isInitialized) return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-solid)]" />
        </div>
    );

    if (!isAdmin) return <Navigate to="/" replace />;

    return <>{children}</>;
}
