/**
 * Whisper STT IPC — High-quality local speech-to-text using whisper.cpp
 * Supports GPU acceleration (CUDA/DirectML) and low-latency streaming
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let whisperModel = 'small';
let cachedWhisperExecutable = null;
const cachedWhisperModels = new Map();
let whisperBusy = false;

/**
 * Calculate audio energy to detect silence/noise using RMS (Root Mean Square).
 * Algorithm: Computes RMS energy from 16-bit PCM samples in WAV file.
 *
 * RMS formula: sqrt(sum(sample^2) / count)
 * - Normalized samples: [-1, 1] range (divide by 32768 for 16-bit)
 * - Threshold 0.01 ≈ -40dB, filters out ambient noise and silence
 *
 * @param {string} wavFilePath - Path to WAV file (16-bit PCM, mono/stereo)
 * @param {number} [threshold=0.01] - Minimum RMS energy (0.01 = -40dB)
 * @returns {boolean} True if audio has sufficient energy (likely speech)
 */
function hasAudioEnergy(wavFilePath, threshold = 0.01) {
    try {
        const buffer = fs.readFileSync(wavFilePath);

        // WAV header is 44 bytes (RIFF format), audio data starts after
        if (buffer.length < 44) return false;

        // Read audio samples (16-bit PCM, little-endian)
        let sumSquares = 0;
        let sampleCount = 0;

        // Process samples in pairs (16-bit = 2 bytes)
        for (let i = 44; i < buffer.length - 1; i += 2) {
            const sample = buffer.readInt16LE(i) / 32768.0; // Normalize to [-1, 1]
            sumSquares += sample * sample;
            sampleCount++;
        }

        if (sampleCount === 0) return false;

        // Calculate RMS (Root Mean Square) energy
        const rms = Math.sqrt(sumSquares / sampleCount);

        console.log('[Whisper] Audio RMS energy:', rms.toFixed(4), 'threshold:', threshold);

        return rms > threshold;
    } catch (e) {
        console.error('[Whisper] Error calculating audio energy:', e);
        return true; // If error, allow processing (fail-open for usability)
    }
}

/**
 * Clean common Whisper hallucinations and artifacts
 */
function cleanWhisperOutput(text) {
    if (!text) return '';

    // Remove SRT/VTT timestamps first (most important)
    // Format: [00:00:00.000 --> 00:00:02.000]
    text = text.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, '');

    // Remove standalone timestamps
    text = text.replace(/\d{2}:\d{2}:\d{2}\.\d{3}/g, '');

    // Remove common English filler words that Whisper hallucinates
    text = text.replace(/\b(you|I|the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b\s*/gi, '');

    // Common hallucinations to remove (with various bracket types)
    const hallucinations = [
        // Bell subtitle credits (various formats)
        /[\(（\[]?字幕製作[:：\s]*貝爾[\)）\]]?/g,
        /[\(（\[]?字幕制作[:：\s]*贝尔[\)）\]]?/g,
        /[\(（\[]?Subtitle\s*by\s*Bell[\)）\]]?/gi,
        /[\(（\[]?Subtitles\s*by[\)）\]]?/gi,

        // Generic subtitle markers
        /[\(（\[]?字幕[:：]?[\)）\]]?/g,

        // Music and sound effects
        /[\[\(（]?音楽[\]\)）]?/g,
        /[\[\(（]?Music[\]\)）]?/gi,
        /[\[\(（]?拍手[\]\)）]?/g,
        /[\[\(（]?Applause[\]\)）]?/gi,
        /[\[\(（]?笑[\]\)）]?/g,
        /[\[\(（]?Laughter[\]\)）]?/gi,

        // Common video endings
        /ご視聴ありがとうございました/g,
        /Thanks\s*for\s*watching/gi,
        /チャンネル登録/g,
        /Subscribe/gi,
        /Please\s*subscribe/gi,
        /Like\s*and\s*subscribe/gi,

        // Common filler phrases
        /Thank\s*you/gi,
        /See\s*you/gi,
        /Bye\s*bye/gi,

        // Empty brackets
        /[\(（][\s]*[\)）]/g,
        /[\[][\s]*[\]]/g
    ];

    let cleaned = text;
    for (const pattern of hallucinations) {
        cleaned = cleaned.replace(pattern, '');
    }

    // Remove extra whitespace and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // If result is too short or only punctuation, return empty
    if (cleaned.length < 2 || /^[^\w\u4e00-\u9fa5]+$/.test(cleaned)) {
        return '';
    }

    return cleaned;
}

/**
 * Analyze short-time dynamics to distinguish speech from stationary noise.
 * Speech usually has stronger frame-level energy variance than constant fan/ambient noise.
 */
function analyzeAudioDynamics(wavFilePath, baseThreshold = 0.012) {
    try {
        const buffer = fs.readFileSync(wavFilePath);
        if (buffer.length < 44) return { ok: false, reason: 'invalid_wav' };

        const sampleRate = buffer.readUInt32LE(24) || 16000;
        const channels = buffer.readUInt16LE(22) || 1;
        const bitsPerSample = buffer.readUInt16LE(34) || 16;
        const bytesPerSample = Math.max(1, bitsPerSample / 8);
        const bytesPerFrame = Math.max(2, bytesPerSample * channels);
        const dataStart = 44;
        const dataEnd = buffer.length - (buffer.length - dataStart) % bytesPerFrame;
        if (dataEnd <= dataStart) return { ok: false, reason: 'empty_audio' };

        // 25ms short-time frame window.
        const frameDurationSec = 0.025;
        const samplesPerFrame = Math.max(160, Math.round(sampleRate * frameDurationSec) * channels);

        let totalSamples = 0;
        let sumSquares = 0;
        let peak = 0;

        let frameSum = 0;
        let frameCount = 0;
        const frameRmsList = [];

        for (let i = dataStart; i < dataEnd - 1; i += 2) {
            const sample = buffer.readInt16LE(i) / 32768.0;
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;

            sumSquares += sample * sample;
            totalSamples++;

            frameSum += sample * sample;
            frameCount++;
            if (frameCount >= samplesPerFrame) {
                frameRmsList.push(Math.sqrt(frameSum / frameCount));
                frameSum = 0;
                frameCount = 0;
            }
        }
        if (frameCount > 0) {
            frameRmsList.push(Math.sqrt(frameSum / frameCount));
        }

        if (totalSamples === 0 || frameRmsList.length === 0) {
            return { ok: false, reason: 'empty_audio' };
        }

        const rms = Math.sqrt(sumSquares / totalSamples);
        let frameMin = Number.POSITIVE_INFINITY;
        let frameMax = 0;
        let frameSumMean = 0;
        for (const v of frameRmsList) {
            if (v < frameMin) frameMin = v;
            if (v > frameMax) frameMax = v;
            frameSumMean += v;
        }
        const frameMean = frameSumMean / frameRmsList.length;
        let variance = 0;
        for (const v of frameRmsList) {
            const d = v - frameMean;
            variance += d * d;
        }
        const frameStd = Math.sqrt(variance / frameRmsList.length);
        const dynamicRange = frameMax - frameMin;
        const activeFrames = frameRmsList.filter(v => v > Math.max(baseThreshold, frameMean * 1.25)).length;
        const activeRatio = activeFrames / frameRmsList.length;

        const energyPass = rms > baseThreshold;
        const dynamicPass = dynamicRange > 0.006 || frameStd > 0.0025 || activeRatio > 0.10;
        const peakPass = peak > 0.055;

        const ok = energyPass && (dynamicPass || peakPass);
        return {
            ok,
            reason: ok ? '' : (!energyPass ? 'low_energy' : 'stationary_noise'),
            rms,
            peak,
            dynamicRange,
            frameStd,
            activeRatio,
            frameCount: frameRmsList.length
        };
    } catch (e) {
        console.error('[Whisper] Audio dynamics analysis failed:', e);
        return { ok: true, reason: 'analysis_error' }; // fail-open
    }
}

function isLikelyNoiseTranscript(text, language = 'auto') {
    const cleaned = String(text || '').trim();
    if (!cleaned) return true;

    const normalized = cleaned.replace(/\s+/g, '');
    if (normalized.length < 2) return true;
    if (/^[^\w\u3040-\u30ff\u3400-\u9fff]+$/.test(normalized)) return true;

    // Long repeated runs are usually hallucinations/noise.
    if (/(.)\1{4,}/.test(normalized)) return true;

    const chars = Array.from(normalized);
    const uniqueRatio = new Set(chars).size / Math.max(1, chars.length);
    if (chars.length >= 8 && uniqueRatio < 0.22) return true;

    const cjkCount = (normalized.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
    const latinNumCount = (normalized.match(/[A-Za-z0-9]/g) || []).length;
    const symbolCount = Math.max(0, normalized.length - cjkCount - latinNumCount);
    if (normalized.length >= 5 && symbolCount / normalized.length > 0.42) return true;

    const lang = String(language || '').toLowerCase();
    // In CJK mode, extremely short Latin-only results are usually noise.
    if ((lang.startsWith('zh') || lang.startsWith('ja')) && cjkCount === 0 && latinNumCount > 0 && normalized.length <= 3) {
        return true;
    }

    return false;
}

function filterWhisperText(rawText, language = 'auto') {
    const text = cleanWhisperOutput(rawText);
    if (!text) return { ok: false, error: 'no_speech' };
    if (isLikelyNoiseTranscript(text, language)) {
        return { ok: false, error: 'noise_text' };
    }
    return { ok: true, text };
}

function getWhisperExecutable() {
    if (cachedWhisperExecutable && fs.existsSync(cachedWhisperExecutable)) {
        return cachedWhisperExecutable;
    }

    // Check for whisper.cpp executable in project directory
    // Prioritize whisper-cli.exe over deprecated main.exe
    const possiblePaths = [
        path.join(__dirname, '../../whisper.cpp/whisper-cli.exe'),
        path.join(__dirname, '../../whisper.cpp/build/bin/Release/whisper-cli.exe'),
        path.join(__dirname, '../../bin/whisper-cli.exe'),
        path.join(__dirname, '../../whisper.cpp/main.exe'),
        path.join(__dirname, '../../whisper.cpp/build/bin/Release/main.exe'),
        path.join(__dirname, '../../bin/main.exe')
    ];

    console.log('[Whisper] Searching for executable...');
    for (const p of possiblePaths) {
        try {
            const resolved = path.resolve(p);
            if (fs.existsSync(resolved)) {
                console.log('[Whisper] Found:', resolved);
                cachedWhisperExecutable = resolved;
                return resolved;
            }
        } catch (e) {
            console.error('[Whisper] Error checking path:', e);
        }
    }

    console.log('[Whisper] Not found in any path');
    return null;
}

function getWhisperModel(modelSize = 'base') {
    if (cachedWhisperModels.has(modelSize)) {
        const cached = cachedWhisperModels.get(modelSize);
        if (cached && fs.existsSync(cached)) return cached;
        cachedWhisperModels.delete(modelSize);
    }

    const modelDir = path.join(__dirname, '../../models/whisper');
    const modelFile = `ggml-${modelSize}.bin`;
    const modelPath = path.join(modelDir, modelFile);

    if (fs.existsSync(modelPath)) {
        cachedWhisperModels.set(modelSize, modelPath);
        return modelPath;
    }

    // Try alternative locations
    const altPaths = [
        path.join(__dirname, '../../whisper.cpp/models', modelFile),
        path.join(os.homedir(), '.whisper', modelFile)
    ];

    for (const p of altPaths) {
        if (fs.existsSync(p)) {
            cachedWhisperModels.set(modelSize, p);
            return p;
        }
    }

    return null;
}

function resolveWhisperModel(options = {}) {
    const requested = options.model || whisperModel;
    const lowLatency = options.lowLatency === true;
    const candidates = [requested];

    // Prefer turbo/base in low-latency mode if available.
    if (lowLatency && requested !== 'turbo') candidates.push('turbo');
    if (lowLatency && requested !== 'base') candidates.push('base');

    for (const size of candidates) {
        const modelPath = getWhisperModel(size);
        if (modelPath) {
            return { modelPath, modelName: size };
        }
    }
    return { modelPath: null, modelName: requested };
}

function clampThreads(threads, lowLatency = false) {
    const cpuCount = Math.max(1, os.cpus().length || 1);
    const hardMax = lowLatency ? 8 : 12;
    const defaultThreads = lowLatency
        ? Math.max(2, Math.min(hardMax, cpuCount - 1))
        : Math.max(1, Math.min(hardMax, cpuCount - 1));

    const n = Number(threads);
    if (!Number.isFinite(n) || n <= 0) return defaultThreads;
    return Math.max(1, Math.min(hardMax, Math.floor(n)));
}

function estimateWavDurationMs(wavFilePath) {
    try {
        const buffer = fs.readFileSync(wavFilePath);
        if (buffer.length < 44) return 0;
        const channels = buffer.readUInt16LE(22) || 1;
        const sampleRate = buffer.readUInt32LE(24) || 16000;
        const bitsPerSample = buffer.readUInt16LE(34) || 16;
        const bytesPerSample = Math.max(1, bitsPerSample / 8);
        const dataBytes = Math.max(0, buffer.length - 44);
        const totalSamples = dataBytes / (channels * bytesPerSample);
        const durationSec = totalSamples / sampleRate;
        if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
        return Math.round(durationSec * 1000);
    } catch {
        return 0;
    }
}

function getTranscribeTimeoutMs(audioPath, lowLatency = false) {
    const audioMs = estimateWavDurationMs(audioPath);
    if (!audioMs) return lowLatency ? 18000 : 30000;

    // Give 4x realtime budget + fixed overhead.
    const computed = Math.round(audioMs * 4 + 6000);
    const minTimeout = lowLatency ? 12000 : 18000;
    const maxTimeout = lowLatency ? 30000 : 45000;
    return Math.max(minTimeout, Math.min(maxTimeout, computed));
}

function safeUnlink(filePath) {
    if (!filePath) return;
    try { fs.unlinkSync(filePath); } catch {}
}

async function transcribeWithWhisper(audioPath, options = {}) {
    const whisperExe = getWhisperExecutable();
    if (!whisperExe) {
        return { success: false, error: 'whisper_not_found' };
    }

    const { modelPath, modelName } = resolveWhisperModel(options);
    if (!modelPath) {
        return { success: false, error: 'whisper_model_not_found' };
    }

    const language = options.language || 'auto';
    const langCode = language === 'auto' ? 'auto' : language.split('-')[0];
    const lowLatency = options.lowLatency === true;
    const timeoutMs = getTranscribeTimeoutMs(audioPath, lowLatency);
    const threads = clampThreads(options.threads, lowLatency);

    const args = [
        '-m', modelPath,
        '-f', audioPath,
        '-l', langCode,
        '-t', String(threads),
        '--output-txt',
        '--no-timestamps',  // Disable timestamp output
        '--max-len', '0',   // No length limit
        '--no-fallback'     // Disable fallback to English
    ];

    console.log('[Whisper] Running:', whisperExe, args.join(' '), `timeout=${timeoutMs}ms model=${modelName}`);

    return new Promise((resolve) => {
        const proc = spawn(whisperExe, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: path.dirname(whisperExe)
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const done = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
        };

        proc.stdout?.on('data', (d) => {
            const chunk = d.toString('utf8');
            stdout += chunk;
        });
        proc.stderr?.on('data', (d) => {
            const chunk = d.toString('utf8');
            stderr += chunk;
        });

        proc.on('error', (err) => {
            console.error('[Whisper] Process error:', err);
            done({ success: false, error: err.message || 'whisper_exec_failed' });
        });

        proc.on('close', (code) => {
            console.log('[Whisper] Exit code:', code);
            console.log('[Whisper] stdout:', stdout.substring(0, 200));
            console.log('[Whisper] stderr:', stderr.substring(0, 200));

            if (code === 0) {
                // Check for output txt file
                const txtFile = audioPath + '.txt';
                try {
                    if (fs.existsSync(txtFile)) {
                        let text = fs.readFileSync(txtFile, 'utf8').trim();
                        fs.unlinkSync(txtFile);

                        const filtered = filterWhisperText(text, language);
                        if (filtered.ok) {
                            console.log('[Whisper] Transcribed:', filtered.text);
                            done({ success: true, text: filtered.text, model: modelName });
                            return;
                        }
                    }
                } catch (e) {
                    console.error('[Whisper] Failed to read output:', e);
                }

                // Fallback: parse stdout
                const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
                let text = lines.join(' ').trim();

                const filtered = filterWhisperText(text, language);
                if (filtered.ok) {
                    console.log('[Whisper] Transcribed from stdout:', filtered.text);
                    done({ success: true, text: filtered.text, model: modelName });
                } else {
                    console.error('[Whisper] No text output');
                    done({ success: false, error: filtered.error || 'no_speech', detail: stderr });
                }
            } else {
                console.error('[Whisper] Failed with code:', code);
                console.error('[Whisper] stderr:', stderr);
                done({ success: false, error: 'whisper_failed', detail: stderr });
            }
        });

        const timeoutId = setTimeout(() => {
            try { proc.kill(); } catch {}
            done({ success: false, error: 'timeout' });
        }, timeoutMs);
    });
}

function registerWhisperSTTIPC(ctx, ipcMain) {
    ipcMain.handle('whisper-stt-transcribe', async (event, payload = {}) => {
        if (!payload.audioData) {
            return { success: false, error: 'no_audio_data' };
        }
        if (whisperBusy) {
            return { success: false, error: 'busy' };
        }

        const tempDir = os.tmpdir();
        const ext = payload.mimeType?.includes('webm') ? '.webm' : '.wav';
        const tempFile = path.join(tempDir, `whisper-${Date.now()}${ext}`);
        const wavFile = tempFile.replace(/\.(webm|wav)$/, '.wav');

        // Send listening state to pet window
        if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
            ctx.petWindow.webContents.send('user-speech-update', {
                text: '',
                isListening: true,
                isFinal: false
            });
        }

        whisperBusy = true;
        try {
            const buffer = Buffer.from(payload.audioData, 'base64');
            fs.writeFileSync(tempFile, buffer);

            console.log('[Whisper] Transcribing:', tempFile, 'size:', buffer.length);

            // Convert to WAV if needed using ffmpeg
            if (ext === '.webm') {
                const { spawn } = require('child_process');
                const ffmpegPath = path.join(__dirname, '../../bin/ffmpeg.exe');
                if (!fs.existsSync(ffmpegPath)) {
                    throw new Error('ffmpeg_not_found');
                }
                await new Promise((resolve, reject) => {
                    const ffmpeg = spawn(ffmpegPath, [
                        '-v', 'error',
                        '-y',
                        '-i', tempFile,
                        '-ar', '16000',
                        '-ac', '1',
                        '-c:a', 'pcm_s16le',
                        wavFile
                    ], { windowsHide: true });

                    ffmpeg.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error('ffmpeg failed'));
                    });

                    ffmpeg.on('error', reject);

                    setTimeout(() => {
                        ffmpeg.kill();
                        reject(new Error('ffmpeg timeout'));
                    }, 10000);
                });

                safeUnlink(tempFile);
            }

            // Signal gate: reject silence and stationary noise before Whisper.
            const dynamics = analyzeAudioDynamics(wavFile, 0.012);
            if (!dynamics.ok) {
                console.log('[Whisper] Audio rejected by dynamics gate:', dynamics);

                // Send empty result to pet window
                if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                    ctx.petWindow.webContents.send('user-speech-update', {
                        text: '',
                        isListening: false,
                        isFinal: true
                    });
                }

                safeUnlink(wavFile);
                return { success: false, error: 'no_speech', detail: dynamics.reason || 'audio_rejected' };
            }

            const startedAt = Date.now();
            const result = await transcribeWithWhisper(wavFile, {
                language: payload.language || 'auto',
                model: payload.model || 'base',
                threads: payload.threads,
                useGpu: payload.useGpu !== false,
                lowLatency: payload.lowLatency === true
            });
            result.latencyMs = Date.now() - startedAt;

            console.log('[Whisper] Result:', result);

            // Send result to pet window
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                if (result.success && result.text) {
                    ctx.petWindow.webContents.send('user-speech-update', {
                        text: result.text,
                        isListening: false,
                        isFinal: true
                    });
                } else {
                    ctx.petWindow.webContents.send('user-speech-update', {
                        text: '',
                        isListening: false,
                        isFinal: true
                    });
                }
            }

            // Cleanup
            safeUnlink(wavFile);
            safeUnlink(tempFile);

            return result;
        } catch (e) {
            console.error('[Whisper] Error:', e);

            // Send error state to pet window
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                ctx.petWindow.webContents.send('user-speech-update', {
                    text: '',
                    isListening: false,
                    isFinal: true
                });
            }

            safeUnlink(tempFile);
            safeUnlink(wavFile);
            return { success: false, error: e.message || 'whisper_failed' };
        } finally {
            whisperBusy = false;
        }
    });

    ipcMain.handle('whisper-stt-check', async () => {
        const whisperExe = getWhisperExecutable();
        const modelPath = getWhisperModel('base');

        console.log('[Whisper] Check - exe:', whisperExe, 'model:', modelPath);

        return {
            available: !!whisperExe && !!modelPath,
            executable: whisperExe,
            model: modelPath
        };
    });
}

module.exports = { registerWhisperSTTIPC };
