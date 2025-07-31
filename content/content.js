// content/content.js
// Purpose: Main content script that runs on LinkedIn pages

class LinkedInJobScraper {
    constructor() {
        this.isRunning = false;
        this.currentPage = 0;
        this.totalPages = 1;
        this.extractedJobs = [];
        this.processedJobIds = new Set();
        this.maxRetries = 3;
        this.retryDelay = 2000;
        
        this.initializeContentScript();
    }

    /**
     * Initialize the content script with message listeners and DOM observers
     */
    initializeContentScript() {
        console.log('LinkedIn Job Scraper content script initialized');
        
        // Listen for messages from popup or background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep the message channel open for async responses
        });

        // Observer for dynamic content loading
        this.setupDOMObserver();
    }

    /**
     * Handle incoming messages from popup/background
     */
    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'START_SCRAPING':
                    await this.handleScrapeRequest(message.data);
                    sendResponse({ success: true });
                    break;
                    
                case 'STOP_SCRAPING':
                    this.stopScraping();
                    sendResponse({ success: true });
                    break;
                    
                case 'GET_CURRENT_URL':
                    sendResponse({ url: window.location.href });
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
     * Main scraping coordination function
     */
    async handleScrapeRequest(searchParams) {
        if (this.isRunning) {
            this.sendProgressUpdate({ 
                type: 'error', 
                message: 'Scraping already in progress' 
            });
            return;
        }

        this.isRunning = true;
        this.extractedJobs = [];
        this.processedJobIds.clear();
        this.currentPage = 0;

        try {
            const { jobTitle, location, numPages = 5 } = searchParams;
            this.totalPages = numPages;

            this.sendProgressUpdate({ 
                type: 'info', 
                message: `Starting to scrape ${jobTitle} jobs in ${location}`,
                progress: 0
            });

            // Navigate to jobs search page
            await this.navigateToJobsPage(jobTitle, location);
            
            // Wait for page to load
            await this.waitForPageLoad();

            // Extract jobs from multiple pages
            for (let page = 0; page < numPages; page++) {
                this.currentPage = page;
                
                this.sendProgressUpdate({
                    type: 'info',
                    message: `Scraping page ${page + 1} of ${numPages}`,
                    progress: Math.round((page / numPages) * 50) // 50% for listing extraction
                });

                if (page > 0) {
                    await this.navigateToNextPage(page);
                    await this.waitForPageLoad();
                }

                const jobListings = await this.extractJobListings();
                this.extractedJobs.push(...jobListings);

                // Add delay between pages
                await this.delay(this.getRandomDelay(2000, 4000));
                
                if (!this.isRunning) break; // Check if stopped
            }

            // Now extract detailed information for each job
            await this.extractJobDetails();

            this.sendProgressUpdate({
                type: 'complete',
                message: `Successfully scraped ${this.extractedJobs.length} jobs`,
                data: this.extractedJobs,
                progress: 100
            });

        } catch (error) {
            console.error('Scraping error:', error);
            this.sendProgressUpdate({
                type: 'error',
                message: `Scraping failed: ${error.message}`
            });
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Navigate to LinkedIn jobs search page
     */
    async navigateToJobsPage(jobTitle, location) {
        const encodedTitle = encodeURIComponent(jobTitle);
        const encodedLocation = encodeURIComponent(location);
        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodedTitle}&location=${encodedLocation}`;
        
        if (window.location.href !== searchUrl) {
            window.location.href = searchUrl;
            // Wait for navigation to complete
            await new Promise(resolve => {
                const checkUrl = () => {
                    if (window.location.href.includes('/jobs/search/')) {
                        resolve();
                    } else {
                        setTimeout(checkUrl, 500);
                    }
                };
                checkUrl();
            });
        }
    }

    /**
     * Navigate to next page of results
     */
    async navigateToNextPage(pageNum) {
        const currentUrl = new URL(window.location.href);
        const startParam = pageNum * 25; // LinkedIn shows 25 jobs per page
        currentUrl.searchParams.set('start', startParam.toString());
        
        window.location.href = currentUrl.toString();
    }

    /**
     * Wait for page to load completely
     */
    async waitForPageLoad() {
        return new Promise((resolve) => {
            const checkForContent = () => {
                const jobsContainer = document.querySelector('ul.jobs-search__results-list') || 
                                    document.querySelector('div.jobs-search-results-list') ||
                                    document.querySelector('.scaffold-layout__list');
                
                if (jobsContainer && jobsContainer.children.length > 0) {
                    // Additional wait for dynamic content
                    setTimeout(resolve, 2000);
                } else {
                    setTimeout(checkForContent, 1000);
                }
            };
            
            setTimeout(checkForContent, 1000); // Initial delay
        });
    }

    /**
     * Extract job listings from current page
     */
    async extractJobListings() {
        const jobExtractor = new JobExtractor();
        const jobElements = this.getJobElements();
        const jobs = [];

        for (const element of jobElements) {
            try {
                const jobData = jobExtractor.extractJobListingData(element);
                
                // Avoid duplicates
                if (!this.processedJobIds.has(jobData.jobId)) {
                    jobs.push(jobData);
                    this.processedJobIds.add(jobData.jobId);
                }
            } catch (error) {
                console.error('Error extracting job from element:', error);
            }
        }

        console.log(`Extracted ${jobs.length} jobs from current page`);
        return jobs;
    }

    /**
     * Get job elements from the page
     */
    getJobElements() {
        // Try multiple selectors for job cards
        const selectors = [
            'ul.jobs-search__results-list > li',
            'div.jobs-search-results-list > div',
            '.scaffold-layout__list > div',
            '[data-job-id]'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                return Array.from(elements);
            }
        }

        return [];
    }

    /**
     * Extract detailed information for all jobs
     */
    async extractJobDetails() {
        const totalJobs = this.extractedJobs.length;
        let processedCount = 0;

        for (const job of this.extractedJobs) {
            if (!this.isRunning) break;

            try {
                this.sendProgressUpdate({
                    type: 'info',
                    message: `Getting details for job ${processedCount + 1} of ${totalJobs}`,
                    progress: 50 + Math.round((processedCount / totalJobs) * 50)
                });

                const details = await this.scrapeJobDetails(job.jobUrl);
                Object.assign(job, details);

                processedCount++;
                
                // Add delay between detail requests
                await this.delay(this.getRandomDelay(1000, 3000));
                
            } catch (error) {
                console.error(`Error getting details for job ${job.jobId}:`, error);
                // Continue with next job
            }
        }
    }

    /**
     * Scrape detailed job information from job URL
     */
    async scrapeJobDetails(jobUrl) {
        return new Promise((resolve) => {
            // Create hidden iframe to load job details
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = jobUrl;
            
            const cleanup = () => {
                if (iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            };

            iframe.onload = () => {
                try {
                    setTimeout(() => {
                        const jobExtractor = new JobExtractor();
                        const details = jobExtractor.extractJobDetails(iframe.contentDocument);
                        cleanup();
                        resolve(details);
                    }, 2000); // Wait for dynamic content
                } catch (error) {
                    console.error('Error extracting job details:', error);
                    cleanup();
                    resolve({
                        jobDescription: 'N/A',
                        seniorityLevel: 'N/A',
                        employmentType: 'N/A',
                        jobFunction: 'N/A',
                        industries: 'N/A',
                        applicants: 'N/A',
                        datePosted: 'N/A'
                    });
                }
            };

            iframe.onerror = () => {
                cleanup();
                resolve({
                    jobDescription: 'N/A',
                    seniorityLevel: 'N/A',
                    employmentType: 'N/A',
                    jobFunction: 'N/A',
                    industries: 'N/A',
                    applicants: 'N/A',
                    datePosted: 'N/A'
                });
            };

            document.body.appendChild(iframe);

            // Timeout fallback
            setTimeout(() => {
                cleanup();
                resolve({
                    jobDescription: 'N/A',
                    seniorityLevel: 'N/A',
                    employmentType: 'N/A',
                    jobFunction: 'N/A',
                    industries: 'N/A',
                    applicants: 'N/A',
                    datePosted: 'N/A'
                });
            }, 15000);
        });
    }

    /**
     * Send progress updates to popup
     */
    sendProgressUpdate(update) {
        chrome.runtime.sendMessage({
            action: 'PROGRESS_UPDATE',
            data: update
        }).catch(error => {
            console.error('Error sending progress update:', error);
        });
    }

    /**
     * Stop the scraping process
     */
    stopScraping() {
        this.isRunning = false;
        this.sendProgressUpdate({
            type: 'info',
            message: 'Scraping stopped by user'
        });
    }

    /**
     * Setup DOM observer for dynamic content
     */
    setupDOMObserver() {
        const observer = new MutationObserver((mutations) => {
            // Handle dynamic content changes if needed
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Handle rate limiting with random delays
     */
    async handleRateLimiting() {
        const delay = this.getRandomDelay(3000, 7000);
        await this.delay(delay);
    }

    /**
     * Utility functions
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getRandomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

// Initialize the scraper when content script loads
let scraper;
if (window.location.hostname.includes('linkedin.com')) {
    scraper = new LinkedInJobScraper();
}