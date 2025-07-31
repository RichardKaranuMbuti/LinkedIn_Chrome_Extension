// utils/constants.js
// Constants used throughout the extension

const CONSTANTS = {
    LINKEDIN_BASE_URL: 'https://www.linkedin.com',
    JOBS_SEARCH_PATH: '/jobs/search/',
    
    // Default scraping settings
    DEFAULT_SETTINGS: {
        maxPagesPerScrape: 5,
        delayBetweenPages: 3000,
        delayBetweenJobs: 2000,
        maxRetries: 3,
        autoSaveResults: true,
        enableLogging: true,
        rateLimitDelay: 5000,
        maxConcurrentScrapes: 2,
        dataRetentionDays: 30
    },
    
    // Selectors for different LinkedIn layouts
    SELECTORS: {
        JOB_CARDS: [
            'ul.jobs-search__results-list > li',
            'div.jobs-search-results-list > div',
            '.scaffold-layout__list > div',
            '[data-job-id]'
        ],
        
        JOB_TITLE: [
            'h3.base-search-card__title',
            'a[aria-label]',
            '.job-card-list__title',
            '.job-card-container__link'
        ],
        
        COMPANY_NAME: [
            'h4.base-search-card__subtitle',
            '.artdeco-entity-lockup__subtitle',
            'span[class*="qHYMDgztNEREKlSMgIjhyyyqAxxeVviD"]'
        ],
        
        LOCATION: [
            'span.job-search-card__location',
            'li[class*="bKQmZihARnOXesSdpcmicRgZiMVAUmlKncY"] span',
            'span[dir="ltr"]'
        ],
        
        JOB_LINK: [
            'a.base-card__full-link',
            'a[href*="/jobs/view/"]'
        ]
    },
    
    // Messages
    MESSAGES: {
        SCRAPING_STARTED: 'Scraping started successfully',
        SCRAPING_STOPPED: 'Scraping stopped',
        SCRAPING_COMPLETE: 'Scraping completed',
        SCRAPING_ERROR: 'An error occurred during scraping',
        NO_JOBS_FOUND: 'No jobs found with current search criteria'
    },
    
    // Storage keys
    STORAGE_KEYS: {
        SETTINGS: 'settings',
        SCRAPING_INDEX: 'scrapingIndex',
        SCRAPING_HISTORY: 'scrapingHistory',
        LAST_CLEANUP: 'lastCleanup'
    }
};

// Make constants available globally
if (typeof window !== 'undefined') {
    window.CONSTANTS = CONSTANTS;
}