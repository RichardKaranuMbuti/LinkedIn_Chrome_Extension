// content/job-extractor.js
// Purpose: Handles actual data extraction from LinkedIn DOM

class JobExtractor {
    constructor() {
        this.baseLinkedInUrl = 'https://www.linkedin.com';
        this.setupSelectors();
    }

    /**
     * Setup selectors for different LinkedIn layouts
     */
    setupSelectors() {
        this.selectors = {
            jobCard: {
                title: [
                    'h3.base-search-card__title',
                    'a[aria-label]',
                    '.job-card-list__title',
                    '.job-card-container__link'
                ],
                company: [
                    'h4.base-search-card__subtitle',
                    '.artdeco-entity-lockup__subtitle',
                    'span[class*="qHYMDgztNEREKlSMgIjhyyyqAxxeVviD"]'
                ],
                location: [
                    'span.job-search-card__location',
                    'li[class*="bKQmZihARnOXesSdpcmicRgZiMVAUmlKncY"] span',
                    'span[dir="ltr"]'
                ],
                link: [
                    'a.base-card__full-link',
                    'a[href*="/jobs/view/"]'
                ],
                date: [
                    'time',
                    '.job-search-card__listdate'
                ]
            },
            jobDetails: {
                description: [
                    'div.show-more-less-html__markup',
                    '.description__text',
                    '.jobs-description__content'
                ],
                criteria: [
                    'li.description__job-criteria-item',
                    '.job-criteria'
                ],
                applicants: [
                    'figure.num-applicants__figure',
                    'span.num-applicants__caption',
                    '.applicant-count'
                ],
                datePosted: [
                    'span.posted-time-ago__text',
                    '.job-posted-date'
                ]
            }
        };
    }

    /**
     * Extract data from job card element
     */
    extractJobListingData(jobElement) {
        const jobData = {
            jobId: this.extractJobId(jobElement),
            jobTitle: this.extractTextFromSelectors(jobElement, this.selectors.jobCard.title),
            companyName: this.extractTextFromSelectors(jobElement, this.selectors.jobCard.company),
            location: this.extractTextFromSelectors(jobElement, this.selectors.jobCard.location),
            jobUrl: this.extractJobUrl(jobElement),
            listingDate: this.extractListingDate(jobElement),
            // Default values for detailed info
            jobDescription: 'N/A',
            seniorityLevel: 'N/A',
            employmentType: 'N/A',
            jobFunction: 'N/A',
            industries: 'N/A',
            applicants: 'N/A',
            datePosted: 'N/A'
        };

        return jobData;
    }

    /**
     * Extract job ID using multiple methods
     */
    extractJobId(jobElement) {
        // Method 1: Direct data-job-id attribute
        if (jobElement.hasAttribute('data-job-id')) {
            return jobElement.getAttribute('data-job-id');
        }

        // Method 2: Extract from parent element
        let parent = jobElement.parentElement;
        while (parent && parent !== document.body) {
            if (parent.hasAttribute('data-job-id')) {
                return parent.getAttribute('data-job-id');
            }
            parent = parent.parentElement;
        }

        // Method 3: Extract from link href
        const linkElement = this.findElementBySelectors(jobElement, this.selectors.jobCard.link);
        if (linkElement && linkElement.href) {
            const patterns = [
                /currentJobId=(\d+)/,
                /\/view\/(\d+)/,
                /-at-(\d+)\/?(?:\?|$)/,
                /jobs\/view\/([^\/\?]+)/,
                /-(\d+)\/?(?:\?|$)/
            ];

            for (const pattern of patterns) {
                const match = linkElement.href.match(pattern);
                if (match && match[1]) {
                    const numericId = match[1].replace(/\D/g, '');
                    if (numericId) {
                        return numericId;
                    }
                }
            }
        }

        // Method 4: Extract from classes
        const className = jobElement.className;
        if (className) {
            const classMatch = className.match(/jobs-search-results__list-item_([a-zA-Z0-9]+)/);
            if (classMatch && classMatch[1]) {
                return classMatch[1];
            }
        }

        // Method 5: Check data attributes
        const dataAttrs = ['data-id', 'data-entity-urn', 'data-occludable-job-id'];
        for (const attr of dataAttrs) {
            if (jobElement.hasAttribute(attr)) {
                const attrValue = jobElement.getAttribute(attr);
                const numericMatch = attrValue.match(/(\d+)/);
                if (numericMatch && numericMatch[1]) {
                    return numericMatch[1];
                }
            }
        }

        return 'N/A';
    }

    /**
     * Extract job URL from job element
     */
    extractJobUrl(jobElement) {
        const linkElement = this.findElementBySelectors(jobElement, this.selectors.jobCard.link);
        
        if (linkElement && linkElement.href) {
            let href = linkElement.href;
            
            // Clean URL by removing query parameters
            if (href.includes('?')) {
                href = href.split('?')[0];
            }
            
            // Ensure it's a full URL
            if (!href.startsWith('http')) {
                href = this.baseLinkedInUrl + href;
            }
            
            return href;
        }

        // Fallback: construct URL from job ID if available
        const jobId = this.extractJobId(jobElement);
        if (jobId !== 'N/A') {
            return `${this.baseLinkedInUrl}/jobs/view/${jobId}`;
        }

        return 'N/A';
    }

    /**
     * Extract listing date from job element
     */
    extractListingDate(jobElement) {
        const dateElement = this.findElementBySelectors(jobElement, this.selectors.jobCard.date);
        
        if (dateElement) {
            // Try to get datetime attribute first
            const datetime = dateElement.getAttribute('datetime');
            if (datetime) {
                return datetime;
            }
            
            // Fallback to text content
            const dateText = dateElement.textContent.trim();
            if (dateText) {
                return dateText;
            }
        }

        return 'N/A';
    }

    /**
     * Extract detailed job information from job detail page
     */
    extractJobDetails(document) {
        if (!document) {
            return this.getDefaultJobDetails();
        }

        const details = {
            jobDescription: this.extractJobDescription(document),
            seniorityLevel: 'N/A',
            employmentType: 'N/A',
            jobFunction: 'N/A',
            industries: 'N/A',
            applicants: this.extractApplicantsInfo(document),
            datePosted: this.extractDatePosted(document)
        };

        // Extract job criteria
        const criteria = this.extractJobCriteria(document);
        Object.assign(details, criteria);

        return details;
    }

    /**
     * Extract job description from document
     */
    extractJobDescription(document) {
        const descriptionElement = this.findElementBySelectors(
            document.documentElement, 
            this.selectors.jobDetails.description
        );

        if (descriptionElement) {
            // Get text content and clean it
            let description = descriptionElement.textContent || descriptionElement.innerText || '';
            description = description.trim().replace(/\s+/g, ' ');
            return description;
        }

        return 'N/A';
    }

    /**
     * Extract job criteria (seniority, employment type, function, industries)
     */
    extractJobCriteria(document) {
        const criteria = {
            seniorityLevel: 'N/A',
            employmentType: 'N/A',
            jobFunction: 'N/A',
            industries: 'N/A'
        };

        const criteriaElements = document.querySelectorAll('li.description__job-criteria-item');
        
        for (const item of criteriaElements) {
            const header = item.querySelector('h3.description__job-criteria-subheader');
            const value = item.querySelector('span.description__job-criteria-text');

            if (header && value) {
                const headerText = header.textContent.trim().toLowerCase();
                const valueText = value.textContent.trim();

                if (headerText.includes('seniority')) {
                    criteria.seniorityLevel = valueText;
                } else if (headerText.includes('employment')) {
                    criteria.employmentType = valueText;
                } else if (headerText.includes('function')) {
                    criteria.jobFunction = valueText;
                } else if (headerText.includes('industries')) {
                    criteria.industries = valueText;
                }
            }
        }

        return criteria;
    }

    /**
     * Extract applicants information
     */
    extractApplicantsInfo(document) {
        // Method 1: Figure with caption
        const applicantsFigure = document.querySelector('figure.num-applicants__figure');
        if (applicantsFigure) {
            const caption = applicantsFigure.querySelector('figcaption.num-applicants__caption');
            if (caption) {
                return caption.textContent.trim();
            }
        }

        // Method 2: Direct span
        const applicantsSpan = document.querySelector('span.num-applicants__caption');
        if (applicantsSpan) {
            return applicantsSpan.textContent.trim();
        }

        // Method 3: Search for text containing "applicants"
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (node.textContent.match(/applicants|Be among the first/i)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const textNode = walker.nextNode();
        if (textNode) {
            return textNode.textContent.trim();
        }

        return 'N/A';
    }

    /**
     * Extract date posted information
     */
    extractDatePosted(document) {
        const dateElement = document.querySelector('span.posted-time-ago__text');
        if (dateElement) {
            return dateElement.textContent.trim();
        }

        // Fallback: look for time elements
        const timeElements = document.querySelectorAll('time');
        for (const timeElement of timeElements) {
            const datetime = timeElement.getAttribute('datetime');
            if (datetime) {
                return datetime;
            }
            const timeText = timeElement.textContent.trim();
            if (timeText) {
                return timeText;
            }
        }

        return 'N/A';
    }

    /**
     * Utility function to extract text from multiple selectors
     */
    extractTextFromSelectors(element, selectors) {
        const foundElement = this.findElementBySelectors(element, selectors);
        if (foundElement) {
            return foundElement.textContent.trim() || foundElement.innerText.trim() || 'N/A';
        }
        return 'N/A';
    }

    /**
     * Find element using multiple selectors
     */
    findElementBySelectors(parent, selectors) {
        for (const selector of selectors) {
            try {
                const element = parent.querySelector(selector);
                if (element) {
                    return element;
                }
            } catch (error) {
                console.warn(`Invalid selector: ${selector}`, error);
            }
        }
        return null;
    }

    /**
     * Get default job details structure
     */
    getDefaultJobDetails() {
        return {
            jobDescription: 'N/A',
            seniorityLevel: 'N/A',
            employmentType: 'N/A',
            jobFunction: 'N/A',
            industries: 'N/A',
            applicants: 'N/A',
            datePosted: 'N/A'
        };
    }

    /**
     * Validate extracted data
     */
    validateJobData(jobData) {
        const requiredFields = ['jobId', 'jobTitle', 'companyName', 'jobUrl'];
        
        for (const field of requiredFields) {
            if (!jobData[field] || jobData[field] === 'N/A') {
                console.warn(`Missing or invalid field: ${field}`, jobData);
            }
        }

        // Validate URL format
        if (jobData.jobUrl !== 'N/A' && !jobData.jobUrl.includes('linkedin.com/jobs/view/')) {
            console.warn('Invalid job URL format:', jobData.jobUrl);
        }

        return jobData;
    }

    /**
     * Clean and normalize text content
     */
    cleanText(text) {
        if (!text) return 'N/A';
        
        return text
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, ' ')
            .replace(/\t+/g, ' ');
    }

    /**
     * Extract salary information if available
     */
    extractSalaryInfo(element) {
        const salarySelectors = [
            '.job-search-card__salary-info',
            '.salary-main-rail__salary-info',
            '[data-test-id="salary-info"]'
        ];

        const salaryElement = this.findElementBySelectors(element, salarySelectors);
        if (salaryElement) {
            return this.cleanText(salaryElement.textContent);
        }

        return 'N/A';
    }

    /**
     * Extract job benefits if available
     */
    extractBenefits(document) {
        const benefitsSelectors = [
            '.job-details-benefits-module',
            '.benefits-section',
            '[data-test-id="benefits"]'
        ];

        const benefitsElement = this.findElementBySelectors(
            document.documentElement, 
            benefitsSelectors
        );

        if (benefitsElement) {
            const benefitsList = benefitsElement.querySelectorAll('li, .benefit-item');
            if (benefitsList.length > 0) {
                return Array.from(benefitsList)
                    .map(item => this.cleanText(item.textContent))
                    .filter(benefit => benefit !== 'N/A')
                    .join(', ');
            }
            return this.cleanText(benefitsElement.textContent);
        }

        return 'N/A';
    }
}

// Make JobExtractor available globally
if (typeof window !== 'undefined') {
    window.JobExtractor = JobExtractor;
}