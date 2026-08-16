/* Parse workbooks away from the UI thread. The main app falls back to direct parsing
   when a browser does not support Workers or local workers are blocked. */
self.importScripts("vendor/xlsx.full.min.js");

self.onmessage = ({ data }) => {
  try {
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const sheets = {};
    for (const name of workbook.SheetNames) {
      sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1, defval: "", raw: true, blankrows: false,
      });
    }
    self.postMessage({ ok: true, sheets });
  } catch (error) {
    self.postMessage({ ok: false, message: error?.message || "อ่านไฟล์ไม่สำเร็จ" });
  }
};
