import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Cloudflare Worker placement', () => {
  it('keeps Smart Placement disabled for OpenAI requests', () => {
    const wranglerConfig = readFileSync('wrangler.toml', 'utf8');

    expect(wranglerConfig).not.toMatch(/^\s*\[placement\]\s*$/m);
    expect(wranglerConfig).not.toMatch(/^\s*mode\s*=\s*["']smart["']\s*$/m);
  });
});
