import type { Exam, RankedStudent, Statistics, Workspace } from "./types"

export function round(value: number): number {
  return Math.round(value * 10) / 10
}

export function rankValues(values: { id: string, value: number | null }[]): Map<string, number> {
  const sorted = values.filter(item => item.value !== null).sort((a, b) => b.value! - a.value!)
  const result = new Map<string, number>()
  let rank = 0
  sorted.forEach((item, index) => {
    if (index === 0 || item.value !== sorted[index - 1].value) rank = index + 1
    result.set(item.id, rank)
  })
  return result
}

export function previousExam(data: Workspace, exam: Exam, classId: string): Exam | undefined {
  const students = new Set(data.students.filter(student => student.classId === classId).map(student => student.id))
  const sorted = [...data.exams].sort((a, b) => a.date.localeCompare(b.date) || data.exams.indexOf(a) - data.exams.indexOf(b))
  return sorted.slice(0, sorted.findIndex(item => item.id === exam.id)).reverse().find(item => data.records.some(record => record.examId === item.id && students.has(record.studentId)))
}

export function comparableExams(a: Exam, b: Exam): boolean {
  return a.subjects.length === b.subjects.length && a.subjects.every(subject => b.subjects.some(other => other.id === subject.id && other.max === subject.max))
}

export function rankedStudents(data: Workspace, examId: string, classId?: string, includePrevious = true): RankedStudent[] {
  const exam = data.exams.find(item => item.id === examId)
  if (!exam) return []
  const records = new Map(data.records.filter(item => item.examId === examId).map(item => [item.studentId, item.scores]))
  const all = data.students.map((student) => {
    const scores = records.get(student.id) ?? {}
    return { ...student, scores, total: round(exam.subjects.reduce((sum, subject) => sum + (scores[subject.id] ?? 0), 0)) }
  })
  const gradeRanks = rankValues(all.map(item => ({ id: item.id, value: item.total })))
  const students = all.filter(student => !classId || student.classId === classId)
  const classRanks = new Map<string, number>()
  const subjectRanks = new Map<string, Map<string, number>>()
  for (const group of data.classes) {
    const groupStudents = all.filter(student => student.classId === group.id)
    rankValues(groupStudents.map(item => ({ id: item.id, value: item.total }))).forEach((value, id) => classRanks.set(id, value))
    for (const subject of exam.subjects) {
      subjectRanks.set(`${group.id}:${subject.id}`, rankValues(groupStudents.map(item => ({ id: item.id, value: item.scores[subject.id] ?? null }))))
    }
  }
  const previousRows = new Map<string, RankedStudent>()
  if (includePrevious) {
    for (const group of data.classes.filter(group => !classId || group.id === classId)) {
      const previous = previousExam(data, exam, group.id)
      if (previous && comparableExams(exam, previous)) {
        rankedStudents(data, previous.id, group.id, false).forEach(row => previousRows.set(row.id, row))
      }
    }
  }
  return students.map((student) => {
    const rank = classRanks.get(student.id) ?? null
    const previousRank = previousRows.get(student.id)?.rank ?? null
    const change = rank !== null && previousRank !== null ? previousRank - rank : null
    const failing = exam.subjects.filter(subject => typeof student.scores[subject.id] === "number" && student.scores[subject.id]! < subject.pass)
    const warnings: string[] = []
    if (exam.subjects.some(subject => typeof student.scores[subject.id] !== "number")) warnings.push("成绩不完整")
    if (change !== null && change <= -data.warningThreshold) warnings.push(`退步 ${-change} 名`)
    if (failing.length) warnings.push(`${failing.map(subject => subject.name).join("、")}未及格`)
    if (student.focus) warnings.push("教师关注")
    return {
      ...student,
      average: round(student.total / exam.subjects.length),
      rank,
      gradeRank: gradeRanks.get(student.id) ?? null,
      previousRank,
      change,
      warnings,
      subjectRanks: Object.fromEntries(exam.subjects.map(subject => [subject.id, subjectRanks.get(`${student.classId}:${subject.id}`)?.get(student.id) ?? null]))
    }
  }).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.number.localeCompare(b.number, "zh-CN", { numeric: true }))
}

export function statistics(values: (number | null | undefined)[], pass: number, excellent: number): Statistics {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (!valid.length) return { count: 0, average: 0, max: 0, min: 0, passRate: 0, excellentRate: 0 }
  return {
    count: valid.length,
    average: round(valid.reduce((sum, value) => sum + value, 0) / valid.length),
    max: Math.max(...valid),
    min: Math.min(...valid),
    passRate: round(valid.filter(value => value >= pass).length / valid.length * 100),
    excellentRate: round(valid.filter(value => value >= excellent).length / valid.length * 100)
  }
}

export function totalStatistics(rows: RankedStudent[], exam: Exam | undefined): Statistics {
  return statistics(rows.map(row => row.total), exam?.subjects.reduce((sum, subject) => sum + subject.pass, 0) ?? 0, exam?.subjects.reduce((sum, subject) => sum + subject.excellent, 0) ?? 0)
}

export function studentAdvice(row: RankedStudent, exam: Exam): string[] {
  if (exam.subjects.some(subject => typeof row.scores[subject.id] !== "number")) return ["本次缺考或未录入科目按 0 分计入总分与排名，请先核对缺考情况并补录待录入成绩，再结合答卷制定学习计划。"]
  const sorted = [...exam.subjects].sort((a, b) => row.scores[a.id]! / a.max - row.scores[b.id]! / b.max)
  const weak = sorted[0]
  const strong = sorted[sorted.length - 1]
  const advice = [`${weak.name}得分率为 ${round(row.scores[weak.id]! / weak.max * 100)}%，建议每周安排两次基础练习，整理错题并在一周后复测。`]
  if (row.scores[strong.id]! >= strong.excellent) advice.push(`${strong.name}达到优秀线，建议保持优势，尝试向同伴讲解解题思路。`)
  if (row.change !== null && row.change < 0) advice.push(`班级排名下降 ${-row.change} 名，建议结合答卷检查失分原因，并与教师共同制定下次目标。`)
  else advice.push("把目标拆分为可执行的每日任务，优先保证知识点掌握，再逐步提高速度与准确率。")
  return advice
}

export function teachingAdvice(rows: RankedStudent[], exam: Exam | undefined): string[] {
  if (!exam || !rows.some(row => Object.values(row.scores).some(value => value !== null))) return ["导入或录入一次考试后，将生成针对当前班级的教学建议。"]
  const subjects = exam.subjects.map(subject => ({ ...subject, stats: statistics(rows.map(row => row.scores[subject.id]), subject.pass, subject.excellent) }))
    .filter(subject => subject.stats.count > 0)
    .sort((a, b) => a.stats.average / a.max - b.stats.average / b.max)
  const weak = subjects[0]
  const strong = [...subjects].sort((a, b) => b.stats.excellentRate - a.stats.excellentRate)[0]
  const falling = rows.filter(row => row.change !== null && row.change < 0)
  return [
    `${weak.name}平均得分率 ${round(weak.stats.average / weak.max * 100)}%，及格率 ${weak.stats.passRate}%。下一阶段优先梳理基础知识，安排分层练习与错题复测。`,
    `${strong.name}优秀率 ${strong.stats.excellentRate}%。可设置拓展任务，组织优秀学生分享方法，带动同伴学习。`,
    falling.length ? `${falling.length} 位学生排名下降，优先关注超出预警阈值及多科未及格的学生，通过短访谈、答卷分析确定支持方案。` : "保持对未及格与教师标记学生的跟踪，定期检查学习任务完成情况。",
    "建议依据本次答卷补充知识点错因分析；当前建议仅基于分数与排名，由教师结合课堂表现调整。"
  ]
}
