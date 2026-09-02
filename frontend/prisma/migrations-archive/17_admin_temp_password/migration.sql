-- Admin-issued one-time temporary passwords.
-- A SUPERADMIN can reset a locked-out merchant/manager via
-- POST /api/admin/users/[id]/temp-password. That sets this flag; the authed
-- shell then forces the user to /settings to choose a new password.
-- change-password / reset-password clear it.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
