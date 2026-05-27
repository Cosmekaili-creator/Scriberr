import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useTranslation } from '@/i18n';
import { Shield, UserCheck, UserX, KeyRound, Plus, Users } from 'lucide-react';

interface AdminUser {
    id: number;
    username: string;
    role: string;
    full_name?: string;
    email?: string;
    is_active: boolean;
}

function useAdminUsers() {
    const { getAuthHeaders } = useAuth();
    return useQuery<AdminUser[]>({
        queryKey: ['admin', 'users'],
        queryFn: async () => {
            const res = await fetch('/api/v1/admin/users', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to fetch users');
            return res.json();
        },
    });
}

export function AdminUsersPage() {
    const { isAdmin, isAuthenticated } = useAuth();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { getAuthHeaders } = useAuth();
    const { data: users, isLoading } = useAdminUsers();

    const [createOpen, setCreateOpen] = useState(false);
    const [resetOpen, setResetOpen] = useState<AdminUser | null>(null);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newConfirmPassword, setNewConfirmPassword] = useState('');
    const [newFullName, setNewFullName] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
    const [resetPassword, setResetPasswordValue] = useState('');

    if (!isAuthenticated) return <Navigate to="/" replace />;
    if (!isAdmin) return <Navigate to="/" replace />;

    const createMutation = useMutation({
        mutationFn: async () => {
            const body: Record<string, string> = { username: newUsername, password: newPassword, role: newRole };
            if (newFullName.trim()) body.full_name = newFullName.trim();
            if (newEmail.trim()) body.email = newEmail.trim();
            const res = await fetch('/api/v1/admin/users', {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || 'Failed to create user');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
            setCreateOpen(false);
            setNewUsername('');
            setNewPassword('');
            setNewConfirmPassword('');
            setNewFullName('');
            setNewEmail('');
            setNewRole('user');
        },
    });

    const toggleActiveMutation = useMutation({
        mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
            const action = active ? 'enable' : 'disable';
            const res = await fetch(`/api/v1/admin/users/${id}/${action}`, {
                method: 'POST',
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error('Failed to update user');
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
    });

    const resetMutation = useMutation({
        mutationFn: async ({ id, password }: { id: number; password: string }) => {
            const res = await fetch(`/api/v1/admin/users/${id}/reset-password`, {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) throw new Error('Failed to reset password');
        },
        onSuccess: () => {
            setResetOpen(null);
            setResetPasswordValue('');
        },
    });

    return (
        <MainLayout header={<Header />}>
            <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Shield className="h-6 w-6 text-[var(--brand-solid)]" />
                        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
                            {t('admin.users.title')}
                        </h1>
                    </div>
                    <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        {t('admin.users.create')}
                    </Button>
                </div>

                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-solid)]" />
                    </div>
                ) : (
                    <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-[var(--secondary)] text-[var(--text-secondary)]">
                                <tr>
                                    <th className="text-left px-4 py-3 font-medium">
                                        {t('admin.users.username')}
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium">
                                        {t('admin.users.role')}
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium">
                                        {t('admin.users.status')}
                                    </th>
                                    <th className="text-right px-4 py-3 font-medium">
                                        {t('admin.users.actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                {(users ?? []).map((u) => (
                                    <tr key={u.id} className="bg-[var(--bg-main)] hover:bg-[var(--secondary)] transition-colors">
                                        <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                                            <div className="flex items-center gap-2">
                                                <Users className="h-4 w-4 text-[var(--text-tertiary)]" />
                                                {u.username}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-[var(--brand-light)] text-[var(--brand-solid)]' : 'bg-[var(--secondary)] text-[var(--text-secondary)]'}`}>
                                                {u.role}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                                {u.is_active ? t('admin.users.active') : t('admin.users.inactive')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                {u.role === 'user' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => toggleActiveMutation.mutate({ id: u.id, active: !u.is_active })}
                                                        title={u.is_active ? t('admin.users.disable') : t('admin.users.enable')}
                                                    >
                                                        {u.is_active
                                                            ? <UserX className="h-4 w-4 text-[var(--error)]" />
                                                            : <UserCheck className="h-4 w-4 text-emerald-600" />
                                                        }
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setResetOpen(u)}
                                                    title={t('admin.users.resetPassword')}
                                                >
                                                    <KeyRound className="h-4 w-4 text-[var(--text-secondary)]" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {(users ?? []).length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                                            {t('admin.users.empty')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create user dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.users.createTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.username')}</Label>
                            <Input
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                                placeholder={t('admin.users.usernamePlaceholder')}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.fullName')} <span className="text-[var(--text-tertiary)] text-xs">({t('common.optional')})</span></Label>
                            <Input
                                value={newFullName}
                                onChange={(e) => setNewFullName(e.target.value)}
                                placeholder={t('admin.users.fullNamePlaceholder')}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.email')} <span className="text-[var(--text-tertiary)] text-xs">({t('common.optional')})</span></Label>
                            <Input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder={t('admin.users.emailPlaceholder')}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.password')}</Label>
                            <Input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder={t('admin.users.passwordPlaceholder')}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.confirmPassword')}</Label>
                            <Input
                                type="password"
                                value={newConfirmPassword}
                                onChange={(e) => setNewConfirmPassword(e.target.value)}
                                placeholder={t('admin.users.confirmPasswordPlaceholder')}
                            />
                            {newConfirmPassword && newPassword !== newConfirmPassword && (
                                <p className="text-xs text-[var(--error)]">{t('admin.users.passwordMismatch')}</p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.role')}</Label>
                            <select
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm"
                            >
                                <option value="user">user</option>
                                <option value="admin">admin</option>
                            </select>
                        </div>
                        {createMutation.isError && (
                            <p className="text-sm text-[var(--error)]">{String(createMutation.error)}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            onClick={() => createMutation.mutate()}
                            disabled={!newUsername || !newPassword || newPassword !== newConfirmPassword || createMutation.isPending}
                        >
                            {createMutation.isPending ? t('common.saving') : t('admin.users.create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset password dialog */}
            <Dialog open={!!resetOpen} onOpenChange={(o) => { if (!o) setResetOpen(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.users.resetPasswordTitle').replace('{username}', resetOpen?.username ?? '')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>{t('admin.users.newPassword')}</Label>
                            <Input
                                type="password"
                                value={resetPassword}
                                onChange={(e) => setResetPasswordValue(e.target.value)}
                                placeholder={t('admin.users.passwordPlaceholder')}
                            />
                        </div>
                        {resetMutation.isError && (
                            <p className="text-sm text-[var(--error)]">{String(resetMutation.error)}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setResetOpen(null)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            onClick={() => resetOpen && resetMutation.mutate({ id: resetOpen.id, password: resetPassword })}
                            disabled={!resetPassword || resetPassword.length < 8 || resetMutation.isPending}
                        >
                            {resetMutation.isPending ? t('common.saving') : t('admin.users.resetPassword')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </MainLayout>
    );
}
