/**
 * LinkedIn Job Scraper - Popup Interface Controller
 * Handles user interactions, form submissions, and communication with content scripts
 */

class PopupController {
    constructor() {
        this.currentTabId = null;
        this.isScrapingActive = false;
        this.scrapingStartTime = null;
        this.totalJobsFound = 0;
        
        this.initializePopup();
    }

    /**
     * Initialize popup interface and set up event listeners
     */
    async initializePopup() {
        try {
            // Get current active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTabId = tab.id;

            // Check if we're on LinkedIn
            if (!tab.url.includes('linkedin.com')) {
                this.showStatusMessage('Please navigate to LinkedIn first', 'warning');
                this.disableSearchForm();
                return;
            }

            // Set up event listeners
            this.setupEventListeners();
            
            // Load recent searches
            await this.loadRecentSearches();
            
            // Load saved form data
            await this.loadSavedFormData();
            
            // Check if scraping is already in progress
            await this.checkScrapingStatus();

        } catch (error) {
            console.error('Error initializing popup:', error);
            this.showStatusMessage('Error initializing extension', 'error');
        }
    }

    /**
     * Set up all event listeners for the popup interface
     */
    setupEventListeners() {
        // Search form submission
        document.getElementById('searchForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSearchSubmit();
        });

        // Stop scraping button
        document.getElementById('stopScraping').addEventListener('click', () => {
            this.handleStopScraping();
        });

        // Export data button
        document.getElementById('exportData').addEventListener('click', () => {
            this.handleExportData();
        });

        // View jobs button
        document.getElementById('viewJobs').addEventListener('click', () => {
            this.handleViewJobs();
        });

        // New search button
        document.getElementById('newSearch').addEventListener('click', () => {
            this.handleNewSearch();
        });

        // Help link
        document.getElementById('helpLink').addEventListener('click', (e) => {
            e.preventDefault();
            this.openHelpPage();
        });

        // Listen for messages from content script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleContentScriptMessage(message, sender, sendResponse);
        });

        // Form input changes (for auto-save)
        ['jobTitle', 'location', 'maxPages'].forEach(fieldId => {
            document.getElementById(fieldId).addEventListener('input', () => {
                this.saveFormData();
            });
        });
    }

    /**
     * Handle search form submission
     */
    async handleSearchSubmit() {
        try {
            const formData = this.getFormData();
            
            // Validate form data
            if (!this.validateFormData(formData)) {
                return;
            }

            // Check if content script is ready
            const isReady = await this.checkContentScriptReady();
            if (!isReady) {
                this.showStatusMessage('Please refresh the LinkedIn page and try again', 'error');
                return;
            }

            // Start scraping process
            await this.startScraping(formData);

        } catch (error) {
            console.error('Error handling search submit:', error);
            this.showStatusMessage('Error starting search', 'error');
        }
    }

    /**
     * Start the scraping process
     */
    async startScraping(searchParams) {
        try {
            this.isScrapingActive = true;
            this.scrapingStartTime = Date.now();
            this.totalJobsFound = 0;

            // Update UI to show progress
            this.showProgressSection();
            this.hideSection('searchForm');
            this.hideSection('recentSearches');
            this.hideSection('resultsSection');

            // Save search to history
            await this.saveSearchHistory(searchParams);

            // Send message to content script to start scraping
            const response = await chrome.tabs.sendMessage(this.currentTabId, {
                type: 'START_SCRAPING',
                data: searchParams
            });

            if (!response || !response.success) {
                throw new Error(response?.error || 'Failed to start scraping');
            }

            this.updateProgress(0, 'Starting job search...');

        } catch (error) {
            console.error('Error starting scraping:', error);
            this.showStatusMessage('Failed to start scraping: ' + error.message, 'error');
            this.resetToSearchForm();
        }
    }

    /**
     * Handle stop scraping request
     */
    async handleStopScraping() {
        try {
            // Send stop message to content script
            await chrome.tabs.sendMessage(this.currentTabId, {
                type: 'STOP_SCRAPING'
            });

            this.isScrapingActive = false;
            this.showStatusMessage('Scraping stopped by user', 'warning');
            this.resetToSearchForm();

        } catch (error) {
            console.error('Error stopping scraping:', error);
            this.resetToSearchForm();
        }
    }

    /**
     * Handle messages from content script
     */
    handleContentScriptMessage(message, sender, sendResponse) {
        switch (message.type) {
            case 'PROGRESS_UPDATE':
                this.handleProgressUpdate(message.data);
                break;
            
            case 'SCRAPING_COMPLETE':
                this.handleScrapingComplete(message.data);
                break;
            
            case 'SCRAPING_ERROR':
                this.handleScrapingError(message.data);
                break;
            
            case 'JOB_FOUND':
                this.handleJobFound(message.data);
                break;

            default:
                console.log('Unknown message type:', message.type);
        }
        
        sendResponse({ success: true });
    }

    /**
     * Handle progress updates from content script
     */
    handleProgressUpdate(data) {
        const { current, total, status, jobsFound } = data;
        
        if (jobsFound !== undefined) {
            this.totalJobsFound = jobsFound;
            document.getElementById('jobsFound').textContent = jobsFound;
        }

        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        this.updateProgress(percentage, status);
    }

    /**
     * Handle scraping completion
     */
    handleScrapingComplete(data) {
        this.isScrapingActive = false;
        const duration = Date.now() - this.scrapingStartTime;
        
        this.showResultsSection({
            totalJobs: data.jobsFound || this.totalJobsFound,
            successRate: data.successRate || '100%',
            duration: Math.round(duration / 1000) + 's',
            errors: data.errors || 0
        });

        this.hideSection('progressSection');
        
        if (data.jobsFound > 0) {
            this.showStatusMessage(`Successfully scraped ${data.jobsFound} jobs!`, 'success');
        } else {
            this.showStatusMessage('No jobs found. Try different search terms.', 'warning');
        }
    }

    /**
     * Handle scraping errors
     */
    handleScrapingError(data) {
        this.isScrapingActive = false;
        this.showStatusMessage('Scraping error: ' + data.message, 'error');
        this.resetToSearchForm();
    }

    /**
     * Handle individual job found notification
     */
    handleJobFound(data) {
        this.totalJobsFound++;
        document.getElementById('jobsFound').textContent = this.totalJobsFound;
    }

    /**
     * Update progress display
     */
    updateProgress(percentage, status) {
        document.getElementById('progressFill').style.width = `${percentage}%`;
        document.getElementById('progressText').textContent = status;
    }

    /**
     * Export scraped data
     */
    async handleExportData() {
        try {
            // Get stored job data
            const jobData = await StorageManager.getJobData();
            
            if (!jobData || jobData.length === 0) {
                this.showStatusMessage('No data to export', 'warning');
                return;
            }

            // Convert to CSV format
            const csvData = this.convertToCSV(jobData);
            
            // Create download
            const blob = new Blob([csvData], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `linkedin_jobs_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            
            URL.revokeObjectURL(url);
            this.showStatusMessage('Data exported successfully', 'success');

        } catch (error) {
            console.error('Error exporting data:', error);
            this.showStatusMessage('Error exporting data', 'error');
        }
    }

    /**
     * View jobs in options page
     */
    handleViewJobs() {
        chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    }

    /**
     * Reset to new search
     */
    handleNewSearch() {
        this.resetToSearchForm();
        this.clearFormData();
    }

    /**
     * Utility Methods
     */

    getFormData() {
        return {
            jobTitle: document.getElementById('jobTitle').value.trim(),
            location: document.getElementById('location').value.trim(),
            maxPages: parseInt(document.getElementById('maxPages').value)
        };
    }

    validateFormData(data) {
        if (!data.jobTitle) {
            this.showStatusMessage('Please enter a job title', 'error');
            return false;
        }
        if (!data.location) {
            this.showStatusMessage('Please enter a location', 'error');
            return false;
        }
        return true;
    }

    async checkContentScriptReady() {
        try {
            const response = await chrome.tabs.sendMessage(this.currentTabId, {
                type: 'PING'
            });
            return response && response.success;
        } catch (error) {
            return false;
        }
    }

    async saveFormData() {
        const formData = this.getFormData();
        await StorageManager.saveUserSettings({ lastSearch: formData });
    }

    async loadSavedFormData() {
        try {
            const settings = await StorageManager.getUserSettings();
            if (settings && settings.lastSearch) {
                const { jobTitle, location, maxPages } = settings.lastSearch;
                if (jobTitle) document.getElementById('jobTitle').value = jobTitle;
                if (location) document.getElementById('location').value = location;
                if (maxPages) document.getElementById('maxPages').value = maxPages;
            }
        } catch (error) {
            console.error('Error loading saved form data:', error);
        }
    }

    async saveSearchHistory(searchParams) {
        const searchEntry = {
            ...searchParams,
            timestamp: Date.now(),
            id: generateId()
        };
        await StorageManager.saveSearchHistory(searchEntry);
        await this.loadRecentSearches();
    }

    async loadRecentSearches() {
        try {
            const history = await StorageManager.getSearchHistory();
            if (history && history.length > 0) {
                this.displayRecentSearches(history.slice(0, 5)); // Show last 5 searches
            }
        } catch (error) {
            console.error('Error loading recent searches:', error);
        }
    }

    displayRecentSearches(searches) {
        const container = document.getElementById('recentList');
        const section = document.getElementById('recentSearches');
        
        if (searches.length === 0) {
            section.classList.add('hidden');
            return;
        }

        container.innerHTML = searches.map(search => `
            <div class="recent-item" data-job-title="${search.jobTitle}" data-location="${search.location}">
                <span class="recent-text">${search.jobTitle} in ${search.location}</span>
                <span class="recent-date">${new Date(search.timestamp).toLocaleDateString()}</span>
            </div>
        `).join('');

        // Add click handlers for recent searches
        container.querySelectorAll('.recent-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('jobTitle').value = item.dataset.jobTitle;
                document.getElementById('location').value = item.dataset.location;
            });
        });

        section.classList.remove('hidden');
    }

    convertToCSV(jobData) {
        const headers = [
            'Job ID', 'Job Title', 'Company Name', 'Location', 'Job URL',
            'Listing Date', 'Job Description', 'Seniority Level', 'Employment Type',
            'Job Function', 'Industries', 'Applicants', 'Date Posted', 'Scraped At'
        ];

        const csvRows = [headers.join(',')];
        
        jobData.forEach(job => {
            const row = headers.map(header => {
                const key = header.toLowerCase().replace(/ /g, '_');
                const value = job[key] || '';
                return `"${value.toString().replace(/"/g, '""')}"`;
            });
            csvRows.push(row.join(','));
        });

        return csvRows.join('\n');
    }

    async checkScrapingStatus() {
        try {
            const response = await chrome.tabs.sendMessage(this.currentTabId, {
                type: 'GET_STATUS'
            });
            
            if (response && response.isActive) {
                this.isScrapingActive = true;
                this.showProgressSection();
                this.hideSection('searchForm');
            }
        } catch (error) {
            // Content script not ready or no active scraping
        }
    }

    /**
     * UI Helper Methods
     */

    showSection(sectionId) {
        document.getElementById(sectionId).classList.remove('hidden');
    }

    hideSection(sectionId) {
        document.getElementById(sectionId).classList.add('hidden');
    }

    showProgressSection() {
        this.showSection('progressSection');
        this.updateButtonState('startScraping', true);
    }

    showResultsSection(data) {
        document.getElementById('totalJobs').textContent = data.totalJobs;
        document.getElementById('successRate').textContent = data.successRate;
        document.getElementById('duration').textContent = data.duration;
        this.showSection('resultsSection');
    }

    resetToSearchForm() {
        this.hideSection('progressSection');
        this.hideSection('resultsSection');
        this.showSection('searchForm');
        this.updateButtonState('startScraping', false);
        this.isScrapingActive = false;
    }

    updateButtonState(buttonId, isLoading) {
        const button = document.getElementById(buttonId);
        const spinner = button.querySelector('.btn-spinner');
        const text = button.querySelector('.btn-text');
        
        if (isLoading) {
            button.disabled = true;
            spinner.classList.remove('hidden');
            text.textContent = 'Scraping...';
        } else {
            button.disabled = false;
            spinner.classList.add('hidden');
            text.textContent = 'Start Scraping';
        }
    }

    showStatusMessage(message, type = 'info') {
        const statusElement = document.getElementById('statusMessage');
        const textElement = document.getElementById('statusText');
        
        statusElement.className = `status-message ${type}`;
        textElement.textContent = message;
        statusElement.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 5000);
    }

    disableSearchForm() {
        const form = document.getElementById('searchForm');
        const inputs = form.querySelectorAll('input, select, button');
        inputs.forEach(input => input.disabled = true);
    }

    clearFormData() {
        document.getElementById('jobTitle').value = '';
        document.getElementById('location').value = '';
        document.getElementById('maxPages').value = '2';
    }

    openHelpPage() {
        chrome.tabs.create({
            url: 'https://github.com/your-repo/linkedin-job-scraper-extension/wiki'
        });
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});