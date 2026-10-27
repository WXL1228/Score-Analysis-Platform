import type { Student, UnitTrackingPlan } from "./types"
import { downloadBlob } from "./files"
import { unitBaselineRanks, unitDifference, unitRankings } from "./unit-tracking"

export async function exportUnitWorkbook(plan: UnitTrackingPlan, students: Student[], className: string, subjectName: string): Promise<void> {
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet("单元目标")
  sheet.addRow(["学号", "姓名", "性别", "学情调研", "学情调研排名", "分层", ...plan.periods.flatMap((period) => {
    const name = period.name.replace(/^第/, "")
    return [`${name}目标`, `${name}测试`, `${name}超目标（分）`, `${name}分数变化（分）`, `${name}班级排名`, `${name}排名变化（名）`]
  })])
  const tasks = workbook.addWorksheet("作业分组")
  tasks.addRow(["作业任务", "学号", "姓名"])
  const baselineRanks = unitBaselineRanks(plan)
  const rankings = new Map(plan.periods.map(period => [period.id, unitRankings(plan, period.id)]))
  for (const entry of plan.entries) {
    const student = students.find(student => student.id === entry.studentId)!
    sheet.addRow([student.number, student.name, student.gender ?? "", entry.baseline, baselineRanks.get(entry.studentId) ?? null, entry.level, ...plan.periods.flatMap((period) => {
      const result = unitDifference(entry, plan.periods, period.id)
      const ranking = rankings.get(period.id)!.get(entry.studentId)!
      return [entry.scores[period.id]?.target ?? null, entry.scores[period.id]?.actual ?? null, result.gap, result.change, ranking.rank, ranking.rankChange]
    })])
    if (entry.task) tasks.addRow([entry.task, student.number, student.name])
  }
  for (const table of workbook.worksheets) {
    table.columns.forEach((column) => {
      column.width = 16
    })
    table.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    table.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF337665" } }
    table.getRow(1).alignment = { wrapText: true, vertical: "middle" }
    table.getRow(1).height = 36
    table.views = [{ state: "frozen", ySplit: 1 }]
  }
  sheet.getColumn(1).numFmt = "@"
  tasks.getColumn(2).numFmt = "@"
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${className}-${subjectName}-${plan.name}.xlsx`)
}
