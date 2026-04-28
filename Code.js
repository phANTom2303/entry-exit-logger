// ==========================================
// CONFIGURATION & GLOBALS
// ==========================================
// Replace this with the actual ID of your Google Sheet URL
const DB_ID = 'YOUR_SPREADSHEET_ID_HERE'; 

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
  // TODO: Implement LockService, CacheService State Machine, and HMAC validation.
  
  // For now, return a dummy success object so you can test your frontend UI
  return {
    success: true,
    name: "Mock Student",
    status: Math.random() > 0.5 ? "IN" : "OUT" // Randomly toggle IN/OUT for testing
  };
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