import type { Exam, ImportPreview, ImportRow, RankedStudent, Subject } from "./types"
import { createId } from "./id"

const SCORE_TEMPLATE_SUBJECTS = ["语文", "数学", "英语", "道法", "物理", "化学", "生物", "历史", "地理"]

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

function scoreHeaders(matrix: unknown[][]): { first: number, headers: string[] } {
  const first = matrix.findIndex(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ""))
  const headers = (matrix[first] ?? []).map(cleanHeader)
  // 成绩汇总表的第一列序号没有表头，第二列为姓名；序号仅用于排序。
  if (!headers[0] && ["姓名", "学生姓名"].includes(headers[1])) headers[0] = "序号"
  return { first, headers }
}

/** 初始化班级时识别学科；总分、排名及学生资料列不作为学科。 */
export function inferSubjects(matrix: unknown[][], existing: Subject[]): Subject[] {
  const { first, headers } = scoreHeaders(matrix)
  const ignored = new Set(["学号", "学生编号", "姓名", "学生姓名", "班级", "班级名", "班级名称", "序号", "编号", "年级", "性别", "年龄", "座号", "学籍号", "总分", "总成绩", "平均分", "平均成绩", "排名", "名次", "班级排名", "跨班排名", "年级排名", "排名变化", "进退步", "备注", "说明", "考试", "考试名称", "考试日期", "日期", "教师", "班主任", "学期", "学年", "学校", "联系电话", "手机号"].map(cleanHeader))
  return headers.flatMap((name, index) => {
    if (!name || ignored.has(name) || /(排名|名次|等级|得分率|及格率|优秀率)$/.test(name)) return []
    const known = existing.find(subject => subject.name === name)
    const match = String(matrix[first][index] ?? "").match(/[（(]\s*(?:满分\s*)?(\d+(?:\.\d+)?)\s*(?:分\s*)?[）)]/)
    const max = match ? Number(match[1]) : known?.max ?? 100
    const pass = Math.round(max * (known ? known.pass / known.max : 0.6) * 10) / 10
    const excellent = Math.round(max * (known ? known.excellent / known.max : 0.85) * 10) / 10
    return [{ id: known?.id ?? createId(), name, max, pass, excellent }]
  })
}

/** 只初始化一个班级，允许重命名来源班级，避免误合并多个班级。 */
export function parseClassScoreMatrix(matrix: unknown[][], subjects: Subject[], className: string): ImportPreview {
  const { first, headers } = scoreHeaders(matrix)
  const classColumn = headers.findIndex(value => ["班级", "班级名", "班级名称"].includes(value))
  const classNames = new Set(matrix.slice(first + 1).map(row => classColumn < 0 ? "" : String(row[classColumn] ?? "").trim()).filter(Boolean))
  if (classNames.size > 1) return { rows: [], errors: ["工作表包含多个班级，请选择单个班级的工作表或先拆分文件"], subjects: subjects.map(subject => subject.name) }
  const normalized = matrix.map((row, index) => {
    const copy = [...row]
    if (index > first && classColumn >= 0 && row.some(value => value !== null && value !== undefined && String(value).trim() !== "")) copy[classColumn] = className.trim()
    return copy
  })
  return parseScoreMatrix(normalized, { id: "preview", name: "预览", date: "", subjects }, className.trim())
}

export function parseScoreMatrix(matrix: unknown[][], exam: Exam, defaultClass: string): ImportPreview {
  const { first, headers } = scoreHeaders(matrix)
  const errors: string[] = []
  const numberColumn = headers.findIndex(value => ["学号", "学生编号"].includes(value))
  const nameColumn = headers.findIndex(value => ["姓名", "学生姓名"].includes(value))
  const genderColumn = headers.indexOf("性别")
  const classColumn = headers.findIndex(value => ["班级", "班级名", "班级名称"].includes(value))
  const subjects = exam.subjects.filter(subject => headers.includes(subject.name))
  if (nameColumn < 0) errors.push("首个非空行须包含「姓名」列；学号可选，序号不作为学号")
  if (!subjects.length) errors.push("没有匹配到学科列，请使用本次考试的学科名称或下载模板")
  const nonemptyHeaders = headers.filter(Boolean)
  if (new Set(nonemptyHeaders).size !== nonemptyHeaders.length) errors.push("表头存在重复列")
  if (errors.length) return { rows: [], errors, subjects: subjects.map(subject => subject.name) }
  const seen = new Set<string>()
  const rows: ImportRow[] = []
  matrix.slice(first + 1).forEach((cells, i) => {
    if (!cells.some(value => value !== null && value !== undefined && String(value).trim() !== "")) return
    const line = first + i + 2
    const number = numberColumn < 0 ? "" : String(cells[numberColumn] ?? "").trim()
    const name = String(cells[nameColumn] ?? "").trim()
    // 跳过成绩单底部未填学生资料的统计行，以及带明确标签的统计行。
    if ((!number && !name) || ["平均分", "平均成绩", "合计", "总计"].includes(number) || ["平均分", "平均成绩", "合计", "总计"].includes(name)) return
    const className = classColumn < 0 ? defaultClass : String(cells[classColumn] ?? "").trim()
    const key = `${className}:${number ? `学号:${number}` : `姓名:${name}`}`
    if (!name || !className) errors.push(`第 ${line} 行：姓名和班级不能为空`)
    if (seen.has(key)) errors.push(`第 ${line} 行：${number ? `同班学号 ${number} 重复` : `同班姓名 ${name} 重复，请填写学号区分重名学生`}`)
    seen.add(key)
    const scores: Record<string, number | null> = {}
    for (const subject of subjects) {
      const raw = cells[headers.indexOf(subject.name)]
      const blank = raw === null || raw === undefined || String(raw).trim() === "" || ["缺考", "-", "—"].includes(String(raw).trim())
      const score = blank ? null : typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : Number.NaN
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > subject.max)) errors.push(`第 ${line} 行：${subject.name}必须在 0～${subject.max} 分之间，或留空表示缺考`)
      scores[subject.id] = score
    }
    rows.push({ line, number, name, ...(genderColumn >= 0 ? { gender: String(cells[genderColumn] ?? "").trim() } : {}), className, scores })
  })
  for (const row of rows.filter(row => !row.number)) {
    if (rows.some(other => other !== row && other.number && other.className === row.className && other.name === row.name)) errors.push(`第 ${row.line} 行：同班姓名 ${row.name} 重复，请填写学号区分重名学生`)
  }
  if (!rows.length) errors.push("工作表中没有学生数据")
  return { rows, errors, subjects: subjects.map(subject => subject.name) }
}

export async function buildScoreWorkbook(exam: Exam | undefined, className: string, rows?: RankedStudent[], configuredSubjects: Subject[] = []) {
  if (rows && !exam) throw new Error("请先选择考试，再导出成绩明细")
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet(rows ? "成绩明细" : "成绩录入")
  const subjects = exam?.subjects ?? configuredSubjects
  const subjectNames = rows ? subjects.map(subject => subject.name) : [...SCORE_TEMPLATE_SUBJECTS, ...subjects.map(subject => subject.name).filter(name => !SCORE_TEMPLATE_SUBJECTS.includes(name))]
  const headers = ["序号", "姓名", "性别", ...subjectNames]
  headers.push(rows ? "学号" : "学号（可选）")
  if (rows) headers.push("班级", "总分", "平均分", "班级排名", "跨班排名", "排名变化")
  sheet.addRow(headers)
  if (rows) {
    rows.forEach((row, index) => sheet.addRow([index + 1, row.name, row.gender ?? "", ...subjects.map(subject => row.scores[subject.id] ?? null), row.number, className, row.total, row.average, row.rank, row.gradeRank, row.change]))
    const summary = sheet.addRow([null, "平均分", null, ...subjects.map((subject) => {
      const scores = rows.map(row => row.scores[subject.id]).filter((score): score is number => typeof score === "number")
      return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 100) / 100 : null
    })])
    summary.font = { bold: true }
  } else {
    sheet.addRow([1, "示例学生（请替换）", "", ...subjectNames.map(() => null), null])
    const instructions = workbook.addWorksheet("填写说明")
    instructions.addRow(["按「序号、姓名、性别、各科成绩」填写。序号仅用于排序，不作为学生编号；学号列可留空。"])
    instructions.addRow(["无学号时按班级和姓名匹配，新学生自动生成内部学号；同班重名须填写学号。填写学号时请用文本，保留前导零。"])
    instructions.addRow(["性别可留空。空分数或「缺考」保留缺考标记，按 0 分计入总分与排名。"])
    instructions.addRow(["模板包含语文、数学、英语、道法、物理、化学、生物、历史、地理，道法只列一次；未开设的学科可删除整列。"])
    instructions.addRow(["首次使用可在「班级设置 → 添加班级」上传此表，自动识别保留的学科；请在预览中核对各科满分、及格分和优秀分。"])
    instructions.addRow([`导入已有考试时只读取该考试已设置的学科，分数线沿用设置，不会因模板中的其他学科列而增加考试科目。${exam ? `当前考试学科：${subjects.map(subject => subject.name).join("、")}。` : ""}`])
    instructions.addRow([`${className ? `未填班级列时导入当前班级（${className}）` : "导入时请先选择或新建班级"}；可增加班级列。再次导入更新表内科目，已有学号须姓名一致。`])
    instructions.addRow(["底部平均分等统计行自动跳过；导入后系统重新计算总分、平均分和排名。"])
    instructions.addRow(["排名变化 = 上次班级排名 − 本次班级排名；同分并列。只有科目和满分相同才比较总排名。"])
    subjects.forEach(subject => instructions.addRow([subject.name, `满分 ${subject.max}，及格 ${subject.pass}，优秀 ${subject.excellent}`]))
    instructions.getColumn(1).width = 110
    instructions.getColumn(1).alignment = { wrapText: true, vertical: "top" }
    instructions.eachRow((row) => {
      row.height = 32
    })
  }
  sheet.columns.forEach((column) => {
    column.width = 16
  })
  sheet.getColumn(subjectNames.length + 4).numFmt = "@"
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF337665" } }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  return workbook
}

export async function exportWorkbook(exam: Exam | undefined, className: string, rows?: RankedStudent[], configuredSubjects: Subject[] = []): Promise<void> {
  const workbook = await buildScoreWorkbook(exam, className, rows, configuredSubjects)
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${exam ? `${className || "成绩"}-${exam.name}` : "成绩"}-${rows ? "成绩明细" : "导入模板"}.xlsx`)
}
