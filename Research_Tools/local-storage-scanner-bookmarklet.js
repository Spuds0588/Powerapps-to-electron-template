// Local Storage Scanner Bookmarklet - Generates a CSV of all local storage key/value pairs.
// Usage: Copy this code, create a browser bookmark, and paste it as the bookmark URL.
// Or use Research_Tools/Browser_Data_Scanners.html to drag it to your bookmarks bar.

(function () {
    'use strict';

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

    // Get a local storage value together with lightweight type information.
    function getLocalStorageInfo(key) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) {
                return { value: '', type: 'null', isJson: false, originalValue: '' };
            }

            try {
                const parsed = JSON.parse(value);
                return { value: JSON.stringify(parsed), type: typeof parsed, isJson: true, originalValue: value };
            } catch (parseError) {
                return { value: value, type: 'string', isJson: false, originalValue: value };
            }
        } catch (error) {
            return { value: `Error: ${error.message}`, type: 'error', isJson: false, originalValue: '' };
        }
    }

    function generateCsv() {
        const csvRows = [];
        csvRows.push('Key,Value,Type,Is JSON,Original Value');

        const keys = Object.keys(localStorage);

        if (keys.length === 0) {
            csvRows.push('No local storage data found');
            return csvRows.join('\n');
        }

        keys.forEach((key) => {
            const info = getLocalStorageInfo(key);
            csvRows.push([
                escapeCsvValue(key),
                escapeCsvValue(info.value),
                escapeCsvValue(info.type),
                escapeCsvValue(info.isJson ? 'Yes' : 'No'),
                escapeCsvValue(info.originalValue)
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
        console.log('Local Storage Scanner Bookmarklet: Starting scan...');

        const csvContent = generateCsv();
        const keysCount = Object.keys(localStorage).length;
        const defaultFilename = `local-storage-${new Date().toISOString().slice(0, 10)}.csv`;

        const filename = prompt(
            `Found ${keysCount} local storage keys on this page.\n\nCSV content generated successfully!\n\nEnter filename for CSV download (or press OK for default):`,
            defaultFilename
        );

        if (filename !== null) {
            downloadCsv(csvContent, filename);
            console.log('Local Storage Scanner Bookmarklet: CSV downloaded successfully!');
            alert(`CSV file "${filename}" downloaded successfully!\n\nFound ${keysCount} local storage keys.`);
        } else {
            console.log('Local Storage Scanner Bookmarklet: Download cancelled by user.');
        }
    } catch (error) {
        console.error('Local Storage Scanner Bookmarklet Error:', error);
        alert('Error generating CSV: ' + error.message);
    }
})();
