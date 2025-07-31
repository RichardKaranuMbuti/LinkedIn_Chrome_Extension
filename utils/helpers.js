// utils/helpers.js
// Utility functions used throughout the extension

const HELPERS = {
    /**
     * Add delay for rate limiting
     */
    delay: (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Generate random delay between min and max
     */
    getRandomDelay: (min, max) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * Clean and normalize text content
     */
    cleanText: (text) => {
        if (!text) return 'N/A';
        
        return text
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, ' ')
            .replace(/\t+/g, ' ');
    },

    /**
     * Validate URL format
     */
    isValidUrl: (string) => {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    },

    /**
     * Format date for display
     */
    formatDate: (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    },

    /**
     * Calculate duration between timestamps
     */
    calculateDuration: (startTime, endTime) => {
        const duration = endTime - startTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    },

    /**
     * Escape CSV field content
     */
    escapeCSV: (field) => {
        if (field === null || field === undefined) return '';
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    },

    /**
     * Generate unique ID
     */
    generateId: () => {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Debounce function
     */
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Throttle function
     */
    throttle: (func, limit) => {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    },

    /**
     * Deep clone object
     */
    deepClone: (obj) => {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Check if running in extension context
     */
    isExtensionContext: () => {
        return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
    },

    /**
     * Log with timestamp (only if logging enabled)
     */
    log: (message, ...args) => {
        if (console && console.log) {
            console.log(`[${new Date().toISOString()}] ${message}`, ...args);
        }
    },

    /**
     * Error logging
     */
    logError: (error, context = '') => {
        if (console && console.error) {
            console.error(`[${new Date().toISOString()}] ERROR${context ? ' ' + context : ''}:`, error);
        }
    }
};

// Make helpers available globally
if (typeof window !== 'undefined') {
    window.HELPERS = HELPERS;
}