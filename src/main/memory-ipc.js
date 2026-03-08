/**
 * Memory IPC - Handle memory persistence via file system
 */
const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');

function setupMemoryIPC(app) {
    const memoryFilePath = path.join(app.getPath('userData'), 'memories.json');
    const memoryBackupPath = memoryFilePath + '.bak';
    const tempFilePath = memoryFilePath + '.tmp';

    async function atomicWriteMemory(dataOrText) {
        const text = typeof dataOrText === 'string'
            ? dataOrText
            : JSON.stringify(dataOrText, null, 2);

        await fs.mkdir(path.dirname(memoryFilePath), { recursive: true });
        await fs.writeFile(tempFilePath, text, 'utf-8');

        try {
            await fs.rename(tempFilePath, memoryFilePath);
        } catch (error) {
            // Windows may reject rename over existing target.
            if (['EEXIST', 'EPERM', 'EBUSY'].includes(error.code)) {
                await fs.unlink(memoryFilePath).catch(() => {});
                await fs.rename(tempFilePath, memoryFilePath);
            } else {
                throw error;
            }
        }

        // Keep a last-known-good backup for crash/corruption recovery.
        await fs.writeFile(memoryBackupPath, text, 'utf-8').catch(() => {});
    }

    async function tryReadJson(filePath) {
        const raw = await fs.readFile(filePath, 'utf-8');
        return { raw, json: JSON.parse(raw) };
    }

    // Save memories to file
    ipcMain.handle('memory:save', async (event, data) => {
        try {
            await atomicWriteMemory(data);
            return { success: true };
        } catch (error) {
            console.error('[Memory IPC] Save failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Load memories from file
    ipcMain.handle('memory:load', async () => {
        try {
            try {
                const primary = await tryReadJson(memoryFilePath);
                return { success: true, data: primary.json };
            } catch (primaryErr) {
                if (primaryErr.code === 'ENOENT') {
                    return { success: true, data: null };
                }
                console.warn('[Memory IPC] Primary memory file invalid, trying backup:', primaryErr.message);
                try {
                    const backup = await tryReadJson(memoryBackupPath);
                    // Restore primary from backup for future reads.
                    await atomicWriteMemory(backup.raw);
                    return { success: true, data: backup.json, restoredFromBackup: true };
                } catch (backupErr) {
                    throw backupErr;
                }
            }
        } catch (error) {
            console.error('[Memory IPC] Load failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Export memories
    ipcMain.handle('memory:export', async () => {
        try {
            try {
                const data = await fs.readFile(memoryFilePath, 'utf-8');
                return { success: true, data };
            } catch (err) {
                const backup = await fs.readFile(memoryBackupPath, 'utf-8');
                return { success: true, data: backup };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Import memories
    ipcMain.handle('memory:import', async (event, jsonData) => {
        try {
            // Validate JSON first
            JSON.parse(jsonData);
            await atomicWriteMemory(jsonData);
            return { success: true };
        } catch (error) {
            console.error('[Memory IPC] Import failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Clear all memories
    ipcMain.handle('memory:clear', async () => {
        try {
            await fs.unlink(memoryFilePath);
            await fs.unlink(memoryBackupPath).catch(() => {});
            await fs.unlink(tempFilePath).catch(() => {});
            return { success: true };
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.unlink(memoryBackupPath).catch(() => {});
                await fs.unlink(tempFilePath).catch(() => {});
                return { success: true }; // Already doesn't exist
            }
            return { success: false, error: error.message };
        }
    });

    // Manual save trigger (gets memories from renderer)
    ipcMain.handle('memory:manual-save', async (event, data) => {
        try {
            // If data provided, save it; otherwise just return success
            if (data && data.memories) {
                await atomicWriteMemory(data);
                console.log(`[Memory IPC] Manual save: ${data.memories.length} memories`);
            }
            return { success: true };
        } catch (error) {
            console.error('[Memory IPC] Manual save failed:', error);
            return { success: false, error: error.message };
        }
    });

    console.log('[Memory IPC] Initialized, file path:', memoryFilePath);
}

module.exports = { setupMemoryIPC };
