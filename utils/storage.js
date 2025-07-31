// storage.js
// Purpose: Centralized storage management
// Main Functions:

// saveJobData(jobs): Store scraped job data
// getJobData(filters): Retrieve stored jobs
// saveSearchHistory(search): Store search parameters
// getSearchHistory(): Retrieve recent searches
// saveUserSettings(settings): Store user preferences
// getUserSettings(): Retrieve user settings
// clearOldData(daysOld): Clean up old stored data

// background/storage.js
// Purpose: Utility class for handling data storage, caching, and data management

class StorageManager {
    constructor() {
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
        this.maxCacheSize = 50 * 1024 * 1024; // 50MB
        this.compressionThreshold = 1024; // 1KB
        
        this.initializeStorage();
    }

    /**
     * Initialize storage manager
     */
    async initializeStorage() {
        console.log('Storage Manager initialized');
        
        // Check and migrate old data format if needed
        await this.migrateDataIfNeeded();
        
        // Initialize storage structure
        await this.ensureStorageStructure();
        
        // Schedule cleanup
        this.scheduleCleanup();
    }

    /**
     * Ensure proper storage structure exists
     */
    async ensureStorageStructure() {
        try {
            const localStorage = await chrome.storage.local.get([
                'scrapingIndex',
                'scrapingHistory',
                'cacheIndex',
                'storageStats',
                'lastCleanup'
            ]);

            const updates = {};

            if (!localStorage.scrapingIndex) {
                updates.scrapingIndex = [];
            }

            if (!localStorage.scrapingHistory) {
                updates.scrapingHistory = [];
            }

            if (!localStorage.cacheIndex) {
                updates.cacheIndex = new Map();
            }

            if (!localStorage.storageStats) {
                updates.storageStats = {
                    totalJobs: 0,
                    totalSessions: 0,
                    storageUsed: 0,
                    lastCalculated: Date.now()
                };
            }

            if (!localStorage.lastCleanup) {
                updates.lastCleanup = Date.now();
            }

            if (Object.keys(updates).length > 0) {
                await chrome.storage.local.set(updates);
            }

        } catch (error) {
            console.error('Error ensuring storage structure:', error);
        }
    }

    /**
     * Save scraping session data with optimization
     */
    async saveScrapingSession(sessionData) {
        try {
            const sessionId = sessionData.id;
            const storageKey = `scraping_result_${sessionId}`;

            // Optimize data before saving
            const optimizedData = await this.optimizeDataForStorage(sessionData);

            // Check storage quota
            await this.checkStorageQuota();

            // Save main data
            await chrome.storage.local.set({ [storageKey]: optimizedData });

            // Update index
            await this.updateScrapingIndex(sessionData);

            // Update statistics
            await this.updateStorageStats();

            console.log(`Saved session ${sessionId} with ${sessionData.jobs?.length || 0} jobs`);

            return { success: true, sessionId, dataSize: this.getDataSize(optimizedData) };

        } catch (error) {
            console.error('Error saving scraping session:', error);
            throw error;
        }
    }

    /**
     * Optimize data for storage (compression, deduplication)
     */
    async optimizeDataForStorage(data) {
        try {
            const optimized = { ...data };

            // Remove redundant data
            if (optimized.jobs) {
                optimized.jobs = optimized.jobs.map(job => this.cleanJobData(job));
                
                // Deduplicate jobs
                optimized.jobs = this.deduplicateJobs(optimized.jobs);
            }

            // Compress large text fields
            if (optimized.jobs) {
                for (const job of optimized.jobs) {
                    if (job.jobDescription && job.jobDescription.length > this.compressionThreshold) {
                        job.jobDescription = await this.compressText(job.jobDescription);
                        job._compressed = true;
                    }
                }
            }

            return optimized;

        } catch (error) {
            console.error('Error optimizing data:', error);
            return data;
        }
    }

    /**
     * Clean job data to remove unnecessary fields
     */
    cleanJobData(job) {
        const cleaned = { ...job };

        // Remove empty or null values
        Object.keys(cleaned).forEach(key => {
            if (cleaned[key] === null || cleaned[key] === undefined || cleaned[key] === '') {
                cleaned[key] = 'N/A';
            }
        });

        // Standardize date formats
        if (cleaned.listingDate && cleaned.listingDate !== 'N/A') {
            cleaned.listingDate = this.standardizeDate(cleaned.listingDate);
        }

        if (cleaned.datePosted && cleaned.datePosted !== 'N/A') {
            cleaned.datePosted = this.standardizeDate(cleaned.datePosted);
        }

        // Trim whitespace from text fields
        const textFields = ['jobTitle', 'companyName', 'location', 'seniorityLevel', 'employmentType', 'jobFunction', 'industries'];
        textFields.forEach(field => {
            if (typeof cleaned[field] === 'string') {
                cleaned[field] = cleaned[field].trim();
            }
        });

        return cleaned;
    }

    /**
     * Deduplicate jobs based on job ID and URL
     */
    deduplicateJobs(jobs) {
        const seen = new Set();
        return jobs.filter(job => {
            const key = `${job.jobId}_${job.jobUrl}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    /**
     * Compress text using simple compression
     */
    async compressText(text) {
        try {
            // Simple compression - remove extra whitespace and standardize
            return text
                .replace(/\s+/g, ' ')
                .replace(/\n+/g, '\n')
                .trim();
        } catch (error) {
            console.error('Error compressing text:', error);
            return text;
        }
    }

    /**
     * Decompress text if needed
     */
    async decompressText(text, isCompressed = false) {
        if (!isCompressed) {
            return text;
        }
        
        try {
            // Add decompression logic here if using actual compression
            return text;
        } catch (error) {
            console.error('Error decompressing text:', error);
            return text;
        }
    }

    /**
     * Standardize date format
     */
    standardizeDate(dateStr) {
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) {
                return dateStr; // Return original if can't parse
            }
            return date.toISOString();
        } catch (error) {
            return dateStr;
        }
    }

    /**
     * Update scraping index
     */
    async updateScrapingIndex(sessionData) {
        try {
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];

            const indexEntry = {
                id: sessionData.id,
                timestamp: sessionData.startTime,
                endTime: sessionData.endTime,
                params: sessionData.params,
                jobCount: sessionData.jobs?.length || 0,
                duration: sessionData.endTime - sessionData.startTime,
                status: sessionData.status,
                dataSize: this.getDataSize(sessionData)
            };

            // Remove existing entry if it exists
            const existingIndex = index.findIndex(entry => entry.id === sessionData.id);
            if (existingIndex !== -1) {
                index[existingIndex] = indexEntry;
            } else {
                index.unshift(indexEntry);
            }

            // Limit index size
            const maxIndexEntries = 1000;
            if (index.length > maxIndexEntries) {
                const removedEntries = index.splice(maxIndexEntries);
                
                // Clean up old data
                for (const entry of removedEntries) {
                    await this.deleteScrapingSession(entry.id);
                }
            }

            await chrome.storage.local.set({ scrapingIndex: index });

        } catch (error) {
            console.error('Error updating scraping index:', error);
        }
    }

    /**
     * Get scraping session by ID
     */
    async getScrapingSession(sessionId) {
        try {
            const storageKey = `scraping_result_${sessionId}`;
            const result = await chrome.storage.local.get([storageKey]);
            const sessionData = result[storageKey];

            if (sessionData) {
                // Decompress data if needed
                if (sessionData.jobs) {
                    for (const job of sessionData.jobs) {
                        if (job._compressed && job.jobDescription) {
                            job.jobDescription = await this.decompressText(job.jobDescription, true);
                            delete job._compressed;
                        }
                    }
                }
            }

            return sessionData || null;

        } catch (error) {
            console.error('Error getting scraping session:', error);
            return null;
        }
    }

    /**
     * Get multiple scraping sessions with pagination
     */
    async getScrapingSessions(options = {}) {
        try {
            const { limit = 50, offset = 0, filters = {} } = options;
            
            const result = await chrome.storage.local.get(['scrapingIndex']);
            let index = result.scrapingIndex || [];

            // Apply filters
            index = this.applyFilters(index, filters);

            // Sort by timestamp (newest first)
            index.sort((a, b) => b.timestamp - a.timestamp);

            // Apply pagination
            const paginatedIndex = index.slice(offset, offset + limit);

            // Get detailed data for paginated entries
            const sessions = [];
            for (const indexEntry of paginatedIndex) {
                const session = await this.getScrapingSession(indexEntry.id);
                if (session) {
                    sessions.push(session);
                }
            }

            return {
                sessions,
                total: index.length,
                hasMore: offset + limit < index.length,
                nextOffset: offset + limit
            };

        } catch (error) {
            console.error('Error getting scraping sessions:', error);
            return { sessions: [], total: 0, hasMore: false, nextOffset: 0 };
        }
    }

    /**
     * Apply filters to index
     */
    applyFilters(index, filters) {
        let filtered = [...index];

        if (filters.startDate) {
            const startTime = new Date(filters.startDate).getTime();
            filtered = filtered.filter(entry => entry.timestamp >= startTime);
        }

        if (filters.endDate) {
            const endTime = new Date(filters.endDate).getTime();
            filtered = filtered.filter(entry => entry.timestamp <= endTime);
        }

        if (filters.jobTitle) {
            const searchTerm = filters.jobTitle.toLowerCase();
            filtered = filtered.filter(entry => 
                entry.params?.jobTitle?.toLowerCase().includes(searchTerm)
            );
        }

        if (filters.location) {
            const searchTerm = filters.location.toLowerCase();
            filtered = filtered.filter(entry => 
                entry.params?.location?.toLowerCase().includes(searchTerm)
            );
        }

        if (filters.status) {
            filtered = filtered.filter(entry => entry.status === filters.status);
        }

        if (filters.minJobs) {
            filtered = filtered.filter(entry => entry.jobCount >= filters.minJobs);
        }

        return filtered;
    }

    /**
     * Search jobs across all sessions
     */
    async searchJobs(searchOptions = {}) {
        try {
            const { 
                query = '', 
                filters = {}, 
                limit = 100, 
                sortBy = 'relevance' 
            } = searchOptions;

            const sessionResult = await this.getScrapingSessions({ limit: 50 });
            const allJobs = [];

            // Collect all jobs from sessions
            for (const session of sessionResult.sessions) {
                if (session.jobs) {
                    for (const job of session.jobs) {
                        allJobs.push({
                            ...job,
                            sessionId: session.id,
                            sessionTimestamp: session.startTime
                        });
                    }
                }
            }

            // Apply search query
            let filteredJobs = allJobs;
            if (query) {
                const searchTerm = query.toLowerCase();
                filteredJobs = allJobs.filter(job => 
                    job.jobTitle?.toLowerCase().includes(searchTerm) ||
                    job.companyName?.toLowerCase().includes(searchTerm) ||
                    job.jobDescription?.toLowerCase().includes(searchTerm) ||
                    job.location?.toLowerCase().includes(searchTerm)
                );
            }

            // Apply filters
            filteredJobs = this.applyJobFilters(filteredJobs, filters);

            // Sort results
            filteredJobs = this.sortJobs(filteredJobs, sortBy);

            // Apply limit
            filteredJobs = filteredJobs.slice(0, limit);

            return {
                jobs: filteredJobs,
                total: filteredJobs.length,
                searchTerm: query,
                filters: filters
            };

        } catch (error) {
            console.error('Error searching jobs:', error);
            return { jobs: [], total: 0, searchTerm: query, filters: filters };
        }
    }

    /**
     * Apply filters to jobs
     */
    applyJobFilters(jobs, filters) {
        let filtered = [...jobs];

        if (filters.company) {
            const searchTerm = filters.company.toLowerCase();
            filtered = filtered.filter(job => 
                job.companyName?.toLowerCase().includes(searchTerm)
            );
        }

        if (filters.location) {
            const searchTerm = filters.location.toLowerCase();
            filtered = filtered.filter(job => 
                job.location?.toLowerCase().includes(searchTerm)
            );
        }

        if (filters.seniorityLevel) {
            filtered = filtered.filter(job => 
                job.seniorityLevel === filters.seniorityLevel
            );
        }

        if (filters.employmentType) {
            filtered = filtered.filter(job => 
                job.employmentType === filters.employmentType
            );
        }

        if (filters.datePosted) {
            const cutoffTime = Date.now() - (filters.datePosted * 24 * 60 * 60 * 1000);
            filtered = filtered.filter(job => {
                const jobDate = new Date(job.datePosted).getTime();
                return jobDate >= cutoffTime;
            });
        }

        return filtered;
    }

    /**
     * Sort jobs based on criteria
     */
    sortJobs(jobs, sortBy) {
        switch (sortBy) {
            case 'date':
                return jobs.sort((a, b) => 
                    new Date(b.datePosted).getTime() - new Date(a.datePosted).getTime()
                );
            
            case 'company':
                return jobs.sort((a, b) => 
                    (a.companyName || '').localeCompare(b.companyName || '')
                );
            
            case 'title':
                return jobs.sort((a, b) => 
                    (a.jobTitle || '').localeCompare(b.jobTitle || '')
                );
            
            case 'sessionDate':
                return jobs.sort((a, b) => b.sessionTimestamp - a.sessionTimestamp);
            
            default: // relevance
                return jobs;
        }
    }

    /**
     * Delete scraping session
     */
    async deleteScrapingSession(sessionId) {
        try {
            const storageKey = `scraping_result_${sessionId}`;
            
            // Remove main data
            await chrome.storage.local.remove([storageKey]);

            // Update index
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];
            const updatedIndex = index.filter(entry => entry.id !== sessionId);
            await chrome.storage.local.set({ scrapingIndex: updatedIndex });

            // Update stats
            await this.updateStorageStats();

            console.log(`Deleted session ${sessionId}`);
            return { success: true };

        } catch (error) {
            console.error('Error deleting scraping session:', error);
            throw error;
        }
    }

    /**
     * Delete multiple sessions
     */
    async deleteMultipleSessions(sessionIds) {
        try {
            const keysToRemove = sessionIds.map(id => `scraping_result_${id}`);
            
            // Remove main data
            await chrome.storage.local.remove(keysToRemove);

            // Update index
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];
            const updatedIndex = index.filter(entry => !sessionIds.includes(entry.id));
            await chrome.storage.local.set({ scrapingIndex: updatedIndex });

            // Update stats
            await this.updateStorageStats();

            console.log(`Deleted ${sessionIds.length} sessions`);
            return { success: true, deletedCount: sessionIds.length };

        } catch (error) {
            console.error('Error deleting multiple sessions:', error);
            throw error;
        }
    }

    /**
     * Export data in various formats
     */
    async exportData(options = {}) {
        try {
            const { format = 'json', filters = {}, includeDetails = true } = options;
            
            const sessionResult = await this.getScrapingSessions({ 
                limit: 1000, 
                filters 
            });

            let exportData;
            if (includeDetails) {
                exportData = sessionResult.sessions;
            } else {
                // Export only job data
                exportData = [];
                for (const session of sessionResult.sessions) {
                    if (session.jobs) {
                        exportData.push(...session.jobs);
                    }
                }
            }

            switch (format) {
                case 'json':
                    return {
                        data: JSON.stringify(exportData, null, 2),
                        filename: `linkedin_jobs_${Date.now()}.json`,
                        mimeType: 'application/json'
                    };

                case 'csv':
                    const csvData = includeDetails ? 
                        this.convertSessionsToCSV(exportData) : 
                        this.convertJobsToCSV(exportData);
                    
                    return {
                        data: csvData,
                        filename: `linkedin_jobs_${Date.now()}.csv`,
                        mimeType: 'text/csv'
                    };

                case 'xlsx':
                    // Would need a library like SheetJS for full Excel support
                    throw new Error('XLSX export not implemented yet');

                default:
                    throw new Error(`Unsupported format: ${format}`);
            }

        } catch (error) {
            console.error('Error exporting data:', error);
            throw error;
        }
    }

    /**
     * Convert sessions to CSV
     */
    convertSessionsToCSV(sessions) {
        if (!sessions.length) return '';

        const allJobs = sessions.flatMap(session => 
            (session.jobs || []).map(job => ({
                ...job,
                sessionId: session.id,
                searchParams: JSON.stringify(session.params),
                sessionDate: new Date(session.startTime).toISOString()
            }))
        );

        return this.convertJobsToCSV(allJobs);
    }

    /**
     * Convert jobs to CSV
     */
    convertJobsToCSV(jobs) {
        if (!jobs.length) return '';

        const headers = [
            'jobId', 'jobTitle', 'companyName', 'location', 'jobUrl',
            'jobDescription', 'seniorityLevel', 'employmentType', 'jobFunction',
            'industries', 'applicants', 'datePosted', 'listingDate'
        ];

        // Add session-specific headers if present
        if (jobs[0]?.sessionId) {
            headers.push('sessionId', 'searchParams', 'sessionDate');
        }

        const csvRows = [headers.join(',')];

        for (const job of jobs) {
            const row = headers.map(header => {
                let value = job[header] || '';
                
                // Handle special cases
                if (typeof value === 'object') {
                    value = JSON.stringify(value);
                }
                
                // Escape quotes and wrap in quotes
                value = value.toString().replace(/"/g, '""');
                return `"${value}"`;
            });
            
            csvRows.push(row.join(','));
        }

        return csvRows.join('\n');
    }

    /**
     * Get storage statistics
     */
    async getStorageStats() {
        try {
            const result = await chrome.storage.local.get(['storageStats']);
            let stats = result.storageStats || {
                totalJobs: 0,
                totalSessions: 0,
                storageUsed: 0,
                lastCalculated: Date.now()
            };

            // Recalculate if data is old
            const ageLimit = 60 * 60 * 1000; // 1 hour
            if (Date.now() - stats.lastCalculated > ageLimit) {
                stats = await this.calculateStorageStats();
            }

            return stats;

        } catch (error) {
            console.error('Error getting storage stats:', error);
            return {
                totalJobs: 0,
                totalSessions: 0,
                storageUsed: 0,
                lastCalculated: Date.now()
            };
        }
    }

    /**
     * Calculate current storage statistics
     */
    async calculateStorageStats() {
        try {
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];

            let totalJobs = 0;
            let storageUsed = 0;

            for (const entry of index) {
                totalJobs += entry.jobCount || 0;
                storageUsed += entry.dataSize || 0;
            }

            const stats = {
                totalJobs,
                totalSessions: index.length,
                storageUsed,
                lastCalculated: Date.now()
            };

            await chrome.storage.local.set({ storageStats: stats });
            return stats;

        } catch (error) {
            console.error('Error calculating storage stats:', error);
            throw error;
        }
    }

    /**
     * Update storage statistics
     */
    async updateStorageStats() {
        try {
            await this.calculateStorageStats();
        } catch (error) {
            console.error('Error updating storage stats:', error);
        }
    }

    /**
     * Check storage quota and clean up if needed
     */
    async checkStorageQuota() {
        try {
            const bytesInUse = await chrome.storage.local.getBytesInUse();
            const quota = chrome.storage.local.QUOTA_BYTES;
            const usagePercent = (bytesInUse / quota) * 100;

            console.log(`Storage usage: ${usagePercent.toFixed(2)}% (${bytesInUse}/${quota} bytes)`);

            // Clean up if usage is high
            if (usagePercent > 80) {
                console.log('Storage usage high, initiating cleanup...');
                await this.performStorageCleanup();
            }

        } catch (error) {
            console.error('Error checking storage quota:', error);
        }
    }

    /**
     * Perform storage cleanup
     */
    async performStorageCleanup() {
        try {
            const result = await chrome.storage.local.get(['scrapingIndex']);
            const index = result.scrapingIndex || [];

            // Sort by timestamp (oldest first)
            index.sort((a, b) => a.timestamp - b.timestamp);

            // Remove oldest 25% of sessions
            const removeCount = Math.floor(index.length * 0.25);
            const sessionsToRemove = index.slice(0, removeCount);

            if (sessionsToRemove.length > 0) {
                const sessionIds = sessionsToRemove.map(entry => entry.id);
                await this.deleteMultipleSessions(sessionIds);
                
                console.log(`Cleaned up ${removeCount} old sessions`);
            }

        } catch (error) {
            console.error('Error performing storage cleanup:', error);
        }
    }

    /**
     * Get data size in bytes
     */
    getDataSize(data) {
        try {
            return new Blob([JSON.stringify(data)]).size;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Schedule periodic cleanup
     */
    scheduleCleanup() {
        // Run cleanup every 6 hours
        setInterval(() => {
            this.checkStorageQuota();
        }, 6 * 60 * 60 * 1000);
    }

    /**
     * Migrate old data format if needed
     */
    async migrateDataIfNeeded() {
        try {
            // Check for old data format and migrate if necessary
            const allKeys = await chrome.storage.local.get();
            const oldFormatKeys = Object.keys(allKeys).filter(key => 
                key.startsWith('linkedin_jobs_') && !key.startsWith('scraping_result_')
            );

            if (oldFormatKeys.length > 0) {
                console.log(`Migrating ${oldFormatKeys.length} old format entries...`);
                
                for (const oldKey of oldFormatKeys) {
                    const oldData = allKeys[oldKey];
                    const sessionId = `migrated_${Date.now()}_${Math.random()}`;
                    
                    const newData = {
                        id: sessionId,
                        startTime: oldData.timestamp || Date.now(),
                        endTime: oldData.timestamp || Date.now(),
                        status: 'completed',
                        params: oldData.searchParams || {},
                        jobs: oldData.jobs || oldData,
                        migrated: true
                    };

                    await this.saveScrapingSession(newData);
                    await chrome.storage.local.remove([oldKey]);
                }

                console.log('Migration completed');
            }

        } catch (error) {
            console.error('Error migrating data:', error);
        }
    }

    /**
     * Backup data to download
     */
    async createBackup() {
        try {
            const allData = await chrome.storage.local.get();
            const backup = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                data: allData
            };

            const backupData = JSON.stringify(backup, null, 2);
            const blob = new Blob([backupData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            await chrome.downloads.download({
                url: url,
                filename: `linkedin_scraper_backup_${Date.now()}.json`,
                saveAs: true
            });

            return { success: true };

        } catch (error) {
            console.error('Error creating backup:', error);
            throw error;
        }
    }

    /**
     * Restore data from backup
     */
    async restoreBackup(backupData) {
        try {
            const backup = JSON.parse(backupData);
            
            if (!backup.data || !backup.version) {
                throw new Error('Invalid backup format');
            }

            // Clear existing data
            await chrome.storage.local.clear();

            // Restore backup data
            await chrome.storage.local.set(backup.data);

            // Ensure storage structure
            await this.ensureStorageStructure();

            // Update statistics
            await this.updateStorageStats();

            return { success: true };

        } catch (error) {
            console.error('Error restoring backup:', error);
            throw error;
        }
    }
}

// Make StorageManager available globally
if (typeof window !== 'undefined') {
    window.StorageManager = StorageManager;
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}