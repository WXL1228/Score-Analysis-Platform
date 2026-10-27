import type { UnitImportPreview, UnitImportRow, UnitPeriod, UnitScores, UnitTrackingEntry, UnitTrackingPlan } from "./types"
import { rankValues } from "./analytics"

export interface UnitRanking {
  rank: number | null
  previousRank: number | null
  rankChange: number | null
}

function text(value: unknown): string {
  return String(value ?? "").trim()
}

function header(value: unknown): string {
  return text(value).replace(/\s/g, "")
}

function unitColumn(value: unknown): { number: number, kind: "target" | "actual" } | null {
  const match = header(value).match(/^第?(\d+)单元(目标|测试)$/)
  return match && Number(match[1]) > 0 ? { number: Number(match[1]), kind: match[2] === "目标" ? "target" : "actual" } : null
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

/** 学情表的衍生公式不作为输入，全部由有效目标和实测分重新计算。 */
export function parseUnitWorkbook(sheets: { name: string, matrix: unknown[][] }[], max: number): UnitImportPreview {
  const preview: UnitImportPreview = { periods: [], rows: [], errors: [], warnings: [] }
  if (!Number.isFinite(max) || max <= 0) {
    preview.errors.push("请先设置有效的学科满分")
    return preview
  }
  const sources = sheets.flatMap((sheet) => {
    const first = sheet.matrix.findIndex(row => row.some(value => unitColumn(value)))
    return first >= 0 ? [{ ...sheet, first }] : []
  })
  if (sources.length !== 1) {
    preview.errors.push(sources.length ? "文件包含多个学情表，请每次导入一个班级的学情表" : "没有找到单元目标与测试列，请使用「1单元目标、1单元测试」等表头")
    return preview
  }
  const source = sources[0]
  const headers = source.matrix[source.first].map(header)
  const nameColumn = headers.indexOf("姓名")
  const numberColumn = headers.indexOf("学号")
  const genderColumn = headers.indexOf("性别")
  const baselineColumn = headers.indexOf("学情调研")
  const levelColumn = headers.indexOf("分层")
  if (nameColumn < 0) preview.errors.push("学情表缺少「姓名」列")
  for (const field of ["姓名", "学号", "性别", "学情调研", "分层"]) {
    if (headers.filter(value => value === field).length > 1) preview.errors.push(`学情表重复的「${field}」列`)
  }
  const columns = new Map<number, Partial<Record<"target" | "actual", number>>>()
  headers.forEach((value, index) => {
    const column = unitColumn(value)
    if (!column) return
    const pair = columns.get(column.number) ?? {}
    if (pair[column.kind] !== undefined) preview.errors.push(`第 ${column.number} 单元的${column.kind === "target" ? "目标" : "测试"}列重复`)
    pair[column.kind] = index
    columns.set(column.number, pair)
  })
  const unitNumbers = [...columns.keys()].sort((a, b) => a - b)
  preview.periods = unitNumbers.map(number => ({ id: `unit-${number}`, name: `${number}单元` }))
  for (const number of unitNumbers) {
    const pair = columns.get(number)!
    if (pair.target === undefined || pair.actual === undefined) preview.errors.push(`第 ${number} 单元须同时包含目标和测试列`)
  }
  if (preview.errors.length) return preview

  const score = (value: unknown, line: number, label: string): number | null => {
    const raw = text(value)
    if (["", "缺考", "未录入", "-", "—"].includes(raw)) return null
    const parsed = typeof value === "number" ? value : /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
      preview.errors.push(`学情表第 ${line} 行「${label}」须为 0～${max} 的数字或留空`)
      return null
    }
    return parsed
  }
  const numbers = new Set<string>()
  for (let index = source.first + 1; index < source.matrix.length; index++) {
    const cells = source.matrix[index]
    if (!cells.some(value => text(value))) continue
    const name = text(cells[nameColumn])
    if (["平均分", "平均", "总计", "合计"].includes(name)) continue
    const line = index + 1
    const number = numberColumn < 0 ? "" : text(cells[numberColumn])
    if (!name) preview.errors.push(`学情表第 ${line} 行缺少姓名`)
    if (number && numbers.has(number)) preview.errors.push(`学情表第 ${line} 行学号「${number}」重复`)
    if (number) numbers.add(number)
    const scores: Record<string, UnitScores> = {}
    for (const [i, period] of preview.periods.entries()) {
      const pair = columns.get(unitNumbers[i])!
      scores[period.id] = {
        target: score(cells[pair.target!], line, `${period.name}目标`),
        actual: score(cells[pair.actual!], line, `${period.name}测试`)
      }
    }
    const row: UnitImportRow = {
      number,
      name,
      baseline: baselineColumn < 0 ? null : score(cells[baselineColumn], line, "学情调研"),
      level: levelColumn < 0 ? "" : text(cells[levelColumn]),
      task: "",
      scores,
      line
    }
    if (genderColumn >= 0 && text(cells[genderColumn])) row.gender = text(cells[genderColumn])
    preview.rows.push(row)
  }
  if (!preview.rows.length) preview.errors.push("学情表没有学生数据")
  if (baselineColumn < 0) preview.warnings.push("未找到学情调研列，第一单元暂不计算进退步")

  const byName = new Map<string, UnitImportRow[]>()
  const byNumber = new Map<string, UnitImportRow>()
  for (const row of preview.rows) {
    if (row.name) byName.set(row.name, [...(byName.get(row.name) ?? []), row])
    if (row.number) byNumber.set(row.number, row)
  }
  for (const [name, rows] of byName) {
    if (rows.length > 1 && (rows.some(row => !row.number) || new Set(rows.map(row => row.number)).size !== rows.length)) {
      preview.errors.push(`学情表姓名「${name}」重复，同名学生须均填写不同学号`)
    }
  }
  const tasks = new Map<UnitImportRow, string>()
  let taskSheetCount = 0
  for (const sheet of sheets) {
    const first = sheet.matrix.findIndex(row => row.map(header).includes("作业任务") && row.map(header).includes("姓名"))
    if (first < 0) continue
    taskSheetCount++
    const taskHeaders = sheet.matrix[first].map(header)
    const taskColumn = taskHeaders.indexOf("作业任务")
    const studentColumn = taskHeaders.indexOf("姓名")
    const taskNumberColumn = taskHeaders.indexOf("学号")
    if (taskHeaders.filter(value => value === "姓名").length !== 1 || taskHeaders.filter(value => value === "作业任务").length !== 1 || taskHeaders.filter(value => value === "学号").length > 1) {
      preview.errors.push(`「${sheet.name}」的作业任务、姓名或学号列重复`)
      continue
    }
    let task = ""
    for (let index = first + 1; index < sheet.matrix.length; index++) {
      const cells = sheet.matrix[index]
      if (text(cells[taskColumn])) task = text(cells[taskColumn])
      const name = text(cells[studentColumn])
      if (!name && !cells.some(value => text(value))) continue
      if (["平均分", "平均", "总计", "合计"].includes(name)) continue
      const prefix = `「${sheet.name}」第 ${index + 1} 行`
      const number = taskNumberColumn < 0 ? "" : text(cells[taskNumberColumn])
      const matches = byName.get(name) ?? []
      const student = number ? byNumber.get(number) : matches.length === 1 ? matches[0] : undefined
      if (!name) preview.errors.push(`${prefix}缺少姓名`)
      else if (number && !student) preview.errors.push(`${prefix}的学号「${number}」未出现在学情表中`)
      else if (number && student?.name !== name) preview.errors.push(`${prefix}的学号「${number}」与姓名「${name}」不一致`)
      else if (!number && matches.length > 1) preview.errors.push(`${prefix}存在同名学生「${name}」，作业任务表也须填写学号`)
      else if (!student) preview.errors.push(`${prefix}的「${name}」未出现在学情表中`)
      else if (tasks.has(student)) preview.errors.push(`${prefix}的「${name}」作业任务重复`)
      else if (!task) preview.errors.push(`${prefix}未填写作业任务，无法延续上一行任务`)
      else tasks.set(student, task)
    }
  }
  for (const row of preview.rows) row.task = tasks.get(row) ?? ""
  if (!taskSheetCount) preview.warnings.push("未找到「作业任务、姓名」表，已导入学情数据，可稍后编辑作业任务")
  else if (preview.rows.some(row => !row.task)) preview.warnings.push(`有 ${preview.rows.filter(row => !row.task).length} 名学生未分配作业任务`)
  return preview
}

export function unitDifference(entry: UnitTrackingEntry, periods: UnitPeriod[], periodId: string): { gap: number | null, change: number | null } {
  const index = periods.findIndex(period => period.id === periodId)
  const current = entry.scores[periodId]
  const previous = index === 0 ? entry.baseline : index > 0 ? entry.scores[periods[index - 1].id]?.actual : null
  return {
    gap: validNumber(current?.actual) && validNumber(current?.target) ? current.actual - current.target : null,
    change: validNumber(current?.actual) && validNumber(previous) ? current.actual - previous : null
  }
}

export function unitBaselineRanks(plan: UnitTrackingPlan): Map<string, number> {
  return rankValues(plan.entries.map(entry => ({ id: entry.studentId, value: validNumber(entry.baseline) ? entry.baseline : null })))
}

/** 排名覆盖整个计划，缺失阶段不排名，变化只比较相邻阶段。 */
export function unitRankings(plan: UnitTrackingPlan, periodId: string): Map<string, UnitRanking> {
  const index = plan.periods.findIndex(period => period.id === periodId)
  if (index < 0) return new Map(plan.entries.map(entry => [entry.studentId, { rank: null, previousRank: null, rankChange: null }]))
  const current = rankValues(plan.entries.map((entry) => {
    const value = entry.scores[periodId]?.actual
    return { id: entry.studentId, value: validNumber(value) ? value : null }
  }))
  const previous = index === 0
    ? unitBaselineRanks(plan)
    : rankValues(plan.entries.map((entry) => {
        const value = entry.scores[plan.periods[index - 1].id]?.actual
        return { id: entry.studentId, value: validNumber(value) ? value : null }
      }))
  return new Map(plan.entries.map((entry) => {
    const rank = current.get(entry.studentId) ?? null
    const previousRank = previous.get(entry.studentId) ?? null
    return [entry.studentId, { rank, previousRank, rankChange: rank !== null && previousRank !== null ? previousRank - rank : null }]
  }))
}

/** average 使用所有实测分；目标对比图使用同一 eligible 样本的 pairedAverage 与 targetAverage。 */
export function unitMetrics(plan: UnitTrackingPlan, periodId: string) {
  const actual: number[] = []
  const pairedActual: number[] = []
  const targets: number[] = []
  const changes: number[] = []
  let achieved = 0
  for (const entry of plan.entries) {
    const score = entry.scores[periodId]
    if (validNumber(score?.actual)) actual.push(score.actual)
    if (validNumber(score?.actual) && validNumber(score?.target)) {
      pairedActual.push(score.actual)
      targets.push(score.target)
      if (score.actual >= score.target) achieved++
    }
    const difference = unitDifference(entry, plan.periods, periodId)
    if (difference.change !== null) changes.push(difference.change)
  }
  return {
    count: actual.length,
    total: plan.entries.length,
    missing: plan.entries.length - actual.length,
    average: mean(actual),
    pairedAverage: mean(pairedActual),
    targetAverage: mean(targets),
    achieved,
    eligible: targets.length,
    achievementRate: targets.length ? achieved / targets.length * 100 : null,
    progressCount: changes.filter(value => value > 0).length,
    comparableCount: changes.length,
    declineCount: changes.filter(value => value < 0).length,
    averageGap: mean(pairedActual.map((value, index) => value - targets[index]))
  }
}
