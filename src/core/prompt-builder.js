/**
 * Standalone Prompt Builder for Desktop Pet
 * No dependency on PromptSystem or game engine
 *
 * Features:
 * - Character card loading (JSON format with i18n support)
 * - Template variable resolution: {{petName}}, {{userIdentity}}, {{userTerm}}
 * - Dynamic context injection (screen analysis, memory, etc.)
 * - Multilingual support (en, zh, ja) via window.I18N
 * - Idle prompt randomization
 *
 * Prompt Structure:
 * 1. Response mode instruction (fast, concise)
 * 2. Character setup (description, personality, scenario)
 * 3. Rules (with emphasis separator)
 * 4. Dynamic context (screen, memory, etc.)
 * 5. Language instruction
 */
class PetPromptBuilder {
    constructor() {
        this.characterPrompt = null;
        this.lang = 'en'; // Default language
    }

    /**
     * i18n helper — reads from window.I18N using stored language
     */
    _t(key) {
        const l = this.lang;
        return (window.I18N && window.I18N[l] && window.I18N[l][key])
            || (window.I18N && window.I18N['en'] && window.I18N['en'][key])
            || key;
    }

    async init() {
        await this.loadCharacterPrompt();
    }

    async loadCharacterPrompt(characterId, lang) {
        if (lang) this.lang = lang;
        // Global language for enhance modules (consumed by enhance-utils.js)
        if (typeof window !== 'undefined') window._enhanceLang = this.lang;
        try {
            // Use IPC to load from main process (handles both dev and packaged paths)
            if (window.electronAPI?.loadPrompt) {
                const result = await window.electronAPI.loadPrompt(characterId || null);
                if (result.success) {
                    this.characterPrompt = result.data;
                    // Resolve i18n for built-in cards
                    if (result.i18n && lang && result.i18n[lang]) {
                        Object.assign(this.characterPrompt, result.i18n[lang]);
                    }
                    console.log(`[PetPromptBuilder] Character loaded: ${this.characterPrompt.name || 'unknown'}`);
                    return;
                }
            }
            // Fallback: fetch from assets (dev mode without IPC)
            const url = characterId
                ? `assets/prompts/${characterId}.json`
                : 'assets/prompts/2bcf3d8a-85e8-47dd-aa07-792fe91cca26.json';
            const response = await fetch(url);
            const data = await response.json();
            this.characterPrompt = data.data || data;
            // Resolve i18n for built-in cards (fetch path)
            if (data.i18n && lang && data.i18n[lang]) {
                Object.assign(this.characterPrompt, data.i18n[lang]);
            }
            console.log(`[PetPromptBuilder] Character loaded (fetch): ${this.characterPrompt.name || 'unknown'}`);
        } catch (error) {
            console.warn('[PetPromptBuilder] Failed to load prompt, using default');
            this.characterPrompt = {
                name: 'Yuki',
                userIdentity: 'sister',
                userTerm: 'you',
                description: 'You are {{petName}}, the user\'s {{userIdentity}}.',
                personality: 'Brief, natural, warm.',
                scenario: 'Responses must be short (1-2 sentences).'
            };
        }
    }

    /**
     * Replace {{petName}}, {{userIdentity}}, {{userTerm}} in text
     */
    resolveTemplate(text) {
        if (!text || !this.characterPrompt) return text;
        const vars = {
            '{{petName}}': this.characterPrompt.name || 'Yuki',
            '{{userIdentity}}': this.characterPrompt.userIdentity || 'user',
            '{{userTerm}}': this.characterPrompt.userTerm || 'you'
        };
        let result = text;
        for (const [placeholder, value] of Object.entries(vars)) {
            result = result.split(placeholder).join(value);
        }
        return result;
    }

    /**
     * Build system prompt with character setup and dynamic context.
     * Prompt structure (order matters for AI comprehension):
     * 1. Fast response mode (top priority)
     * 2. Character identity (description, personality, scenario)
     * 3. Rules (separated with --- for emphasis)
     * 4. Dynamic context (screen, memory, etc.)
     * 5. Language instruction (last)
     *
     * @param {string} [dynamicContext] - Optional context (screen analysis, memory, etc.)
     * @returns {string} Complete system prompt
     */
    buildSystemPrompt(dynamicContext) {
        if (!this.characterPrompt) return 'You are a desktop pet companion.';
        const parts = [];

        // Fast response instruction at the top (highest priority)
        parts.push(this._t('sys.responseMode'));

        // Character setup (identity, personality, scenario)
        if (this.characterPrompt.description) parts.push(this.resolveTemplate(this.characterPrompt.description));
        if (this.characterPrompt.personality) parts.push(this.resolveTemplate(this.characterPrompt.personality));
        if (this.characterPrompt.scenario) parts.push(this.resolveTemplate(this.characterPrompt.scenario));

        // Rules with emphasis, separated from character setup
        if (this.characterPrompt.rules) {
            parts.push('---'); // Visual separator for AI attention
            parts.push(this.resolveTemplate(this.characterPrompt.rules));
            parts.push(this._t('sys.importantReminder'));
        }

        // Dynamic context AFTER rules, clearly separated
        if (dynamicContext) {
            parts.push('---');
            parts.push(dynamicContext);
        }

        // Language instruction last (applies to entire response)
        if (this.characterPrompt.language) {
            parts.push(this._t('sys.useLanguage').replace('{0}', this.characterPrompt.language));
        }

        const prompt = parts.join('\n\n');
        console.log(`[PromptBuilder] System prompt built (${prompt.length} chars), dynamic context: ${dynamicContext ? dynamicContext.length + ' chars' : 'none'}`);
        return prompt;
    }

    getAppDetectionPrompt(appName) {
        return this._t('sys.appDetection').replace('{0}', appName);
    }

    getIdlePrompt() {
        const triggers = [
            this._t('sys.idle1'),
            this._t('sys.idle2'),
            this._t('sys.idle3'),
            this._t('sys.idle4')
        ];
        return triggers[Math.floor(Math.random() * triggers.length)];
    }
}

window.PetPromptBuilder = PetPromptBuilder;
