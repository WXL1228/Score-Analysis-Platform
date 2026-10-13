import type { Exam, ImportPreview, ImportRow, RankedStudent } from "./types"

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name.replace(/[<>:"/\\|?*]/g, "_")
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function csvMatrix(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "\"") {
      if (quoted && text[i + 1] === "\"") {
        cell += "\""
        i++
      } else {
        quoted = !quoted
      }
    } else if (char === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += char
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合")
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export async function readScoreFile(file: File): Promise<{ name: string, matrix: unknown[][] }[]> {
  if (file.size > 10 * 1024 * 1024) throw new Error("请导入小于 10 MB 的成绩文件")
  if (/\.csv$/i.test(file.name)) return [{ name: "CSV", matrix: csvMatrix(await file.text()) }]
  if (!/\.xlsx$/i.test(file.name)) throw new Error("支持 .xlsx 和 UTF-8 CSV；旧版 .xls 请先另存为 .xlsx")
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  return workbook.worksheets.map((sheet) => {
    const matrix: unknown[][] = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: unknown[] = []
      for (let i = 1; i <= sheet.columnCount; i++) {
        const cell = row.getCell(i)
        const value = cell.value
        cells.push(value && typeof value === "object" && "result" in value ? value.result : value && typeof value === "object" ? cell.text : value)
      }
      matrix.push(cells)
    })
    return { name: sheet.name, matrix }
  })
}

function cleanHeader(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\s/g, "").replace(/[（(].*?[）)]/g, "").replace(/(成绩|分数)$/, "")
}

export function parseScoreMatrix(matrix: unknown[][], exam: Exam, defaultClass: string): ImportPreview {
  const first = matrix.findIndex(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ""))
  const headers = (matrix[first] ?? []).map(cleanHeader)
  const errors: string[] = []
  const numberColumn = headers.findIndex(value => ["学号", "学生编号"].includes(value))
  const nameColumn = headers.findIndex(value => ["姓名", "学生姓名"].includes(value))
  const classColumn = headers.findIndex(value => ["班级", "班级名", "班级名称"].includes(value))
  const subjects = exam.subjects.filter(subject => headers.includes(subject.name))
  if (numberColumn < 0 || nameColumn < 0) errors.push("首个非空行须包含「学号」和「姓名」列")
  if (!subjects.length) errors.push("没有匹配到学科列，请使用本次考试的学科名称或下载模板")
  const nonemptyHeaders = headers.filter(Boolean)
  if (new Set(nonemptyHeaders).size !== nonemptyHeaders.length) errors.push("表头存在重复列")
  if (errors.length) return { rows: [], errors, subjects: subjects.map(subject => subject.name) }
  const seen = new Set<string>()
  const rows: ImportRow[] = []
  matrix.slice(first + 1).forEach((cells, i) => {
    if (!cells.some(value => value !== null && value !== undefined && String(value).trim() !== "")) return
    const line = first + i + 2
    const number = String(cells[numberColumn] ?? "").trim()
    const name = String(cells[nameColumn] ?? "").trim()
    const className = classColumn < 0 ? defaultClass : String(cells[classColumn] ?? "").trim()
    const key = `${className}:${number}`
    if (!number || !name || !className) errors.push(`第 ${line} 行：学号、姓名和班级不能为空`)
    if (seen.has(key)) errors.push(`第 ${line} 行：同班学号 ${number} 重复`)
    seen.add(key)
    const scores: Record<string, number | null> = {}
    for (const subject of subjects) {
      const raw = cells[headers.indexOf(subject.name)]
      const blank = raw === null || raw === undefined || String(raw).trim() === "" || ["缺考", "-", "—"].includes(String(raw).trim())
      const score = blank ? null : typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : Number.NaN
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > subject.max)) errors.push(`第 ${line} 行：${subject.name}必须在 0～${subject.max} 分之间，或留空表示缺考`)
      scores[subject.id] = score
    }
    rows.push({ line, number, name, className, scores })
  })
  if (!rows.length) errors.push("工作表中没有学生数据")
  return { rows, errors, subjects: subjects.map(subject => subject.name) }
}

export async function exportWorkbook(exam: Exam, className: string, rows?: RankedStudent[]): Promise<void> {
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet(rows ? "成绩明细" : "成绩录入")
  const headers = ["学号", "姓名", "班级", ...exam.subjects.map(subject => subject.name)]
  if (rows) headers.push("总分", "平均分", "班级排名", "跨班排名", "排名变化")
  sheet.addRow(headers)
  if (rows) {
    rows.forEach(row => sheet.addRow([row.number, row.name, className, ...exam.subjects.map(subject => row.scores[subject.id] ?? null), row.total, row.average, row.rank, row.gradeRank, row.change]))
  } else {
    sheet.addRow(["001", "示例学生（请替换）", className, ...exam.subjects.map(() => null)])
    const instructions = workbook.addWorksheet("填写说明")
    instructions.addRow(["第一行为表头。学号使用文本，保留前导零。空分数或「缺考」表示缺考，不计零分。"])
    instructions.addRow(["班级名不同会自动创建班级；同班同学号须姓名一致；同一次考试再次导入会更新表内科目。"])
    instructions.addRow(["排名变化 = 上次班级排名 − 本次班级排名；同分并列。只有科目和满分相同才比较总排名。"])
    exam.subjects.forEach(subject => instructions.addRow([subject.name, `满分 ${subject.max}，及格 ${subject.pass}，优秀 ${subject.excellent}`]))
    instructions.getColumn(1).width = 110
  }
  sheet.columns.forEach((column) => {
    column.width = 16
  })
  sheet.getColumn(1).numFmt = "@"
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF337665" } }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${className}-${exam.name}-${rows ? "成绩明细" : "导入模板"}.xlsx`)
}
