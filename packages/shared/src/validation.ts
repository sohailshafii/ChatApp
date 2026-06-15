import { z } from 'zod';

// Primitives reused across multiple wire schemas. Mirrors REQUIREMENTS.md §1.

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Username may only contain letters, numbers, underscore, and hyphen',
  );

export const emailSchema = z.string().email().max(254);

// Gate for *verifying* an existing password (login, re-auth on account
// deletion). Stays permissive so accounts created under any past policy keep
// working — never tighten this, or you lock those users out.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(1024, 'Password is too long');

// Policy for a *newly set* password (signup, password reset). Stricter than
// `passwordSchema`; existing passwords are grandfathered via that schema.
export const NEW_PASSWORD_MIN_LENGTH = 12;

// Source of truth for the policy, also consumed by UIs that show a live
// requirements checklist. Keep in lockstep with `newPasswordSchema` below.
export const passwordRequirements: ReadonlyArray<{
  id: string;
  label: string;
  test: (password: string) => boolean;
}> = [
  {
    id: 'length',
    label: `At least ${NEW_PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= NEW_PASSWORD_MIN_LENGTH,
  },
  { id: 'uppercase', label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lowercase', label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'A number', test: (p) => /[0-9]/.test(p) },
];

export const newPasswordSchema = z
  .string()
  .min(
    NEW_PASSWORD_MIN_LENGTH,
    `Password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters`,
  )
  .max(1024, 'Password is too long')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number');

// Opaque random tokens (email verification, password reset).
export const tokenSchema = z.string().min(16).max(256);

// ISO 8601 datetime strings on the wire (UTC).
export const isoDateSchema = z.string().datetime();
