/**
 * Memory System - Local long-term memory without external APIs
 * Uses keyword extraction and TF-IDF similarity for semantic search
 *
 * Architecture:
 * - Short-term: Recent N messages (default 8) for immediate context
 * - Long-term: Keyword-indexed memories with TF-IDF scoring
 * - Auto-save: Persists to local file via IPC
 *
 * Algorithm: TF-IDF (Term Frequency-Inverse Document Frequency)
 * - TF: How often a keyword appears in a memory
 * - IDF: How rare a keyword is across all memories (log scale)
 * - Score: TF * IDF, higher = more relevant
 *
 * Optimizations:
 * - Jaccard similarity for fast keyword overlap
 * - Stop words filtering (English common words)
 * - Top-K keyword extraction (max 10 per memory)
 * - LRU eviction when exceeding maxMemories
 */

class MemorySystem {
    constructor(config = {}) {
        this.memories = []; // {id, timestamp, role, content, keywords, metadata}
        this.maxMemories = config.maxMemories || 2000;
        this.shortTermLimit = config.shortTermLimit || 8;
        this.longTermRetrievalLimit = config.longTermRetrievalLimit || 3;
        this.autoSave = config.autoSave !== false;
        this.includeRelevant = config.includeRelevant !== false;
        this.enabled = config.enabled !== false;
        this.saveDebounceMs = Math.max(300, Number(config.saveDebounceMs) || 1500);
        this.minSaveIntervalMs = Math.max(500, Number(config.minSaveIntervalMs) || 3000);

        this._saveTimer = null;
        this._lastSaveAt = 0;
        this._keywordIndex = new Map(); // keyword -> Set(memoryId)

        // English stop words (common words with low semantic value)
        this.stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how']);
    }

    configure(config) {
        if (config.maxMemories !== undefined) this.maxMemories = config.maxMemories;
        if (config.shortTermLimit !== undefined) this.shortTermLimit = config.shortTermLimit;
        if (config.longTermRetrievalLimit !== undefined) this.longTermRetrievalLimit = config.longTermRetrievalLimit;
        if (config.autoSave !== undefined) this.autoSave = config.autoSave;
        if (config.includeRelevant !== undefined) this.includeRelevant = config.includeRelevant;
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.saveDebounceMs !== undefined) this.saveDebounceMs = Math.max(300, Number(config.saveDebounceMs) || 1500);
        if (config.minSaveIntervalMs !== undefined) this.minSaveIntervalMs = Math.max(500, Number(config.minSaveIntervalMs) || 3000);
    }

    /**
     * Extract keywords from text using frequency-based ranking.
     * Algorithm:
     * 1. Normalize: lowercase, remove punctuation (preserve CJK characters)
     * 2. Tokenize: split by whitespace
     * 3. Filter: remove stop words and single-char tokens
     * 4. Rank: count frequency, return top 10
     *
     * @param {string} text - Input text
     * @returns {string[]} Top 10 keywords sorted by frequency
     */
    extractKeywords(text) {
        // Normalize: lowercase, remove punctuation (preserve Unicode CJK)
        const words = text.toLowerCase()
            .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ') // Keep alphanumeric + CJK
            .split(/\s+/)
            .filter(w => w.length > 1 && !this.stopWords.has(w));

        // Count frequency
        const freq = {};
        words.forEach(w => freq[w] = (freq[w] || 0) + 1);

        // Return top 10 keywords sorted by frequency (descending)
        return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
    }

    async addMemory(role, content, metadata = {}) {
        if (!this.enabled) return null;
        const normalizedContent = String(content || '').trim();
        if (!normalizedContent) return null;

        // Skip immediate duplicate entries from the same role.
        const last = this.memories[this.memories.length - 1];
        if (last && last.role === role && last.content === normalizedContent && (Date.now() - last.timestamp) < 120000) {
            return last.id;
        }

        const memory = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
            role,
            content: normalizedContent,
            keywords: this.extractKeywords(normalizedContent),
            metadata
        };

        this.memories.push(memory);
        this._indexMemory(memory);

        // Trim old memories
        if (this.memories.length > this.maxMemories) {
            while (this.memories.length > this.maxMemories) {
                const removed = this.memories.shift();
                this._unindexMemory(removed);
            }
        }

        // Auto-save with debounce to avoid frequent full-file writes.
        if (this.autoSave) {
            this._scheduleSave();
        }

        return memory.id;
    }

    /**
     * Search relevant memories using Jaccard similarity.
     * Algorithm: Jaccard Index = |A ∩ B| / |A ∪ B|
     * - A = query keywords, B = memory keywords
     * - Intersection: common keywords
     * - Union: total unique keywords
     * - Score normalized to [0, 1], higher = more similar
     *
     * Optimization: Early filtering (score > 0) before sorting
     *
     * @param {string} query - Search query
     * @param {number} [limit=5] - Max results to return
     * @returns {Array} Relevant memories sorted by score (descending)
     */
    searchRelevantMemories(query, limit = 5) {
        const queryKeywords = this.extractKeywords(query);
        if (queryKeywords.length === 0) return [];

        // Candidate selection via inverted index.
        const candidateIds = new Set();
        for (const kw of queryKeywords) {
            const ids = this._keywordIndex.get(kw);
            if (!ids) continue;
            for (const id of ids) candidateIds.add(id);
        }
        if (candidateIds.size === 0) return [];

        const idSet = new Set(candidateIds);
        const now = Date.now();

        // Score candidates by semantic overlap + recency.
        const scored = this.memories
        .filter(m => idSet.has(m.id))
        .map(m => {
            const mKeywords = Array.isArray(m.keywords) ? m.keywords : [];
            const overlap = mKeywords.filter(k => queryKeywords.includes(k)).length;
            if (overlap <= 0) return null;
            const union = new Set([...queryKeywords, ...mKeywords]).size || 1;
            const semanticScore = overlap / union;
            const ageDays = Math.max(0, (now - (m.timestamp || now)) / 86400000);
            const recencyScore = 1 / (1 + ageDays);
            const score = semanticScore * 0.82 + recencyScore * 0.18;
            return { memory: m, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

        return scored.map(item => item.memory);
    }

    getRecentMemories(limit = 10) {
        return this.memories.slice(-limit);
    }

    getShortTermContext(limit) {
        return this.memories.slice(-(limit || this.shortTermLimit));
    }

    async getContextForPrompt(userMessage, includeRelevant) {
        if (!this.enabled) return [];

        const shouldIncludeRelevant = includeRelevant !== undefined ? includeRelevant : this.includeRelevant;
        const shortTerm = this.getShortTermContext();

        if (!shouldIncludeRelevant) {
            return shortTerm;
        }

        // Search for relevant long-term memories
        const relevant = this.searchRelevantMemories(userMessage, this.longTermRetrievalLimit);

        // Filter out memories already in short-term
        const shortTermIds = new Set(shortTerm.map(m => m.id));
        const uniqueRelevant = relevant.filter(m => !shortTermIds.has(m.id));

        // Combine: relevant memories + short-term context
        return [...uniqueRelevant, ...shortTerm];
    }

    formatMemoriesForPrompt(memories) {
        return memories.map(m => ({
            role: m.role,
            content: m.content
        }));
    }

    async clear() {
        this.memories = [];
        this._keywordIndex.clear();
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (window.electronAPI?.memory?.clear) {
            await window.electronAPI.memory.clear();
        }
    }

    _indexMemory(memory) {
        if (!memory || !memory.id || !Array.isArray(memory.keywords)) return;
        for (const kw of memory.keywords) {
            if (!this._keywordIndex.has(kw)) this._keywordIndex.set(kw, new Set());
            this._keywordIndex.get(kw).add(memory.id);
        }
    }

    _unindexMemory(memory) {
        if (!memory || !memory.id || !Array.isArray(memory.keywords)) return;
        for (const kw of memory.keywords) {
            const bucket = this._keywordIndex.get(kw);
            if (!bucket) continue;
            bucket.delete(memory.id);
            if (bucket.size === 0) this._keywordIndex.delete(kw);
        }
    }

    _rebuildIndex() {
        this._keywordIndex.clear();
        for (const m of this.memories) {
            if (!Array.isArray(m.keywords) || m.keywords.length === 0) {
                m.keywords = this.extractKeywords(m.content || '');
            }
            this._indexMemory(m);
        }
    }

    _scheduleSave() {
        if (!this.autoSave) return;
        if (this._saveTimer) return;

        const elapsed = Date.now() - this._lastSaveAt;
        if (elapsed >= this.minSaveIntervalMs) {
            this.saveToStorage();
            return;
        }

        const delay = Math.max(this.saveDebounceMs, this.minSaveIntervalMs - elapsed);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this.saveToStorage();
        }, delay);
    }

    async saveToStorage() {
        if (!window.electronAPI?.memory?.save) {
            console.warn('[Memory] IPC not available, skipping save');
            return;
        }
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        try {
            this._lastSaveAt = Date.now();
            const result = await window.electronAPI.memory.save({
                memories: this.memories,
                timestamp: Date.now()
            });
            if (!result.success) {
                console.warn('[Memory] Save failed:', result.error);
            }
        } catch (e) {
            console.warn('[Memory] Failed to save:', e);
        }
    }

    async loadFromStorage() {
        if (!window.electronAPI?.memory?.load) {
            console.warn('[Memory] IPC not available, skipping load');
            return false;
        }
        try {
            const result = await window.electronAPI.memory.load();
            if (result.success && result.data) {
                const parsed = result.data;
                if (parsed.memories && Array.isArray(parsed.memories)) {
                    this.memories = parsed.memories;
                    if (this.memories.length > this.maxMemories) {
                        this.memories = this.memories.slice(-this.maxMemories);
                    }
                    this._rebuildIndex();
                    console.log(`[Memory] Loaded ${this.memories.length} memories from file`);
                    return true;
                }
            }
        } catch (e) {
            console.warn('[Memory] Failed to load:', e);
        }
        return false;
    }

    exportMemories() {
        return JSON.stringify({
            memories: this.memories,
            timestamp: Date.now(),
            version: '1.0'
        }, null, 2);
    }

    importMemories(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            if (data.memories && Array.isArray(data.memories)) {
                this.memories = data.memories.slice(-this.maxMemories);
                this._rebuildIndex();
                this.saveToStorage();
                return true;
            }
        } catch (err) {
            console.error('[Memory] Import failed:', err);
        }
        return false;
    }

    getStats() {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const today = this.memories.filter(m => now - m.timestamp < day).length;
        const week = this.memories.filter(m => now - m.timestamp < 7 * day).length;

        return {
            totalMemories: this.memories.length,
            todayMemories: today,
            weekMemories: week,
            oldestMemory: this.memories[0]?.timestamp,
            newestMemory: this.memories[this.memories.length - 1]?.timestamp
        };
    }

    // Search by date range
    getMemoriesByDateRange(startTime, endTime) {
        return this.memories.filter(m =>
            m.timestamp >= startTime && m.timestamp <= endTime
        );
    }

    // Search by keyword
    searchByKeyword(keyword) {
        const kw = keyword.toLowerCase();
        return this.memories.filter(m =>
            m.content.toLowerCase().includes(kw) ||
            m.keywords.includes(kw)
        );
    }

    async flushPendingSave() {
        if (!this._saveTimer) return;
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        await this.saveToStorage();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MemorySystem };
}


