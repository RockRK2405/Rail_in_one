import { describe, it, expect } from 'vitest';
import { escapeHtml } from '@/server/email/html';

describe('escapeHtml (email XSS defence)', () => {
  it('escapes the OWASP dangerous characters', () => {
    expect(escapeHtml(`<script>alert('xss')</script>`)).toBe(
      '&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;',
    );
    expect(escapeHtml(`"><img src=x onerror=alert(1)>`)).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('returns an empty string for null/undefined so callers never NPE', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('is a no-op on plain text', () => {
    expect(escapeHtml('Alice Smith')).toBe('Alice Smith');
  });
});
