/**
 * GOOGLE APPS SCRIPT BRIDGE FOR BIOTICKER
 * 
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Delete everything and paste this code
 * 4. Update 'SECRET_TOKEN' below to a random string (equal to GOOGLE_SCRIPT_SECRET)
 * 5. Click 'Deploy' > 'New Deployment'
 *    - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone (Protected by SECRET_TOKEN)
 */

const SECRET_TOKEN = "your_random_secret_here"; // CHANGE THIS!

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.secret !== SECRET_TOKEN) {
      return respond({ error: "Unauthorized" });
    }

    const action = payload.action;
    const data = payload.data;
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "syncArticles") {
      return handleSyncArticles(spreadsheet, data);
    } else if (action === "updateRow") {
      return handleUpdateRow(spreadsheet, payload.sheetName, payload.idField, payload.idValue, data);
    } else if (action === "clear") {
      return handleClear(spreadsheet);
    }

    return respond({ error: "Unknown action" });
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function doGet(e) {
  try {
    if (e.parameter.secret !== SECRET_TOKEN) return respond({ error: "Unauthorized" });

    const action = e.parameter.action;
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "getArticles") {
      return respond(getSheetData(spreadsheet, "articles"));
    } else if (action === "getNotifications") {
      return respond(getSheetData(spreadsheet, "notifications"));
    } else if (action === "getMetadata") {
      const data = getSheetData(spreadsheet, "metadata");
      const obj = {};
      data.forEach(r => {
        try { obj[r.key] = JSON.parse(r.value); } catch(e) { obj[r.key] = r.value; }
      });
      return respond(obj[e.parameter.key] || {});
    }

    return respond({ error: "Unknown action" });
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function getSheetData(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function handleSyncArticles(spreadsheet, articles) {
  let sheet = spreadsheet.getSheetByName("articles");
  if (!sheet) {
    sheet = spreadsheet.insertSheet("articles");
    sheet.appendRow(["id", "title", "link", "source", "publishedAt", "fetchedAt", "importance", "telegramSent", "type", "summary", "aiAnalyzed", "entities", "content", "reason", "memo", "isStarred", "isRead"]);
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  articles.forEach(art => {
    const row = headers.map(h => {
      const val = art[h];
      return typeof val === "object" ? JSON.stringify(val) : (val === undefined ? "" : val);
    });
    sheet.appendRow(row);
  });
  return respond({ status: "ok" });
}

function handleUpdateRow(spreadsheet, sheetName, idField, idValue, data) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    const headers = Object.keys(data);
    sheet.appendRow(headers);
  }

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idIndex = headers.indexOf(idField);
  const rowIndex = rows.findIndex(r => r[idIndex] == idValue);

  if (rowIndex === -1) {
    const newRow = headers.map(h => {
      const val = data[h];
      return typeof val === "object" ? JSON.stringify(val) : (val === undefined ? "" : val);
    });
    sheet.appendRow(newRow);
  } else {
    headers.forEach((h, i) => {
      if (data[h] !== undefined) {
        const val = typeof data[h] === "object" ? JSON.stringify(data[h]) : data[h];
        sheet.getRange(rowIndex + 1, i + 1).setValue(val);
      }
    });
  }
  return respond({ status: "ok" });
}

function handleClear(spreadsheet) {
  const sheets = ["articles", "notifications", "sync_logs", "metadata"];
  sheets.forEach(name => {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  });
  return respond({ status: "ok" });
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
