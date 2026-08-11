import { describe, expect, it } from 'vitest';
import {
  normalizeAllowedHostnames,
  validateBusinessWebUrl,
} from '../../src/web/businessWebEvidence.js';

describe('generic business web URL safety', () => {
  it('normalizes caller-supplied hostnames and requires an exact host match', () => {
    const allowlist = normalizeAllowedHostnames([
      'OFFICIAL.EXAMPLE.',
      'news.official.example',
    ]);

    expect(allowlist).toEqual(['official.example', 'news.official.example']);
    expect(
      validateBusinessWebUrl(
        'https://OFFICIAL.EXAMPLE/products?id=1',
        allowlist,
      ),
    ).toBe('https://official.example/products?id=1');
    expect(() =>
      validateBusinessWebUrl(
        'https://official.example.attacker.test/products',
        allowlist,
      ),
    ).toThrow('web_url_host_not_allowed');
  });

  it.each([
    ['HTTP URLs', 'http://official.example/news', 'web_url_https_required'],
    [
      'URL credentials',
      'https://user:password@official.example/news',
      'web_url_credentials_not_allowed',
    ],
    [
      'non-allowlisted hosts',
      'https://other.example/news',
      'web_url_host_not_allowed',
    ],
    [
      'suffix-confusion hosts',
      'https://official.example.evil.test/news',
      'web_url_host_not_allowed',
    ],
    [
      'IPv4 literals',
      'https://127.0.0.1/news',
      'web_url_ip_literal_not_allowed',
    ],
    [
      'IPv6 literals',
      'https://[2001:db8::1]/news',
      'web_url_ip_literal_not_allowed',
    ],
    [
      'fragments',
      'https://official.example/news#untrusted-section',
      'web_url_fragment_not_allowed',
    ],
    [
      'non-default HTTPS ports',
      'https://official.example:444/news',
      'web_url_port_not_allowed',
    ],
  ])('rejects %s', (_case, url, expectedCode) => {
    expect(() => validateBusinessWebUrl(url, ['official.example'])).toThrow(
      expectedCode,
    );
  });

  it('preserves canonical HTTPS default-port normalization', () => {
    expect(
      validateBusinessWebUrl('https://official.example:443/news', [
        'official.example',
      ]),
    ).toBe('https://official.example/news');
  });

  it('rejects invalid or IP-literal entries in the caller allowlist', () => {
    expect(() => normalizeAllowedHostnames([])).toThrow(
      'web_allowlist_required',
    );
    expect(() => normalizeAllowedHostnames(['127.0.0.1'])).toThrow(
      'web_allowlist_ip_literal_not_allowed',
    );
    expect(() => normalizeAllowedHostnames(['official.example/path'])).toThrow(
      'web_allowlist_hostname_invalid',
    );
  });
});
