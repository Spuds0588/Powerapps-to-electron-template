// ID Scanner Bookmarklet - Generates a CSV of all element ID/value pairs on a page.
// Usage: Copy this code, create a browser bookmark, and paste it as the bookmark URL.
// Or use Research_Tools/Browser_Data_Scanners.html to drag it to your bookmarks bar.

(function () {
    'use strict';

    // Escape CSV values (handle commas, quotes, newlines).
    function escapeCsvValue(value) {
        if (value === null || value === undefined) {
            return '';
        }

        const stringValue = String(value);

        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
            return '"' + stringValue.replace(/"/g, '""') + '"';
        }

        return stringValue;
    }

    // Get an element's value based on its type.
    function getElementValue(element) {
        const tagName = element.tagName.toLowerCase();
        const type = element.type ? element.type.toLowerCase() : '';

        switch (tagName) {
            case 'input':
                if (type === 'checkbox' || type === 'radio') {
                    return element.checked ? 'checked' : 'unchecked';
                } else if (type === 'file') {
                    return element.files.length > 0 ? element.files[0].name : '';
                }
                return element.value || '';

            case 'select':
                return element.value || '';

            case 'textarea':
                return element.value || '';

            case 'button':
                return element.textContent.trim() || element.value || '';

            default:
                return element.textContent.trim();
        }
    }

    // Generate CSV content from every element that has an id.
    function generateCsv() {
        const elementsWithIds = document.querySelectorAll('[id]');
        const csvRows = [];

        csvRows.push('ID,Value,Element Type,Element Tag');

        elementsWithIds.forEach((element) => {
            const id = element.id;
            if (!id.trim()) {
                return;
            }

            csvRows.push([
                escapeCsvValue(id),
                escapeCsvValue(getElementValue(element)),
                escapeCsvValue(element.type || 'N/A'),
                escapeCsvValue(element.tagName.toLowerCase())
            ].join(','));
        });

        return csvRows.join('\n');
    }

    function downloadCsv(csvContent, filename) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');

        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            alert('Your browser does not support automatic downloads. Please copy the CSV content manually.');
        }
    }

    try {
        console.log('ID Scanner Bookmarklet: Starting scan...');

        const csvContent = generateCsv();
        const elementsCount = document.querySelectorAll('[id]').length;
        const defaultFilename = `page-ids-${new Date().toISOString().slice(0, 10)}.csv`;

        const filename = prompt(
            `Found ${elementsCount} elements with IDs on this page.\n\nCSV content generated successfully!\n\nEnter filename for CSV download (or press OK for default):`,
            defaultFilename
        );

        if (filename !== null) {
            downloadCsv(csvContent, filename);
            console.log('ID Scanner Bookmarklet: CSV downloaded successfully!');
            alert(`CSV file "${filename}" downloaded successfully!\n\nFound ${elementsCount} elements with IDs.`);
        } else {
            console.log('ID Scanner Bookmarklet: Download cancelled by user.');
        }
    } catch (error) {
        console.error('ID Scanner Bookmarklet Error:', error);
        alert('Error generating CSV: ' + error.message);
    }
})();
