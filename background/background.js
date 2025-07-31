//background/background.js
// background/background.js
// Purpose: Background script for extension lifecycle management and scraping coordination

class LinkedInScrapingManager {
    constructor() {
        this.activeScrapeJobs = new Map(); // Track active scraping sessions
        this.tabContentScripts = new Set(); // Track tabs with content scripts
        this.scrapingQueue = [];
        this.maxConcurrentScrapes = 2;
        this.retryAttempts = 3;
        this.apiEndpoint = null; // Will be set from options
        
        this.initializeBackgroundScript();
    }

    /**
     * Initialize background script with event listeners
     */
    initializeBackgroundScript() {
        console.log('LinkedIn Job Scraper background script initialized');
        
        // Handle extension installation/updates
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleExtensionInstall(details);
        });

        // Monitor tab updates for LinkedIn pages
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdated(tabId, changeInfo, tab);
        });

        // Handle messages from content scripts and popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });

        // Handle tab removal
        chrome.tabs.onRemoved.addListener((tabId) => {
            this.handleTabRemoved(tabId);
        });

        // Periodic cleanup and maintenance
        this.schedulePeriodicTasks();

        // Load saved settings
        this.loadSettings();
    }

    /**
     * Handle extension installation and setup
     */
    async handleExtensionInstall(details) {
        try {
            if (details.reason === 'install') {
                console.log('Extension installed for the first time');
                await this.setDefaultSettings();
                
                // Open options page for first-time setup
                chrome.tabs.create({
                    url: chrome.runtime.getURL('options/options.html')
                });
            } else if (details.reason === 'update') {
                console.log('Extension updated');
                await this.handleExtensionUpdate(details);
            }
        } catch (error) {
            console.error('Error handling extension install:', error);
        }
    }

    /**
     * Set default extension settings
     */
    async setDefaultSettings() {
        const defaultSettings = {
            maxPagesPerScrape: 5,
            delayBetweenPages: 3000,
            delayBetweenJobs: 2000,
            maxRetries: 3,
            autoSaveResults: true,
            apiEndpoint: '',
            apiKey: '',
            enableLogging: true,
            rateLimitDelay: 5000,
            maxConcurrentScrapes: 2,
            dataRetentionDays: 30
        };

        await chrome.storage.sync.set({ settings: defaultSettings });
        await chrome.storage.local.set({ 
            scrapingHistory: [],
            lastCleanup: Date.now()
        });
    }

    /**
     * Handle extension updates
     */
    async handleExtensionUpdate(details) {
        // Migration logic for settings if needed
        const result = await chrome.storage.sync.get(['settings']);
        if (result.settings) {
            // Update settings with new defaults if needed
            const updatedSettings = {
                ...result.settings,
                // Add any new settings here
            };
            await chrome.storage.sync.set({ settings: updatedSettings });
        }
    }

    /**
     * Monitor tab updates for LinkedIn pages
     */
    async handleTabUpdated(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete' && tab.url && tab.url.includes('linkedin.com')) {
            try {
                await this.injectContentScriptIfNeeded(tabId, tab.url);
            } catch (error) {
                console.error('Error injecting content script:', error);
            }
        }
    }

    /**
     * Inject content script into LinkedIn tabs
     */
    async injectContentScriptIfNeeded(tabId, url) {
        if (this.tabContentScripts.has(tabId)) {
            return; // Already injected
        }

        try {
            // Check if we can inject into this tab
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    return window.location.hostname.includes('linkedin.com');
                }
            });

            // Inject content scripts
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content/job-extractor.js', 'content/content.js']
            });

            this.tabContentScripts.add(tabId);
            console.log(`Content script injected into tab ${tabId}`);

        } catch (error) {
            console.error(`Failed to inject content script into tab ${tabId}:`, error);
        }
    }

    /**
     * Handle tab removal
     */
    handleTabRemoved(tabId) {
        this.tabContentScripts.delete(tabId);
        
        // Cancel any active scraping in this tab
        if (this.activeScrapeJobs.has(tabId)) {
            this.cancelScrapeJob(tabId);
        }
    }

    /**
     * Handle messages from content scripts and popup
     */
    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'START_SCRAPING':
                    await this.handleStartScraping(message.data, sender, sendResponse);
                    break;

                case 'STOP_SCRAPING':
                    await this.handleStopScraping(sender.tab.id);
                    sendResponse({ success: true });
                    break;

                case 'PROGRESS_UPDATE':
                    await this.handleProgressUpdate(message.data, sender);
                    sendResponse({ success: true });
                    break;

                case 'GET_SCRAPING_STATUS':
                    sendResponse({ 
                        active: this.activeScrapeJobs.size,
                        queue: this.scrapingQueue.length 
                    });
                    break;

                case 'GET_SCRAPED_DATA':
                    const data = await this.getScrapedData(message.filters);
                    sendResponse({ data });
                    break;

                case 'EXPORT_DATA':
                    await this.exportData(message.format, message.filters);
                    sendResponse({ success: true });
                    break;

                case 'DELETE_SCRAPED_DATA':
                    await this.deleteScrapedData(message.filters);
                    sendResponse({ success: true });
                    break;

                case 'GET_SETTINGS':
                    const settings = await this.getSettings();
                    sendResponse({ settings });
                    break;

                case 'UPDATE_SETTINGS':
                    await this.updateSettings(message.settings);
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({ error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ error: error.message });
        }
    }

    /**
     * Handle start scraping request
     */
    async handleStartScraping(scrapingParams, sender, sendResponse) {
        const tabId = sender.tab.id;

        // Check if scraping is already active in this tab
        if (this.activeScrapeJobs.has(tabId)) {
            sendResponse({ error: 'Scraping already active in this tab' });
            return;
        }

        // Check concurrent scraping limit
        if (this.activeScrapeJobs.size >= this.maxConcurrentScrapes) {
            this.scrapingQueue.push({ tabId, scrapingParams, timestamp: Date.now() });
            sendResponse({ queued: true, position: this.scrapingQueue.length });
            return;
        }

        await this.startScrapeJob(tabId, scrapingParams);
        sendResponse({ success: true });
    }

    /**
     * Start a scraping job
     */
    async startScrapeJob(tabId, scrapingParams) {
        const jobId = `job_${Date.now()}_${tabId}`;
        const scrapingJob = {
            id: jobId,
            tabId,
            params: scrapingParams,
            startTime: Date.now(),
            status: 'running',
            progress: 0,
            extractedJobs: [],
            errors: []
        };

        this.activeScrapeJobs.set(tabId, scrapingJob);

        try {
            // Send start message to content script
            await chrome.tabs.sendMessage(tabId, {
                action: 'START_SCRAPING',
                data: scrapingParams
            });

            // Store job in history
            await this.addToScrapingHistory(scrapingJob);

        } catch (error) {
            console.error('Error starting scrape job:', error);
            this.activeScrapeJobs.delete(tabId);
            throw error;
        }
    }

    /**
     * Handle stop scraping request
     */
    async handleStopScraping(tabId) {
        await this.cancelScrapeJob(tabId);
    }

    /**
     * Cancel a scraping job
     */
    async cancelScrapeJob(tabId) {
        const job = this.activeScrapeJobs.get(tabId);
        if (job) {
            job.status = 'cancelled';
            job.endTime = Date.now();

            try {
                await chrome.tabs.sendMessage(tabId, {
                    action: 'STOP_SCRAPING'
                });
            } catch (error) {
                console.error('Error sending stop message:', error);
            }

            await this.updateScrapingHistory(job);
            this.activeScrapeJobs.delete(tabId);

            // Process queue
            await this.processScrapingQueue();
        }
    }

    /**
     * Handle progress updates from content script
     */
    async handleProgressUpdate(progressData, sender) {
        const tabId = sender.tab.id;
        const job = this.activeScrapeJobs.get(tabId);

        if (job) {
            job.progress = progressData.progress || 0;
            job.lastUpdate = Date.now();

            if (progressData.type === 'complete') {
                job.status = 'completed';
                job.endTime = Date.now();
                job.extractedJobs = progressData.data || [];

                // Save results
                await this.saveScrapingResults(job);

                // Send to API if configured
                await this.sendToAPI(job);

                // Cleanup
                this.activeScrapeJobs.delete(tabId);

                // Process queue
                await this.processScrapingQueue();

            } else if (progressData.type === 'error') {
                job.errors.push({
                    timestamp: Date.now(),
                    message: progressData.message
                });
            }

            // Broadcast progress to all extension contexts
            await this.broadcastProgress(job);
        }
    }

    /**
     * Process scraping queue
     */
    async processScrapingQueue() {
        if (this.scrapingQueue.length > 0 && this.activeScrapeJobs.size < this.maxConcurrentScrapes) {
            const queuedJob = this.scrapingQueue.shift();
            
            try {
                await this.startScrapeJob(queuedJob.tabId, queuedJob.scrapingParams);
            } catch (error) {
                console.error('Error processing queued job:', error);
            }
        }
    }

    /**
     * Broadcast progress to extension contexts
     */
    async broadcastProgress(job) {
        try {
            // Send to popup if open
            chrome.runtime.sendMessage({
                action: 'SCRAPING_PROGRESS',
                data: {
                    jobId: job.id,
                    tabId: job.tabId,
                    progress: job.progress,
                    status: job.status,
                    extractedCount: job.extractedJobs.length
                }
            }).catch(() => {
                // Popup might not be open, ignore error
            });
        } catch (error) {
            console.error('Error broadcasting progress:', error);
        }
    }

    /**
     * Save scraping results to storage
     */
    async saveScrapingResults(job) {
        try {
            const storageKey = `scraping_result_${job.id}`;
            const resultData = {
                id: job.id,
                params: job.params,
                startTime: job.startTime,
                endTime: job.endTime,
                duration: job.endTime - job.startTime,
                status: job.status,
                jobCount: job.extractedJobs.length,
                jobs: job.extractedJobs,
                errors: job.errors
            };

            await chrome.storage.local.set({ [storageKey]: resultData });

            // Update index
            await this.updateScrapingIndex(job.id, resultData);

            console.log(`Saved ${job.extractedJobs.length} jobs for session ${job.id}`);

        } catch (error) {
            console.error('Error saving scraping results:', error);
        }
    }

    /**
     * Update scraping index for quick access
     */
    async updateScrapingIndex(jobId, resultData) {
        try {
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];

            const indexEntry = {
                id: jobId,
                timestamp: resultData.startTime,
                params: resultData.params,
                jobCount: resultData.jobCount,
                duration: resultData.duration,
                status: resultData.status
            };

            index.unshift(indexEntry);

            // Keep only recent entries (configurable limit)
            const maxEntries = 100;
            if (index.length > maxEntries) {
                const removedEntries = index.splice(maxEntries);
                
                // Clean up old result data
                for (const entry of removedEntries) {
                    await chrome.storage.local.remove(`scraping_result_${entry.id}`);
                }
            }

            await chrome.storage.local.set({ scrapingIndex: index });

        } catch (error) {
            console.error('Error updating scraping index:', error);
        }
    }

    /**
     * Send results to external API
     */
    async sendToAPI(job) {
        try {
            const settings = await this.getSettings();
            
            if (!settings.apiEndpoint || !settings.apiKey) {
                return; // API not configured
            }

            const payload = {
                sessionId: job.id,
                searchParams: job.params,
                timestamp: job.startTime,
                jobCount: job.extractedJobs.length,
                jobs: job.extractedJobs
            };

            const response = await fetch(settings.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log('Successfully sent data to API');
            } else {
                console.error('API request failed:', response.status, response.statusText);
            }

        } catch (error) {
            console.error('Error sending to API:', error);
        }
    }

    /**
     * Get scraped data with filters
     */
    async getScrapedData(filters = {}) {
        try {
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];

            let filteredIndex = index;

            // Apply filters
            if (filters.startDate) {
                filteredIndex = filteredIndex.filter(entry => 
                    entry.timestamp >= new Date(filters.startDate).getTime()
                );
            }

            if (filters.endDate) {
                filteredIndex = filteredIndex.filter(entry => 
                    entry.timestamp <= new Date(filters.endDate).getTime()
                );
            }

            if (filters.jobTitle) {
                filteredIndex = filteredIndex.filter(entry => 
                    entry.params.jobTitle.toLowerCase().includes(filters.jobTitle.toLowerCase())
                );
            }

            if (filters.location) {
                filteredIndex = filteredIndex.filter(entry => 
                    entry.params.location.toLowerCase().includes(filters.location.toLowerCase())
                );
            }

            // Get detailed data for filtered entries
            const detailedData = [];
            for (const indexEntry of filteredIndex.slice(0, filters.limit || 50)) {
                const resultData = await chrome.storage.local.get([`scraping_result_${indexEntry.id}`]);
                if (resultData[`scraping_result_${indexEntry.id}`]) {
                    detailedData.push(resultData[`scraping_result_${indexEntry.id}`]);
                }
            }

            return {
                summary: filteredIndex,
                detailed: detailedData
            };

        } catch (error) {
            console.error('Error getting scraped data:', error);
            return { summary: [], detailed: [] };
        }
    }

    /**
     * Add job to scraping history
     */
    async addToScrapingHistory(job) {
        try {
            const result = await chrome.storage.local.get(['scrapingHistory']);
            const history = result.scrapingHistory || [];

            history.unshift({
                id: job.id,
                params: job.params,
                startTime: job.startTime,
                status: job.status
            });

            // Keep only recent 50 entries
            if (history.length > 50) {
                history.splice(50);
            }

            await chrome.storage.local.set({ scrapingHistory: history });

        } catch (error) {
            console.error('Error adding to scraping history:', error);
        }
    }

    /**
     * Update scraping history entry
     */
    async updateScrapingHistory(job) {
        try {
            const result = await chrome.storage.local.get(['scrapingHistory']);
            const history = result.scrapingHistory || [];

            const index = history.findIndex(entry => entry.id === job.id);
            if (index !== -1) {
                history[index] = {
                    ...history[index],
                    status: job.status,
                    endTime: job.endTime,
                    extractedCount: job.extractedJobs.length
                };

                await chrome.storage.local.set({ scrapingHistory: history });
            }

        } catch (error) {
            console.error('Error updating scraping history:', error);
        }
    }

    /**
     * Export data in various formats
     */
    async exportData(format, filters = {}) {
        try {
            const data = await this.getScrapedData(filters);
            let content, filename, mimeType;

            switch (format) {
                case 'json':
                    content = JSON.stringify(data.detailed, null, 2);
                    filename = `linkedin_jobs_${Date.now()}.json`;
                    mimeType = 'application/json';
                    break;

                case 'csv':
                    content = this.convertToCSV(data.detailed);
                    filename = `linkedin_jobs_${Date.now()}.csv`;
                    mimeType = 'text/csv';
                    break;

                default:
                    throw new Error('Unsupported export format');
            }

            // Create download
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);

            await chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            });

        } catch (error) {
            console.error('Error exporting data:', error);
        }
    }

    /**
     * Convert data to CSV format
     */
    convertToCSV(data) {
        if (!data.length) return '';

        const allJobs = data.flatMap(session => session.jobs || []);
        if (!allJobs.length) return '';

        const headers = Object.keys(allJobs[0]);
        const csvContent = [
            headers.join(','),
            ...allJobs.map(job => 
                headers.map(header => 
                    `"${(job[header] || '').toString().replace(/"/g, '""')}"`
                ).join(',')
            )
        ].join('\n');

        return csvContent;
    }

    /**
     * Delete scraped data
     */
    async deleteScrapedData(filters = {}) {
        try {
            if (filters.all) {
                // Delete all data
                await chrome.storage.local.remove(['scrapingIndex', 'scrapingHistory']);
                
                // Remove all result data
                const allKeys = await chrome.storage.local.get();
                const resultKeys = Object.keys(allKeys).filter(key => 
                    key.startsWith('scraping_result_')
                );
                
                if (resultKeys.length > 0) {
                    await chrome.storage.local.remove(resultKeys);
                }
                
            } else {
                // Delete specific entries based on filters
                const data = await this.getScrapedData(filters);
                const idsToDelete = data.summary.map(entry => entry.id);
                
                for (const id of idsToDelete) {
                    await chrome.storage.local.remove(`scraping_result_${id}`);
                }
                
                // Update index
                const result = await chrome.storage.local.get(['scrapingIndex']);
                const index = result.scrapingIndex || [];
                const updatedIndex = index.filter(entry => !idsToDelete.includes(entry.id));
                
                await chrome.storage.local.set({ scrapingIndex: updatedIndex });
            }

        } catch (error) {
            console.error('Error deleting scraped data:', error);
        }
    }

    /**
     * Get extension settings
     */
    async getSettings() {
        try {
            const result = await chrome.storage.sync.get(['settings']);
            return result.settings || {};
        } catch (error) {
            console.error('Error getting settings:', error);
            return {};
        }
    }

    /**
     * Update extension settings
     */
    async updateSettings(newSettings) {
        try {
            const currentSettings = await this.getSettings();
            const updatedSettings = { ...currentSettings, ...newSettings };
            
            await chrome.storage.sync.set({ settings: updatedSettings });
            
            // Update instance variables
            this.maxConcurrentScrapes = updatedSettings.maxConcurrentScrapes || 2;
            this.apiEndpoint = updatedSettings.apiEndpoint;

        } catch (error) {
            console.error('Error updating settings:', error);
        }
    }

    /**
     * Load settings on startup
     */
    async loadSettings() {
        try {
            const settings = await this.getSettings();
            this.maxConcurrentScrapes = settings.maxConcurrentScrapes || 2;
            this.apiEndpoint = settings.apiEndpoint;
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    /**
     * Schedule periodic maintenance tasks
     */
    schedulePeriodicTasks() {
        // Clean up old data every hour
        setInterval(() => {
            this.cleanupOldData();
        }, 60 * 60 * 1000);

        // Check for stale scraping jobs every 5 minutes
        setInterval(() => {
            this.checkStaleJobs();
        }, 5 * 60 * 1000);
    }

    /**
     * Clean up old data based on retention settings
     */
    async cleanupOldData() {
        try {
            const settings = await this.getSettings();
            const retentionDays = settings.dataRetentionDays || 30;
            const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];

            const validEntries = [];
            const expiredIds = [];

            for (const entry of index) {
                if (entry.timestamp > cutoffTime) {
                    validEntries.push(entry);
                } else {
                    expiredIds.push(entry.id);
                }
            }

            // Remove expired data
            if (expiredIds.length > 0) {
                const keysToRemove = expiredIds.map(id => `scraping_result_${id}`);
                await chrome.storage.local.remove(keysToRemove);
                await chrome.storage.local.set({ scrapingIndex: validEntries });
                
                console.log(`Cleaned up ${expiredIds.length} expired scraping sessions`);
            }

        } catch (error) {
            console.error('Error cleaning up old data:', error);
        }
    }

    /**
     * Check for and handle stale scraping jobs
     */
    async checkStaleJobs() {
        const staleTime = 30 * 60 * 1000; // 30 minutes
        const currentTime = Date.now();

        for (const [tabId, job] of this.activeScrapeJobs) {
            if (currentTime - job.lastUpdate > staleTime) {
                console.log(`Detected stale job in tab ${tabId}, cleaning up...`);
                
                job.status = 'timeout';
                job.endTime = currentTime;
                job.errors.push({
                    timestamp: currentTime,
                    message: 'Job timed out due to inactivity'
                });

                await this.updateScrapingHistory(job);
                this.activeScrapeJobs.delete(tabId);
            }
        }
    }
}

// Initialize the scraping manager
const scrapingManager = new LinkedInScrapingManager();