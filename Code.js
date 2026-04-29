// ==========================================
// CONFIGURATION & GLOBALS
// ==========================================
// Fetch the Spreadsheet ID and Folder ID from Apps Script's environment variables (Script Properties)
const DB_ID = PropertiesService.getScriptProperties().getProperty('DB_ID');
const QR_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('QR_FOLDER_ID');

// ==========================================
// ROUTING (The GET Endpoint)
// ==========================================
function doGet(e) {
    // 1. Extract the route parameter from the URL (e.g., ?route=admin)
    // If the URL is just the base URL, route will be undefined.
    const role = e.parameter ? e.parameter.role : 'scanner';
    const route = e.parameter ? e.parameter.route : null;

    // 2. Route the request to the correct HTML view
    if (role === 'admin') {
        if (route === 'logs') {
            return serveHtml('Admin', 'Admin Dashboard - Logs');
        } else if (route === 'students') {
            return serveHtml('Students', 'Admin Dashboard - Students List');
        } else if (route === 'add-student') {
            return serveHtml('AddStudent', 'Admin Dashboard - Add Student');
        }
    }

    // Default fallback: Serve the main Scanner Web App
    return serveHtml('Scanner', 'Security Scanner');
}

/**
 * Helper function to serve HTML files with standard mobile configurations.
 */
function serveHtml(filename, title) {
    return HtmlService.createHtmlOutputFromFile(filename)
        .setTitle(title)
        // The viewport meta tag is CRITICAL for mobile web apps so the camera UI scales correctly
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

/**
 * Get the Web App URL so the frontend can navigate to different routes
 */
function getAppUrl() {
    return ScriptApp.getService().getUrl();
}

// ==========================================
// RPC ENDPOINTS (Called by google.script.run)
// ==========================================

/**
 * Endpoint called by Scanner.html
 * @param {string} scannedData - The UUID/String from the QR code
 */
function processScan(scannedData) {

    try {
        // Connect to the Google Sheet using the ID defined at the top
        const DB = SpreadsheetApp.openById(DB_ID).getSheets();
        const studentSheet = DB[0];
        const logsSheet = DB[1];

        // Access the globally scoped Script Cache
        const cache = CacheService.getScriptCache();
        const cacheKey = `state_${scannedData}`;
        const cachedData = cache.get(cacheKey);

        let studentRowIndex = -1;
        let name = "Unknown";
        let currentStatus = "";
        let last_scan_time = null;

        // If the student ID exists in the cache, pull the values from cache instead of querying DB
        if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            name = parsedData[0];
            currentStatus = parsedData[1];
            // Cache stores dates as strings/numbers, so instantiate a new Date object if it's not null
            last_scan_time = parsedData[2] ? new Date(parsedData[2]) : null;
            // We additionally store the sheet row index in cache so we know which row to update at the end
            studentRowIndex = parsedData[3];
        } else {
            // Cache miss: Fetch all data from the students sheet
            const studentData = studentSheet.getDataRange().getValues();

            // Find the student by ID (skip row 0 because it's the header)
            for (let i = 1; i < studentData.length; i++) {
                // Force string comparison for robust matching
                if (String(studentData[i][0]) === String(scannedData)) {
                    studentRowIndex = i;
                    name = studentData[i][1];
                    currentStatus = studentData[i][4]; // Column E is index 4
                    last_scan_time = studentData[i][5];
                    break;
                }
            }

            // If the student doesn't exist, return an error
            if (studentRowIndex === -1) {
                return {
                    success: false,
                    message: "Student ID not found in database."
                };
            }
        }

        const current_timestamp = new Date();
        const timeDiff = Math.floor((current_timestamp - last_scan_time) / 1000.0);

        if (timeDiff < 5) {
            return {
                success: false,
                message: "Too quick, wait some time before scanning again."
            };
        }
        const studentId = scannedData;

        // Determine the action (opposite of current status)
        // If currentStatus is empty or "OUT", action becomes "IN"
        const action = (currentStatus === "IN") ? "OUT" : "IN";

        // Update the students table
        // Arrays are 0-indexed but getRange is 1-indexed. So row = studentRowIndex + 1
        const sheetRow = studentRowIndex + 1;

        // Use LockService to prevent race conditions when appending to the cache queue
        const lock = LockService.getScriptLock();
        try {
            lock.waitLock(10000); // Wait up to 10s for other concurrent scans
            let scanQueue = [];
            const queueData = cache.get('scanQueue');
            if (queueData) {
                scanQueue = JSON.parse(queueData);
            }

            scanQueue.push({
                studentId: studentId,
                name: name,
                action: action,
                timestamp: current_timestamp.getTime(),
                sheetRow: sheetRow
            });

            cache.put('scanQueue', JSON.stringify(scanQueue), 21600); // 6 hours
        } catch (error) {
            console.error("Lock error, failed to write to queue:", error);
            return {
                success: false,
                message: "System busy. Please try again."
            };
        } finally {
            lock.releaseLock();
        }

        // "Read-through Cache": Update the cache so the next request gets the new status and timestamp instantly
        cache.put(
            cacheKey,
            JSON.stringify([name, action, current_timestamp.getTime(), studentRowIndex]),
            21600 // cache timeout in seconds (6 hours max for Apps Script cache)
        );

        return {
            success: true,
            name: name,
            status: action
        };
    } catch (error) {
        console.error("Error writing to sheet:", error);
        return {
            success: false,
            message: error.message
        };
    }
}

/**
 * Endpoint called by Admin.html
 */
function getLogs(pageNum) {
    pageNum = parseInt(pageNum) || 1;
    const pageSize = 100;

    try {
        const DB = SpreadsheetApp.openById(DB_ID).getSheets();
        const logsSheet = DB[1]; // Index 1 is Logs Sheet

        const totalSheetRows = logsSheet.getLastRow();
        const dataRows = Math.max(0, totalSheetRows - 1); // Assuming row 1 is headers
        const totalPages = Math.ceil(dataRows / pageSize) || 1;

        let data = [];
        let showingStart = 0;
        let showingEnd = 0;

        if (dataRows > 0 && pageNum <= totalPages) {
            // Page 1 is the most recent (bottom of the sheet)
            showingStart = ((pageNum - 1) * pageSize) + 1;
            showingEnd = Math.min(pageNum * pageSize, dataRows);

            const numRowsToFetch = showingEnd - showingStart + 1;

            // Calculate actual sheet rows starting from the bottom
            const startRowIdx = totalSheetRows - showingEnd + 1;

            if (numRowsToFetch > 0) {
                // getRange(row, column, numRows, numColumns)
                data = logsSheet.getRange(startRowIdx, 1, numRowsToFetch, logsSheet.getLastColumn()).getDisplayValues();
                // Reverse so the newest items are first in the array
                data.reverse();
            }
        }

        return {
            totalRows: dataRows,
            rowsShowing: `${showingStart} to ${showingEnd} (from end)`,
            pageNumber: pageNum,
            totalPages: totalPages,
            data: data
        };
    } catch (error) {
        console.error("Error fetching logs:", error);
        throw error;
    }
}

// ==========================================
// BACKGROUND TASKS & TRIGGERS & SETUP
// ==========================================

/**
 * Run this function ONCE from the Apps Script editor to prompt Google 
 * to ask you for the new UrlFetchApp and DriveApp permissions.
 */
function authorizeSetup() {
    DriveApp.getRootFolder();
    UrlFetchApp.fetch("https://www.google.com");
    console.log("Authorization successful!");

    const qrUrl = `http://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent("guddubhaiya")}&size=100x100`;
    const imageBlob = UrlFetchApp.fetch(qrUrl).getBlob().setName(`Guddubhaiya_QR.png`);
    // Use the configured Google Drive Folder ID
    const folder = DriveApp.getFolderById(QR_FOLDER_ID);
    const file = folder.createFile(imageBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const driveLink = file.getUrl();
    console.log(driveLink);
}

/**
 * Endpoint called by Admin.html to get all students
 */
function getAllStudents() {
    try {
        const DB = SpreadsheetApp.openById(DB_ID).getSheets();
        const studentSheet = DB[0];
        const data = studentSheet.getDataRange().getDisplayValues();

        // Skip header row
        const students = data.slice(1);
        return { success: true, data: students };
    } catch (e) {
        console.error("Error fetching students:", e);
        return { success: false, message: e.message };
    }
}

/**
 * Endpoint called by Admin.html to create a new student
 */
function createStudent(studentId, name, email) {
    try {
        const DB = SpreadsheetApp.openById(DB_ID).getSheets();
        const studentSheet = DB[0];

        // 1. Check if student already exists
        const data = studentSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]) === String(studentId)) {
                return { success: false, message: "Student with this ID already exists." };
            }
        }

        // 2. Generate QR Code
        const qrUrl = `http://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(studentId)}&size=100x100`;
        const imageBlob = UrlFetchApp.fetch(qrUrl).getBlob().setName(`${studentId}_QR.png`);

        // 3. Save to Drive
        // Use the configured Google Drive Folder ID
        const folder = DriveApp.getFolderById(QR_FOLDER_ID);
        const file = folder.createFile(imageBlob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        const driveLink = file.getUrl();

        // 4. Append to sheet
        // Columns: Student_ID, Name, Email, QR_Drive_Link, Current_status, Last_scan_time
        studentSheet.appendRow([studentId, name, email, driveLink, 'OUT', '']);

        return { success: true, message: "Student created successfully!", driveLink: driveLink };
    } catch (e) {
        console.error("Error creating student:", e);
        return { success: false, message: e.message };
    }
}

/**
 * Trigger function to drain the `scanQueue` from cache and batch insert/update to Google Sheets
 * Runs every 1 minute.
 */
function processScanQueue() {
    const cache = CacheService.getScriptCache();
    const lock = LockService.getScriptLock();

    let queueStr;
    try {
        lock.waitLock(10000);
        queueStr = cache.get('scanQueue');
        if (!queueStr) {
            // Queue is empty, nothing to do
            return;
        }
        // Clear queue so incoming scans can start fresh immediately
        cache.remove('scanQueue');
    } catch (e) {
        console.error("Failed to acquire lock for processing queue:", e);
        return;
    } finally {
        lock.releaseLock();
    }

    const queue = JSON.parse(queueStr);
    if (queue.length === 0) return;

    // We have items to process! Connect to Sheets
    const DB = SpreadsheetApp.openById(DB_ID).getSheets();
    const studentSheet = DB[0];
    const logsSheet = DB[1];

    // 1. Batch Insert Logs
    const logRows = queue.map(log => [
        new Date(log.timestamp),
        log.studentId,
        log.name,
        log.action
    ]);

    // Batch insert using a 2D array mapping
    if (logRows.length > 0) {
        logsSheet.getRange(logsSheet.getLastRow() + 1, 1, logRows.length, 4).setValues(logRows);
    }

    // 2. Update Student Statuses
    // Batch update the entire column in memory to minimize Apps Script API calls
    if (queue.length > 0) {
        const studentLastRow = studentSheet.getLastRow();
        if (studentLastRow > 0) {
            // Fetch columns 5 (Current_status) and 6 (Last_scan_time) starting from row 1
            const statusRange = studentSheet.getRange(1, 5, studentLastRow, 2);
            const statusValues = statusRange.getValues();

            // Update the array in memory
            queue.forEach(log => {
                const arrayIndex = log.sheetRow - 1; // 0-indexed array vs 1-indexed sheet
                if (arrayIndex >= 0 && arrayIndex < statusValues.length) {
                    statusValues[arrayIndex][0] = log.action;
                    statusValues[arrayIndex][1] = new Date(log.timestamp);
                }
            });

            // Write the entirely modified 2D array back in ONE API call
            statusRange.setValues(statusValues);
        }
    }
}

/**
 * Utility to programmatically set up the time-driven trigger.
 * Run this function ONCE from the Apps Script editor to activate the queue processing.
 */
function setupTrigger() {
    // Prevent duplicate triggers by deleting old ones first
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === 'processScanQueue') {
            ScriptApp.deleteTrigger(trigger);
        }
    });

    // Create new 1-minute trigger
    ScriptApp.newTrigger('processScanQueue')
        .timeBased()
        .everyMinutes(1)
        .create();
}

// ==========================================
// WEBHOOK (POST Endpoint)
// ==========================================

function doPost(e) {
  try {
    // 1. Parse incoming JSON from the external scanner
    const data = JSON.parse(e.postData.contents);
    const scannedId = data.barcode;

    if (!scannedId) {
      return jsonResponse({ success: false, message: "Missing ID" });
    }

    // 2. Pass the ID to their EXISTING backend function
    const result = processScan(scannedId);

    // 3. Return the exact result back to the scanner
    return jsonResponse(result);

  } catch (error) {
    return jsonResponse({ success: false, message: error.toString() });
  }
}

// Helper block to format JSON correctly
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}