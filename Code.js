// ==========================================
// CONFIGURATION & GLOBALS
// ==========================================
// Fetch the Spreadsheet ID from Apps Script's environment variables (Script Properties)
const DB_ID = PropertiesService.getScriptProperties().getProperty('DB_ID');

// ==========================================
// ROUTING (The GET Endpoint)
// ==========================================
function doGet(e) {
    // 1. Extract the route parameter from the URL (e.g., ?route=admin)
    // If the URL is just the base URL, route will be undefined.
    const route = e.parameter ? e.parameter.route : null;

    // 2. Route the request to the correct HTML view
    if (route === 'admin') {
        return serveHtml('Admin', 'Admin Dashboard');
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

        // Fetch all data from the students sheet
        const studentData = studentSheet.getDataRange().getValues();
        let studentRowIndex = -1;
        let name = "Unknown";
        let currentStatus = "";

        // Find the student by ID (skip row 0 because it's the header)
        for (let i = 1; i < studentData.length; i++) {
            // Force string comparison for robust matching
            if (String(studentData[i][0]) === String(scannedData)) {
                studentRowIndex = i;
                name = studentData[i][1];
                currentStatus = studentData[i][4]; // Column E is index 4
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

        const timestamp = new Date();
        const studentId = scannedData;

        // Determine the action (opposite of current status)
        // If currentStatus is empty or "OUT", action becomes "IN"
        const action = (currentStatus === "IN") ? "OUT" : "IN";

        // Update the students table
        // Arrays are 0-indexed but getRange is 1-indexed. So row = studentRowIndex + 1
        const sheetRow = studentRowIndex + 1;

        // Column E (Current_status) is col 5, Column F (Last_scan_time) is col 6
        studentSheet.getRange(sheetRow, 5).setValue(action);
        studentSheet.getRange(sheetRow, 6).setValue(timestamp);

        // Append the array of data as a new row in the logs sheet
        logsSheet.appendRow([timestamp, studentId, name, action]);

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
function getLogs() {
    // TODO: Implement SpreadsheetApp logic to fetch real logs.

    // For now, return a dummy 2D array representing rows from the Google Sheet
    return [
        [new Date().getTime(), "mock-uuid-1", "Alice", "IN"],
        [new Date().getTime() - 60000, "mock-uuid-2", "Bob", "OUT"]
    ];
}