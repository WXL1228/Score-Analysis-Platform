import type { Exam, RankedStudent, Workspace } from "./types"
import { rankedStudents, round, statistics, studentAdvice, teachingAdvice, totalStatistics } from "./analytics"

export type ReportKind = "class" | "subject" | "student"
export interface ReportTable {
  title: string
  headers: string[]
  rows: (string | number | null | undefined)[][]
}
export interface ReportDocument {
  title: string
  subtitle: string
  teacher: string
  metrics: { label: string, value: string | number }[]
  tables: ReportTable[]
  sections: { title: string, paragraphs: string[] }[]
  trend?: { name: string, value: number | null }[]
}

function scoreTable(rows: RankedStudent[], exam: Exam): ReportTable {
  return {
    title: "学科统计",
    headers: ["学科", "有效人数", "平均分", "最高分", "最低分", "及格率", "优秀率"],
    rows: exam.subjects.map((subject) => {
      const stats = statistics(rows.map(row => row.scores[subject.id]), subject.pass, subject.excellent)
      return [subject.name, stats.count, stats.count ? stats.average : "—", stats.count ? stats.max : "—", stats.count ? stats.min : "—", stats.count ? `${stats.passRate}%` : "—", stats.count ? `${stats.excellentRate}%` : "—"]
    })
  }
}

export function buildReport(data: Workspace, kind: ReportKind, targetId = ""): ReportDocument {
  const exam = data.exams.find(item => item.id === data.selectedExamId)
  const group = data.classes.find(item => item.id === data.selectedClassId)
  if (!exam || !group) throw new Error("请先选择班级与考试")
  const rows = rankedStudents(data, exam.id, group.id)
  const stats = totalStatistics(rows, exam)
  const full = exam.subjects.reduce((sum, subject) => sum + subject.max, 0)
  const base = { subtitle: `${group.name} · ${exam.name} · ${exam.date}`, teacher: data.teacher || "未填写" }
  if (kind === "student") {
    const student = rows.find(row => row.id === targetId)
    if (!student) throw new Error("请选择当前班级的学生")
    const history = [...data.exams].sort((a, b) => a.date.localeCompare(b.date) || data.exams.indexOf(a) - data.exams.indexOf(b)).map(item => ({ exam: item, row: rankedStudents(data, item.id, group.id, false).find(row => row.id === targetId) }))
    return {
      ...base,
      title: `${student.name}的个人成长报告`,
      metrics: [
        { label: `总分 / ${full}`, value: student.total ?? "待补全" },
        { label: "班级排名", value: student.rank ?? "—" },
        { label: "跨班排名（当前档案）", value: student.gradeRank ?? "—" },
        { label: "班级排名变化", value: student.change === null ? "暂无可比记录" : student.change === 0 ? "持平" : `${student.change > 0 ? "进步" : "退步"} ${Math.abs(student.change)} 名` }
      ],
      tables: [
        { title: `各科成绩 · 学号 ${student.number}`, headers: ["学科", "成绩 / 满分", "班级排名", "达标情况"], rows: exam.subjects.map(subject => [subject.name, `${student.scores[subject.id] ?? "缺考 / 未录入"} / ${subject.max}`, student.subjectRanks[subject.id] ?? "—", student.scores[subject.id] === undefined || student.scores[subject.id] === null ? "待补全" : student.scores[subject.id]! >= subject.excellent ? "优秀" : student.scores[subject.id]! >= subject.pass ? "及格" : "待提升"]) },
        { title: "近期成绩与排名（最近 6 次）", headers: ["考试", "总分 / 满分", "班级排名", ...exam.subjects.map(subject => `${subject.name}排名`)], rows: history.slice(-6).map(item => [item.exam.name, `${item.row?.total ?? "—"} / ${item.exam.subjects.reduce((sum, subject) => sum + subject.max, 0)}`, item.row?.rank ?? "—", ...exam.subjects.map(subject => item.row?.subjectRanks[subject.id] ?? "—")]) }
      ],
      sections: [{ title: "学习建议与下一步目标", paragraphs: studentAdvice(student, exam) }, ...(student.note ? [{ title: "教师观察", paragraphs: [student.note] }] : [])],
      trend: history.slice(-6).map(item => ({ name: item.exam.name, value: item.row?.total === null || item.row?.total === undefined ? null : round(item.row.total / item.exam.subjects.reduce((sum, subject) => sum + subject.max, 0) * 100) }))
    }
  }
  if (kind === "subject") {
    const subject = exam.subjects.find(item => item.id === targetId)
    if (!subject) throw new Error("请选择学科")
    const stats = statistics(rows.map(row => row.scores[subject.id]), subject.pass, subject.excellent)
    const failing = rows.filter(row => typeof row.scores[subject.id] === "number" && row.scores[subject.id]! < subject.pass)
    return {
      ...base,
      title: `${subject.name}学科分析报告`,
      metrics: [{ label: `平均分 / ${subject.max}`, value: stats.count ? stats.average : "—" }, { label: "及格率", value: stats.count ? `${stats.passRate}%` : "—" }, { label: "优秀率", value: stats.count ? `${stats.excellentRate}%` : "—" }, { label: "有效人数", value: stats.count }],
      tables: [
        { title: "同次考试跨班对比", headers: ["班级", "有效人数", "平均分", "最高分", "最低分", "及格率"], rows: data.classes.map((group) => {
          const stats = statistics(rankedStudents(data, exam.id, group.id, false).map(row => row.scores[subject.id]), subject.pass, subject.excellent)
          return [group.name, stats.count, stats.count ? stats.average : "—", stats.count ? stats.max : "—", stats.count ? stats.min : "—", stats.count ? `${stats.passRate}%` : "—"]
        }) },
        { title: `优先支持名单（未及格 ${failing.length} 人，列出前 8 位）`, headers: ["学号", "姓名", "成绩", "教师备注"], rows: failing.slice(0, 8).map(row => [row.number, row.name, row.scores[subject.id], row.note || "—"]) }
      ],
      sections: [{ title: "教学建议", paragraphs: stats.count
        ? [
            `${subject.name}平均得分率 ${round(stats.average / subject.max * 100)}%，最高 ${stats.max} 分、最低 ${stats.min} 分，及格线 ${subject.pass} 分，优秀线 ${subject.excellent} 分。`,
            failing.length ? `对 ${failing.length} 位未及格学生进行基础知识诊断，结合答卷找出共同失分点，安排小组辅导与同类题复测。` : "本次有效成绩均达到及格线，建议加强综合应用和方法迁移。",
            "把课堂练习分为基础巩固与拓展应用两组，一周后用短测评检查教学调整效果。"
          ]
        : ["暂无有效成绩，请补充录入后进行学科分析。"] }]
    }
  }
  const attention = rows.filter(row => row.warnings.length).sort((a, b) => (a.change ?? 0) - (b.change ?? 0))
  return {
    ...base,
    title: "班级整体学情报告",
    metrics: [{ label: `平均总分 / ${full}`, value: stats.count ? stats.average : "—" }, { label: "总分及格率", value: stats.count ? `${stats.passRate}%` : "—" }, { label: "总分优秀率", value: stats.count ? `${stats.excellentRate}%` : "—" }, { label: "参与排名 / 全班人数", value: `${stats.count} / ${rows.length}` }],
    tables: [scoreTable(rows, exam), { title: `重点关注（${attention.length} 人，列出前 6 位）`, headers: ["学生", "总分", "班级排名", "关注原因"], rows: attention.slice(0, 6).map(row => [row.name, row.total ?? "—", row.rank ?? "—", row.warnings.join("；")]) }],
    sections: [{ title: "教学方向与后续支持", paragraphs: teachingAdvice(rows, exam) }]
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export const REPORT_CSS = `
.print-report{width:794px;min-height:1123px;padding:46px 48px 36px;background:#fff;color:#33463c;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:11px;line-height:1.7;box-sizing:border-box;}
.print-report *{box-sizing:border-box;}
.print-report .report-header{border-bottom:2px solid #337c68;padding-bottom:20px;margin-bottom:22px;}
.print-report .report-brand{font-size:10px;letter-spacing:3px;color:#829375;margin-bottom:16px;}
.print-report h1{font-size:25px;letter-spacing:1px;margin:0 0 10px;font-weight:600;}
.print-report .report-subtitle{font-size:11px;color:#879380;}
.print-report .report-metrics{display:flex;gap:12px;margin:0 0 22px;}
.print-report .report-metric{flex:1;padding:14px 12px;background:#f3f6ef;border-radius:6px;min-width:0;}
.print-report .report-metric small{color:#8f9c84;display:block;font-size:9px;}
.print-report .report-metric strong{font-size:19px;font-weight:500;display:block;margin-top:8px;overflow-wrap:anywhere;}
.print-report h2{font-size:13px;margin:22px 0 10px;font-weight:600;}
.print-report table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;}
.print-report th{background:#edf2e7;color:#71866a;font-weight:500;text-align:left;}
.print-report td,.print-report th{padding:8px 7px;border-bottom:1px solid #e8ede1;overflow-wrap:anywhere;vertical-align:top;}
.print-report ul{padding-left:18px;margin:8px 0 0;}
.print-report li{margin-bottom:7px;color:#798770;overflow-wrap:anywhere;}
.print-report .report-footer{margin-top:25px;padding-top:15px;border-top:1px solid #e1e8da;color:#a0a88f;font-size:9px;line-height:1.9;}
.print-report svg{width:100%;height:130px;}
`

function trendSvg(values: NonNullable<ReportDocument["trend"]>): string {
  const coords = values.map((item, index) => ({ ...item, x: values.length > 1 ? 40 + index / (values.length - 1) * 580 : 330, y: item.value === null ? null : 100 - item.value * 0.75 }))
  let paths = ""
  let active = false
  for (const item of coords) {
    if (item.y === null) {
      active = false
      continue
    }
    paths += `${active ? " L" : " M"}${item.x},${item.y}`
    active = true
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 130"><line x1="30" y1="100" x2="635" y2="100" stroke="#e0e7d8"/><path d="${paths}" fill="none" stroke="#337c68" stroke-width="2"/>${coords.map(item => `${item.y === null ? "" : `<circle cx="${item.x}" cy="${item.y}" r="3" fill="#337c68"/><text x="${item.x}" y="${item.y - 9}" text-anchor="middle" font-size="10" fill="#688360">${item.value}%</text>`}<text x="${item.x}" y="120" text-anchor="middle" font-size="9" fill="#8e9b83">${escapeHtml(item.name.slice(0, 10))}</text>`).join("")}</svg>`
}

export function reportHtml(report: ReportDocument): string {
  return `<style>${REPORT_CSS}</style><article class="print-report"><header class="report-header"><div class="report-brand">成绩分析平台 / QINGHE GRADEBOOK</div><h1>${escapeHtml(report.title)}</h1><div class="report-subtitle">${escapeHtml(report.subtitle)} · 教师：${escapeHtml(report.teacher)}</div></header><div class="report-metrics">${report.metrics.map(item => `<div class="report-metric"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>${report.tables.map(table => `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${table.headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${table.rows.length ? table.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${table.headers.length}">暂无记录</td></tr>`}</tbody></table></section>`).join("")}${report.trend ? `<section><h2>总分得分率成长轨迹</h2>${trendSvg(report.trend)}</section>` : ""}${report.sections.map(section => `<section><h2>${escapeHtml(section.title)}</h2><ul>${section.paragraphs.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul></section>`).join("")}<footer class="report-footer">统计口径：同分并列排名；缺考或未录入科目按 0 分计入总分与排名，平均分按本次考试全部学科计算；各科统计仍按有效成绩人数，总分统计包含当前班级全部学生。总分及格 / 优秀线为各科对应分数线之和。排名变化仅比较科目及满分一致的上次考试。<br>建议根据成绩与排名规则生成，请结合答卷和课堂观察使用。跨班排名覆盖当前档案学生名册，不代表未添加的整个年级。此报告含学生信息，请妥善保管。</footer></article>`
}
