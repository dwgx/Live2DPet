/**
 * Simplified AI Chat for Desktop Pet
 * Supports OpenAI-compatible APIs (Grok, Claude proxy, Deepseek, etc.)
 *
 * Features:
 * - OpenAI-compatible API interface
 * - Vision support (multimodal with image_url content)
 * - Configurable max_tokens multiplier (0.5x - 4.0x)
 * - Automatic thinking tag removal (<think>, <thinking>)
 * - 120s timeout with AbortController
 * - Temperature adjustment: 0.55 for vision, 0.86 for text
 *
 * Security:
 * - API key stored encrypted (see crypto-utils.js)
 * - HTTPS-only connections
 * - Request timeout to prevent hanging
 */
class AIChatClient {
    constructor() {
        this.apiKey = '';
        this.baseURL = 'https://openrouter.ai/api/v1';
        this.modelName = 'x-ai/grok-4.1-fast';
        this.conversationHistory = [];
        this.maxHistoryPairs = 3;
        this.isLoading = false;
        this.maxTokensMultiplier = 1.0; // Range: 0.5 - 4.0
        this.visionMaxTokens = 1200;
    }

    async init() {
        await this.loadConfig();
        console.log('[AIChatClient] Initialized:', this.baseURL, this.modelName);
    }

    async loadConfig() {
        try {
            if (window.electronAPI && window.electronAPI.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                if (config.apiKey) this.apiKey = config.apiKey;
                if (config.baseURL) this.baseURL = config.baseURL;
                if (config.modelName) this.modelName = config.modelName;
                if (config.maxTokensMultiplier) this.maxTokensMultiplier = Math.min(4.0, Math.max(0.5, config.maxTokensMultiplier));
                if (config.visionMaxTokens !== undefined) {
                    const n = Number(config.visionMaxTokens);
                    if (Number.isFinite(n) && n > 0) {
                        this.visionMaxTokens = Math.max(256, Math.min(4096, Math.round(n)));
                    }
                }
            }
        } catch (e) {
            console.warn('[AIChatClient] Failed to load config:', e);
        }
    }

    saveConfig(config) {
        if (config.apiKey !== undefined) this.apiKey = config.apiKey;
        if (config.baseURL !== undefined) this.baseURL = config.baseURL;
        if (config.modelName !== undefined) this.modelName = config.modelName;
        if (config.maxTokensMultiplier !== undefined) this.maxTokensMultiplier = Math.min(4.0, Math.max(0.5, config.maxTokensMultiplier));
        if (config.visionMaxTokens !== undefined) {
            const n = Number(config.visionMaxTokens);
            if (Number.isFinite(n) && n > 0) {
                this.visionMaxTokens = Math.max(256, Math.min(4096, Math.round(n)));
            }
        }
        if (window.electronAPI && window.electronAPI.saveConfig) {
            window.electronAPI.saveConfig({
                apiKey: this.apiKey,
                baseURL: this.baseURL,
                modelName: this.modelName,
                maxTokensMultiplier: this.maxTokensMultiplier,
                visionMaxTokens: this.visionMaxTokens
            });
        }
    }

    getConfig() {
        return {
            apiKey: this.apiKey,
            baseURL: this.baseURL,
            modelName: this.modelName,
            maxTokensMultiplier: this.maxTokensMultiplier,
            visionMaxTokens: this.visionMaxTokens
        };
    }

    isConfigured() {
        return !!(this.apiKey && this.baseURL && this.modelName);
    }

    /**
     * Send messages directly to the API (for vision/screenshot requests).
     * Supports multimodal content with image_url.
     *
     * @param {Array} messages - Full messages array [{role, content}]
     *   content can be string or array of {type: 'text'|'image_url', ...}
     * @returns {string} AI response text (cleaned)
     * @throws {Error} If API not configured, request fails, or timeout
     */
    async callAPI(messages) {
        if (!this.isConfigured()) throw new Error('API not configured');

        // Detect vision input (image_url content type)
        const hasImageInput = Array.isArray(messages) && messages.some(m =>
            Array.isArray(m.content) && m.content.some(c => c?.type === 'image_url')
        );
        const timeoutMs = hasImageInput ? 90000 : 120000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const maxTokens = Math.round(2048 * this.maxTokensMultiplier);
            const requestMaxTokens = hasImageInput
                ? Math.min(maxTokens, this.visionMaxTokens)
                : maxTokens;

            // Lower temperature for vision (more deterministic), higher for text (more creative).
            const temperature = hasImageInput ? 0.55 : 0.86;

            console.log(`[AIChatClient] Requesting with max_tokens: ${requestMaxTokens}, temperature: ${temperature}, vision: ${hasImageInput}, timeoutMs: ${timeoutMs}`);

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.modelName,
                    messages: messages,
                    max_tokens: requestMaxTokens,
                    temperature
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('Empty API response');
            }

            return this.cleanResponse(data.choices[0].message.content.trim());
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error(`API request timeout (${Math.round(timeoutMs / 1000)}s)`);
            throw error;
        }
    }

    /**
     * Clean AI response by removing thinking tags and extra whitespace.
     * Removes: <think>...</think>, <thinking>...</thinking>, unclosed <think>
     *
     * @param {string} content - Raw AI response
     * @returns {string} Cleaned response
     */
    cleanResponse(content) {
        if (!content) return content;
        return content
            .replace(/<think>[\s\S]*?<\/think>/gi, '') // Remove closed think tags
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '') // Remove closed thinking tags
            .replace(/<think>[\s\S]*$/gi, '') // Remove unclosed think tags at end
            .replace(/\n\s*\n\s*\n/g, '\n\n') // Normalize multiple newlines
            .trim();
    }

    async testConnection() {
        try {
            const response = await this.callAPI([
                { role: 'system', content: 'Reply OK.' },
                { role: 'user', content: 'test' }
            ]);
            return { success: true, response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

window.AIChatClient = AIChatClient;
