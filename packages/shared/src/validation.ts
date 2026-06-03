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

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(1024, 'Password is too long');

// Opaque random tokens (email verification, password reset).
export const tokenSchema = z.string().min(16).max(256);

// ISO 8601 datetime strings on the wire (UTC).
export const isoDateSchema = z.string().datetime();
