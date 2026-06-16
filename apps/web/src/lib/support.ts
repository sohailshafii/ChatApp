// Single source of truth for the abuse/report contact channel. For the public
// test deployment this is the maintainer's email; swap it here (or point it at a
// dedicated address/form) to change every "Report abuse" affordance at once.
export const REPORT_ABUSE_EMAIL = 'sohail.shafii@gmail.com';

// A pre-filled mailto: for reporting abuse. Keep the subject stable so reports
// are easy to filter.
export const reportAbuseMailto = `mailto:${REPORT_ABUSE_EMAIL}?subject=${encodeURIComponent(
  'ChatApp abuse report',
)}`;
