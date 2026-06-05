import { describe, expect, it } from 'vitest';
import { notificationPreview, shouldFireNotification } from './notify';

describe('notificationPreview', () => {
  it('passes through short content, collapsing whitespace', () => {
    expect(notificationPreview('hi there')).toBe('hi there');
    expect(notificationPreview('line one\n\nline two')).toBe('line one line two');
  });

  it('truncates with an ellipsis past the limit', () => {
    const out = notificationPreview('a'.repeat(200));
    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('shouldFireNotification', () => {
  it('fires only when hidden and permission granted', () => {
    expect(shouldFireNotification({ hidden: true, permission: 'granted' })).toBe(true);
    expect(shouldFireNotification({ hidden: false, permission: 'granted' })).toBe(false);
    expect(shouldFireNotification({ hidden: true, permission: 'denied' })).toBe(false);
    expect(shouldFireNotification({ hidden: true, permission: 'default' })).toBe(false);
  });
});
