/**
 * SSRF guard tests (blueprint §9). These run with private addresses *blocked*,
 * i.e. the production posture, regardless of the test setup flag.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';

const originalFlag = process.env.ALLOW_PRIVATE_ADDRESSES;

let guard: typeof import('../src/security/url-guard.js');

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_ADDRESSES = 'false';
  // Import after adjusting env; the module reads config at call time for this flag
  // only when config itself has already been parsed, so we assert both layers.
  guard = await import('../src/security/url-guard.js');
});

afterAll(() => {
  process.env.ALLOW_PRIVATE_ADDRESSES = originalFlag;
});

describe('normalizeNumericHost', () => {
  it('converts decimal, octal and hex encodings of 127.0.0.1', () => {
    expect(guard.normalizeNumericHost('2130706433')).toBe('127.0.0.1');
    expect(guard.normalizeNumericHost('0177.0.0.1')).toBe('127.0.0.1');
    expect(guard.normalizeNumericHost('0x7f.0.0.1')).toBe('127.0.0.1');
    expect(guard.normalizeNumericHost('127.0.0.1')).toBe('127.0.0.1');
  });

  it('returns null for ordinary hostnames and out-of-range values', () => {
    expect(guard.normalizeNumericHost('example.com')).toBeNull();
    expect(guard.normalizeNumericHost('999.1.1.1')).toBeNull();
  });
});

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.0.0.5', true],
    ['172.16.4.4', true],
    ['192.168.1.10', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['2606:2800:220:1:248:1893:25c8:1946', false],
  ])('%s → blocked=%s', (address, blocked) => {
    expect(guard.isBlockedAddress(address)).toBe(blocked);
  });
});

describe('assertSafeRemoteUrl', () => {
  it('rejects non-http schemes', async () => {
    await expect(guard.assertSafeRemoteUrl('file:///etc/passwd')).rejects.toThrow(/Only http and https/i);
    await expect(guard.assertSafeRemoteUrl('ftp://example.com/x.mp4')).rejects.toThrow(/Only http and https/i);
  });

  it('rejects embedded credentials', async () => {
    await expect(guard.assertSafeRemoteUrl('https://user:pass@example.com/x.mp4')).rejects.toThrow(/credentials/i);
  });

  it('rejects privileged ports', async () => {
    await expect(guard.assertSafeRemoteUrl('http://example.com:22/x.mp4')).rejects.toThrow(/Port 22/);
    await expect(guard.assertSafeRemoteUrl('http://example.com:8080/x.mp4')).resolves.toBeDefined();
  });

  it('rejects internal hostnames without needing DNS', async () => {
    for (const host of ['http://localhost/x.mp4', 'http://metadata.google.internal/computeMetadata/v1/', 'http://printer.local/x.mp4', 'http://x.internal/y.mp4']) {
      await expect(guard.assertSafeRemoteUrl(host)).rejects.toThrow(AppError);
    }
  });

  it('rejects loopback, metadata and private space by IP literal', async () => {
    await expect(guard.assertSafeRemoteUrl('http://127.0.0.1:8080/x.mp4')).rejects.toThrow(/blocked range/i);
    await expect(guard.assertSafeRemoteUrl('http://[::1]/x.mp4')).rejects.toThrow(/blocked range/i);
    await expect(guard.assertSafeRemoteUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/blocked range/i);
    await expect(guard.assertSafeRemoteUrl('http://192.168.0.1/x.mp4')).rejects.toThrow(/blocked range/i);
    await expect(guard.assertSafeRemoteUrl('http://2130706433:8080/x.mp4')).rejects.toThrow(/blocked range/i);
  });

  it('accepts a public literal address', async () => {
    await expect(guard.assertSafeRemoteUrl('https://93.184.216.34/file.mp4')).resolves.toBeDefined();
  });
});
