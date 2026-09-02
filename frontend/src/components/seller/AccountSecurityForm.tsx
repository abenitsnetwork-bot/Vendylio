'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth, type User } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/**
 * Password + linked-providers management — extracted from the standalone
 * `/settings` page (Phase 9) so the same logic can also power the "Account"
 * tab on `/dashboard/settings` without duplicating it. `/settings` itself
 * stays as its own route (unchanged URL) since the Google OAuth link flow's
 * `next=/settings` redirect target is baked into that route already.
 */
export function AccountSecurityForm({ user }: { user: User }) {
  const { refresh } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPassword = user.hasPassword;
  const googleLinked = user.linkedProviders.includes('google');

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length === 0) {
      setError('Saisis un nouveau mot de passe.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }

    setSubmitting(true);
    try {
      if (hasPassword) {
        await api('/api/auth/change-password', {
          method: 'PUT',
          body: { currentPassword, newPassword },
        });
        toast('Mot de passe mis à jour.', 'success');
      } else {
        await api('/api/auth/set-password', {
          method: 'POST',
          body: { newPassword },
        });
        toast('Mot de passe défini. Tu peux maintenant te connecter par email.', 'success');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          INVALID_CREDENTIALS: 'Mot de passe actuel incorrect.',
          PASSWORD_BANNED: 'Ce mot de passe est trop courant.',
          PASSWORD_TOO_SHORT: err.message || 'Mot de passe trop court.',
          PASSWORD_PWNED: 'Ce mot de passe a fuité — choisis-en un autre.',
          PASSWORD_ALREADY_SET:
            'Un mot de passe est déjà défini. Utilise « changer le mot de passe ».',
          VALIDATION_FAILED: 'Champs invalides.',
        };
        setError(map[err.code] ?? err.message);
      } else {
        setError('Erreur réseau. Réessaie.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card className="p-5 sm:p-8">
        <h2 className="mb-2 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
          {hasPassword ? 'Changer le mot de passe' : 'Définir un mot de passe'}
        </h2>
        <p className="mb-6 mt-4 text-sm text-muted-foreground">
          {hasPassword
            ? 'Tu peux modifier ton mot de passe ici. Les autres sessions seront déconnectées.'
            : 'Tu t’es connecté via Google. Définis un mot de passe pour pouvoir aussi te connecter par email.'}
        </p>
        <form onSubmit={onSubmitPassword} className="flex flex-col gap-6">
          {hasPassword && (
            <Field label="Mot de passe actuel" htmlFor="currentPassword">
              <input
                id="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
          <Field label="Nouveau mot de passe" htmlFor="newPassword">
            <input
              id="newPassword"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Confirmer le nouveau mot de passe" htmlFor="confirmPassword">
            <input
              id="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting
              ? 'Enregistrement…'
              : hasPassword
                ? 'Changer le mot de passe'
                : 'Définir le mot de passe'}
          </Button>
        </form>
      </Card>

      <Card className="p-5 sm:p-8">
        <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
          Comptes liés
        </h2>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Google</span>
            <span className="text-xs text-muted-foreground">
              {googleLinked
                ? 'Tu peux te connecter via Google.'
                : 'Lie ton compte Google pour te connecter en un clic.'}
            </span>
          </div>
          {googleLinked ? (
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-accent">
              Lié
            </span>
          ) : (
            <a
              href="/api/auth/oauth/google/start?next=/settings"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
            >
              Lier Google
            </a>
          )}
        </div>
      </Card>
    </div>
  );
}
