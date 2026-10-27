import type { Student, Workspace } from "./types"
import { unitBaselineRanks, unitDifference, unitRankings } from "./unit-tracking"

export interface StudentUnitReport {
  title: string
  subjectName: string
  max: number
  baseline: number | null
  baselineRank: number | null
  level: string
  task: string
  rows: {
    period: string
    target: number | null
    actual: number | null
    gap: number | null
    change: number | null
    rank: number | null
    previousRank: number | null
    rankChange: number | null
    status: string
  }[]
  advice: string[]
}

export function buildStudentUnitReports(data: Workspace, student: Student): StudentUnitReport[] {
  return (data.unitPlans ?? []).filter(plan => plan.classId === student.classId).flatMap((plan) => {
    const entry = plan.entries.find(entry => entry.studentId === student.id)
    const subject = data.subjects.find(subject => subject.id === plan.subjectId)
    if (!entry || !subject) return []
    const baselineRank = unitBaselineRanks(plan).get(student.id) ?? null
    const rows = plan.periods.map((period) => {
      const target = entry.scores[period.id]?.target ?? null
      const actual = entry.scores[period.id]?.actual ?? null
      const difference = unitDifference(entry, plan.periods, period.id)
      const ranking = unitRankings(plan, period.id).get(student.id)!
      return { period: period.name, target, actual, ...difference, ...ranking, status: actual === null ? "缺考或未录入" : target === null ? "未设目标" : difference.gap! >= 0 ? "已达标" : "未达标" }
    })
    const latest = [...rows].reverse().find(row => row.actual !== null)
    const advice: string[] = []
    if (!latest) {
      advice.push("尚无单元测试成绩，请补录后再观察目标达成与变化。")
      if (rows.every(row => row.target === null)) advice.push("尚未设置个人目标，请结合学情调研与教师观察设置目标分数。")
    } else {
      if (latest.target === null) advice.push(`「${latest.period}」尚未设置个人目标，建议补充目标后再评估达成情况。`)
      else if (latest.gap! < 0) advice.push(`「${latest.period}」距个人目标差 ${Math.round(Math.abs(latest.gap!) * 100) / 100} 分，建议结合答卷核对失分题，安排练习后复测。`)
      else advice.push(`「${latest.period}」已达到个人目标，建议巩固本单元练习，并与教师商定下一阶段目标。`)
      if (latest.change === null) advice.push(`「${latest.period}」缺少可比的学情调研或上一单元成绩，请补全相邻阶段记录后再判断变化。`)
      else if (latest.change < 0) advice.push(`「${latest.period}」较前一阶段下降 ${Math.round(Math.abs(latest.change) * 100) / 100} 分，建议结合试题难度和课堂表现复核变化。`)
      else if (latest.change > 0) advice.push(`「${latest.period}」较前一阶段提高 ${Math.round(latest.change * 100) / 100} 分，建议记录有效的学习安排并继续跟进。`)
      else advice.push(`「${latest.period}」与前一阶段持平，建议结合练习反馈调整下一阶段安排。`)
      if (latest.rank !== null) {
        const change = latest.rankChange === null ? "缺少相邻阶段有效排名，暂不比较名次变化" : latest.rankChange === 0 ? "较前一阶段名次持平" : `较前一阶段${latest.rankChange > 0 ? "进步" : "退步"} ${Math.abs(latest.rankChange)} 名`
        advice.push(`「${latest.period}」班级排名第 ${latest.rank} 名，${change}。`)
      }
      if (rows.at(-1)?.actual === null) advice.push(`以上建议依据最近已录入的「${latest.period}」表现，后续单元成绩请及时补录。`)
    }
    if (entry.task) advice.push(`继续完成已分配的「${entry.task}」，记录练习反馈，并与教师确认下一步安排。`)
    return [{ title: plan.name, subjectName: subject.name, max: subject.max, baseline: entry.baseline, baselineRank, level: entry.level, task: entry.task, rows, advice }]
  })
}
