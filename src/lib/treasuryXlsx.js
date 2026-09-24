import { strToU8, zipSync } from 'fflate'

// Fichier XLSX OOXML autonome : aucune donnée n'est transmise à un service externe.
const xml = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (index) => { let output = '', n = index + 1; while (n) { n--; output = String.fromCharCode(65 + n % 26) + output; n = Math.floor(n / 26) } return output }
export const eur = (cents) => ({ euros: Number(cents || 0) / 100 })
const cellXml = (value, reference, header) => {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'euros')) {
    return '<c r="' + reference + '" s="2"><v>' + value.euros + '</v></c>'
  }
  if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + reference + '"><v>' + value + '</v></c>'
  return '<c r="' + reference + '"' + (header ? ' s="1"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>'
}
const worksheetXml = ({ headers, rows }) => {
  const all = [headers || [], ...(rows || [])]
  const width = Math.max(1, ...all.map((r) => r.length))
  const columns = Array.from({ length: width }, (_, i) => {
    const longest = Math.max(10, ...all.slice(0, 150).map((r) => String(r[i]?.euros ?? r[i] ?? '').length))
    return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.min(45, longest + 3) + '" customWidth="1"/>'
  }).join('')
  const content = all.map((r, i) => '<row r="' + (i + 1) + '"' + (i === 0 ? ' ht="24" customHeight="1"' : '') + '>' +
    r.map((v, j) => cellXml(v, col(j) + (i + 1), i === 0)).join('') + '</row>').join('')
  const autoFilter = rows.length && headers.length > 1 ? '<autoFilter ref="A1:' + col(width - 1) + all.length + '"/>' : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="16"/><cols>' + columns + '</cols><sheetData>' + content + '</sheetData>' + autoFilter +
    '<pageMargins left=".3" right=".3" top=".5" bottom=".5" header=".2" footer=".2"/></worksheet>'
}
export function createFinancialXlsx(sheets) {
  if (!Array.isArray(sheets) || !sheets.length || sheets.some((s) => !s.name || !Array.isArray(s.headers) || !Array.isArray(s.rows))) throw new Error('Feuilles Excel invalides.')
  const names = new Set()
  const archive = {
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;€&quot;;[Red]-#,##0.00 &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174F56"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'),
  }
  const wbSheets = [], rels = [], overrides = []
  sheets.forEach((sheet, i) => {
    const name = sheet.name.slice(0, 31).replace(/[\\/\[\]*?:]/g, ' ').trim()
    if (!name || names.has(name)) throw new Error('Noms de feuilles Excel invalides ou dupliqués.')
    names.add(name)
    const id = i + 1
    archive['xl/worksheets/sheet' + id + '.xml'] = strToU8(worksheetXml(sheet))
    wbSheets.push('<sheet name="' + xml(name) + '" sheetId="' + id + '" r:id="rId' + id + '"/>')
    rels.push('<Relationship Id="rId' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + id + '.xml"/>')
    overrides.push('<Override PartName="/xl/worksheets/sheet' + id + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
  })
  rels.push('<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
  archive['xl/workbook.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + wbSheets.join('') + '</sheets></workbook>')
  archive['xl/_rels/workbook.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>')
  archive['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + overrides.join('') + '</Types>')
  return zipSync(archive, { level: 6 })
}
