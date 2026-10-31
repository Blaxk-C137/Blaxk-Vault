/**
 * `.env` parsing tests.
 *
 * These exist because the documented setup path is "copy .env.example to .env",
 * and that template contains inline comments. A loader that keeps the comment as
 * part of the value produced `getaddrinfo ENOTFOUND 0.0.0.0   # container…` —
 * a networking-looking failure with a parser-shaped cause.
 */
import { describe, expect, it } from 'vitest';
import { parseEnvFileText, loadEnvFile } from '../src/lib/env-file.js';

describe('parseEnvFileText', () => {
  it('reads plain pairs', () => {
    expect(parseEnvFileText('PORT=3000\nLOG_LEVEL=info')).toEqual({ PORT: '3000', LOG_LEVEL: 'info' });
  });

  it('drops an inline comment preceded by whitespace', () => {
    const parsed = parseEnvFileText('HOST=0.0.0.0                  # container/preview needs 0.0.0.0; use 127.0.0.1 locally');
    expect(parsed.HOST).toBe('0.0.0.0');
  });

  it('drops a comment that follows a quoted value', () => {
    expect(parseEnvFileText("BLAXKVAULT_FRAME_ANCESTORS='self'   # keeps the UI un-frameable").BLAXKVAULT_FRAME_ANCESTORS).toBe('self');
    expect(parseEnvFileText('ALLOW_PRIVATE_ADDRESSES=false        # keep false: blocks SSRF').ALLOW_PRIVATE_ADDRESSES).toBe('false');
  });

  it('keeps a "#" that is part of the value', () => {
    expect(parseEnvFileText('REDIRECT=https://host/callback#done').REDIRECT).toBe('https://host/callback#done');
    expect(parseEnvFileText('COLOR="#8b5cf6"').COLOR).toBe('#8b5cf6');
    expect(parseEnvFileText("MOTION='slow # careful'").MOTION).toBe('slow # careful');
  });

  it('handles the enum-with-pipe comments from the template', () => {
    expect(parseEnvFileText('LOG_LEVEL=info                 # fatal|error|warn|info|debug|trace|silent').LOG_LEVEL).toBe('info');
    expect(parseEnvFileText('LOG_FORMAT=                    # blank = pretty in development').LOG_FORMAT).toBe('');
  });

  it('keeps "=" inside a value (base64 padding, query strings)', () => {
    expect(parseEnvFileText('ARIA2_RPC_SECRET=YWJjPT0=').ARIA2_RPC_SECRET).toBe('YWJjPT0=');
    expect(parseEnvFileText('URL=https://x/y?a=1&b=2').URL).toBe('https://x/y?a=1&b=2');
  });

  it('supports an empty value and a commented-out line', () => {
    expect(parseEnvFileText('MEDIA_ROOTS=\n# TMDB_API_KEY=secret').MEDIA_ROOTS).toBe('');
    expect(parseEnvFileText('# TMDB_API_KEY=secret').TMDB_API_KEY).toBeUndefined();
  });

  it('accepts an "export " prefix and CRLF line endings', () => {
    expect(parseEnvFileText('export PORT=8080\r\nHOST=127.0.0.1\r\n')).toEqual({ PORT: '8080', HOST: '127.0.0.1' });
  });

  it('unescapes inside double quotes only', () => {
    expect(parseEnvFileText('A="line1\\nline2"').A).toBe('line1\nline2');
    expect(parseEnvFileText('B=\'line1\\nline2\'').B).toBe('line1\\nline2');
  });

  it('ignores malformed lines instead of throwing', () => {
    expect(parseEnvFileText('=novalue\nno-equals-sign\nKEY=ok').KEY).toBe('ok');
    expect(parseEnvFileText("UNTERMINATED='oops").UNTERMINATED).toBe('oops');
  });
});

describe('loadEnvFile', () => {
  it('does not overwrite a variable that is already set', () => {
    const target: NodeJS.ProcessEnv = { HOST: '127.0.0.1' };
    const applied = loadEnvFile(() => 'HOST=0.0.0.0\nPORT=9999', '/tmp/.env', target);
    expect(target.HOST).toBe('127.0.0.1'); // the real environment wins
    expect(target.PORT).toBe('9999');
    expect(applied).toEqual(['PORT']);
  });

  it('treats a missing file as an empty configuration', () => {
    expect(loadEnvFile(() => {
      throw new Error('ENOENT');
    }, '/tmp/absent', {})).toEqual([]);
  });

  it('applies the shipped template without mangling a single value', () => {
    // The exact text of .env.example: every uncommented value must come out clean.
    const template = [
      '# comment line',
      "NODE_ENV=production",
      'HOST=0.0.0.0                  # container/preview needs 0.0.0.0',
      'PORT=3000',
      'BLAXKVAULT_ACCESS_TOKEN=',
      "BLAXKVAULT_FRAME_ANCESTORS='self'",
      'LOG_LEVEL=info                 # fatal|error|warn|info|debug|trace|silent',
      'LOG_FORMAT=                    # blank = pretty in development',
      'DATABASE_URL=./data/blaxkvault.db',
      'TMDB_REGION=NG',
      'DOWNLOAD_ENGINE=native',
      'ARIA2_RPC_URL=http://127.0.0.1:6800/jsonrpc',
      'MAX_DOWNLOAD_BYTES=0                 # 0 = unlimited per job',
      'BANDWIDTH_LIMIT_KBPS=0               # 0 = unlimited',
      'FFPROBE_PATH=ffprobe',
      'MEDIA_ROOTS=',
      'ALLOW_PRIVATE_ADDRESSES=false        # keep false: blocks SSRF',
    ].join('\n');

    const target: NodeJS.ProcessEnv = {};
    loadEnvFile(() => template, '/tmp/.env.example', target);

    expect(target.HOST).toBe('0.0.0.0');
    expect(target.LOG_LEVEL).toBe('info');
    expect(target.LOG_FORMAT).toBe('');
    expect(target.BLAXKVAULT_FRAME_ANCESTORS).toBe('self');
    expect(target.MAX_DOWNLOAD_BYTES).toBe('0');
    expect(target.BANDWIDTH_LIMIT_KBPS).toBe('0');
    expect(target.ALLOW_PRIVATE_ADDRESSES).toBe('false');
    expect(target.ARIA2_RPC_URL).toBe('http://127.0.0.1:6800/jsonrpc');
    for (const [key, value] of Object.entries(target)) {
      expect(value, `${key} must not contain a comment`).not.toMatch(/[#\s]{2,}|#/);
    }
  });
});
