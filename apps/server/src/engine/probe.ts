/**
 * Media probing.
 *
 * Two tiers, because the blueprint forbids pretending:
 *   1. `ffprobe` — real container/codec/duration reads, used when the binary is
 *      present on the host. Always invoked with an argument array, never a
 *      shell string (§9).
 *   2. `container-sniff` — magic-byte inspection of the first bytes of a remote
 *      file. Honest but shallow: it can identify the container, not the codecs.
 *
 * Playability for the in-app player is reported separately from downloadability:
 * a .mkv can be a perfectly permitted download and still fail to play in a
 * browser, and the UI must say so instead of showing a dead player.
 */
import { spawn, spawnSync } from 'node:child_process';
import { constants as fsConstants, createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { config } from '../config.js';
import { log } from '../logger.js';
import type { MediaProbeSummary } from '@blaxkvault/shared';

let ffprobeChecked = false;
let ffprobeAvailable = false;
let ffmpegChecked = false;
let ffmpegAvailable = false;

function binaryWorks(binary: string): boolean {
  try {
    const result = spawnSync(binary, ['-version'], { timeout: 5000, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function hasFfprobe(): boolean {
  if (!ffprobeChecked) {
    ffprobeAvailable = binaryWorks(config.tools.ffprobePath);
    ffprobeChecked = true;
    log.debug('ffprobe detection', { path: config.tools.ffprobePath, available: ffprobeAvailable });
  }
  return ffprobeAvailable;
}

export function hasFfmpeg(): boolean {
  if (!ffmpegChecked) {
    ffmpegAvailable = binaryWorks(config.tools.ffmpegPath);
    ffmpegChecked = true;
    log.debug('ffmpeg detection', { path: config.tools.ffmpegPath, available: ffmpegAvailable });
  }
  return ffmpegAvailable;
}

/* --------------------------- magic-byte sniffing -------------------------- */

interface SniffResult {
  container: string;
  mimeType?: string;
  notes: string[];
}

export function sniffContainer(bytes: Buffer): SniffResult {
  const notes: string[] = [];
  if (bytes.length < 12) return { container: 'unknown', notes: ['Too few bytes received to identify the container.'] };

  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');

  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).trim();
    return { container: brand === 'qt  ' ? 'mov' : 'mp4', mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4', notes: [`ISO BMFF brand: ${brand || 'unknown'}`] };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    const isWebm = bytes.includes(Buffer.from('webm'));
    return { container: isWebm ? 'webm' : 'mkv', mimeType: isWebm ? 'video/webm' : 'video/x-matroska', notes: ['Matroska/EBML header found.'] };
  }
  if (ascii(0, 4) === 'OggS') return { container: 'ogg', mimeType: 'video/ogg', notes: ['Ogg bitstream.'] };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ') return { container: 'avi', mimeType: 'video/x-msvideo', notes: ['RIFF/AVI.'] };
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return { container: 'mp3', mimeType: 'audio/mpeg', notes: ['MPEG audio frame.'] };
  if (ascii(0, 4) === 'fLaC') return { container: 'flac', mimeType: 'audio/flac', notes: ['FLAC stream.'] };
  if (ascii(0, 4) === 'RIFF') {
    const sub = ascii(8, 12);
    if (sub === 'WAVE') return { container: 'wav', mimeType: 'audio/wav', notes: ['RIFF/WAVE.'] };
    if (sub === 'WEBP') return { container: 'webp', mimeType: 'image/webp', notes: ['This is a WebP image, not a media file.'] };
  }
  if (ascii(0, 5) === '<?xml' || /^\s*<!doctype html|^\s*<html/i.test(bytes.subarray(0, 512).toString('utf8'))) {
    return { container: 'html', mimeType: 'text/html', notes: ['The response is an HTML document, not a media file.'] };
  }
  if (ascii(0, 4) === '%PDF') return { container: 'pdf', mimeType: 'application/pdf', notes: ['PDF document.'] };
  return { container: 'unknown', notes: ['Unrecognised container signature.'] };
}

export function isBrowserPlayable(container?: string, videoCodec?: string, audioCodec?: string): boolean {
  if (videoCodec && /hevc|h\.?265|mpeg2|vc-1|wmv|theora/i.test(videoCodec)) return false;
  if (container === 'mp4' || container === 'mov') {
    if (audioCodec && /dts|ac-?3|eac3|truehd/i.test(audioCodec)) return false;
    return true;
  }
  if (container === 'webm') return !videoCodec || /vp8|vp9|av1/i.test(videoCodec);
  if (container === 'ogg' || container === 'ogv') return true;
  if (['mp3', 'm4a', 'aac', 'flac', 'wav', 'opus'].includes(container ?? '')) return true;
  // mkv/avi/ts/mpg cannot be relied on in browsers.
  return false;
}

/* ------------------------------- ffprobe ---------------------------------- */

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string };
}

function runFfprobe(target: string, timeoutMs = 20_000): Promise<FfprobeOutput | null> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      target,
    ];
    const child = spawn(config.tools.ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 2_000_000) child.kill('SIGKILL');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) return resolve(null);
      try {
        resolve(JSON.parse(stdout) as FfprobeOutput);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function probeLocalFile(absolutePath: string): Promise<MediaProbeSummary> {
  if (!existsSync(absolutePath)) {
    return { tool: 'none', browserPlayable: false, notes: ['File not found on disk.'] };
  }
  if (hasFfprobe()) {
    const output = await runFfprobe(absolutePath);
    if (output?.format) {
      const video = output.streams?.find((s) => s.codec_type === 'video');
      const audio = output.streams?.find((s) => s.codec_type === 'audio');
      const container = (output.format.format_name ?? '').split(',')[0];
      const duration = Number.parseFloat(output.format.duration ?? '');
      return {
        tool: 'ffprobe',
        container,
        videoCodec: video?.codec_name,
        audioCodec: audio?.codec_name,
        width: video?.width,
        height: video?.height,
        durationSeconds: Number.isFinite(duration) ? duration : undefined,
        bitrate: Number.parseInt(output.format.bit_rate ?? '', 10) || undefined,
        browserPlayable: isBrowserPlayable(container, video?.codec_name, audio?.codec_name),
        notes: video?.codec_name ? [`Video: ${video.codec_name}${video.width ? ` ${video.width}x${video.height}` : ''}`] : [],
      };
    }
  }

  // Fallback: container sniff from the first 64 KB + real file size.
  const header = await readHead(absolutePath, 64 * 1024);
  const sniff = sniffContainer(header);
  const info = await stat(absolutePath).catch(() => null);
  return {
    tool: 'container-sniff',
    container: sniff.container,
    mimeType: sniff.mimeType,
    browserPlayable: isBrowserPlayable(sniff.container),
    notes: [
      ...sniff.notes,
      'ffprobe is not installed, so codec, resolution and duration could not be read. Install ffmpeg for full inspection.',
      info ? `Size: ${info.size} bytes` : 'Size unavailable.',
    ],
  };
}

async function readHead(absolutePath: string, bytes: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = createReadStream(absolutePath, { start: 0, end: bytes - 1 });
    stream.on('data', (chunk) => {
      chunks.push(chunk as Buffer);
      total += (chunk as Buffer).length;
      if (total >= bytes) stream.destroy();
    });
    stream.on('close', () => resolve(Buffer.concat(chunks)));
    stream.on('error', () => resolve(Buffer.alloc(0)));
  });
}

export async function assertReadable(path: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((fs) => fs.access(path, fsConstants.R_OK));
    return true;
  } catch {
    return false;
  }
}

export function toolSummary(): { ffprobe: boolean; ffmpeg: boolean } {
  return { ffprobe: hasFfprobe(), ffmpeg: hasFfmpeg() };
}
