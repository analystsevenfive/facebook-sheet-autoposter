const REQUIRED_HEADERS = [
  'Post ID', 'Assigned Member', 'Facebook Account', 'Facebook Group Name', 'Facebook Group URL',
  'Caption', 'Media Type', 'Media URL 1', 'Scheduled Date', 'Approval Status',
  'Posting Status', 'Attempt Count', 'Last Attempt At', 'Posted At', 'Posted URL', 'status post', 'Error / Notes',
  'time use', 'Local Media Path'
];

function columnLetter(index) {
  let number = index + 1;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

export function rowsFromValues(values) {
  const [headers = [], ...body] = values || [];
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) throw new Error(`Required Sheet header is missing: ${required}`);
  }
  const rows = body.map((cells, index) => {
    const row = { __rowNumber: index + 2 };
    headers.forEach((header, column) => { row[header] = cells[column] ?? ''; });
    return row;
  });
  return { headers, rows };
}

export async function readTable(sheets, config) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `'${config.sheetName.replaceAll("'", "''")}'!A1:Z${config.maxRows}`,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return rowsFromValues(response.data.values || []);
}

export async function readRow(sheets, config, headers, rowNumber) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `'${config.sheetName.replaceAll("'", "''")}'!A${rowNumber}:Z${rowNumber}`,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  const cells = response.data.values?.[0] || [];
  const row = { __rowNumber: rowNumber };
  headers.forEach((header, column) => { row[header] = cells[column] ?? ''; });
  return row;
}

export async function updateRow(sheets, config, headers, rowNumber, updates) {
  const data = [];
  for (const [header, value] of Object.entries(updates)) {
    const index = headers.indexOf(header);
    if (index < 0) throw new Error(`Cannot update missing header: ${header}`);
    data.push({
      range: `'${config.sheetName.replaceAll("'", "''")}'!${columnLetter(index)}${rowNumber}`,
      values: [[value]]
    });
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
}

export async function formatDurationCell(sheets, config, headers, rowNumber) {
  const index = headers.indexOf('time use');
  if (index < 0) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId: config.sheetId,
            startRowIndex: rowNumber - 1,
            endRowIndex: rowNumber,
            startColumnIndex: index,
            endColumnIndex: index + 1
          },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '[h]:mm:ss' } } },
          fields: 'userEnteredFormat.numberFormat'
        }
      }]
    }
  });
}

