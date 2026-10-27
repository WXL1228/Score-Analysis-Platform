import type { ReportDocument } from "./report"
import { reportHtml } from "./report"

export async function renderPdf(report: ReportDocument): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF: JsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")])
  const host = document.createElement("div")
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:794px;"
  host.innerHTML = reportHtml(report)
  document.body.append(host)
  try {
    await document.fonts.ready
    const element = host.querySelector<HTMLElement>(".print-report")!
    const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff", logging: false, windowWidth: 1200 })
    const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
    pdf.setProperties({ title: report.title, subject: report.subtitle, author: report.teacher, creator: "成绩分析平台" })
    const margin = 10
    const width = 210 - margin * 2
    const pageHeight = (297 - margin * 2) / width * canvas.width
    const rect = element.getBoundingClientRect()
    const protectedBlocks = Array.from(element.querySelectorAll("tr, li, .report-header, .report-metrics, .unit-report-intro, .unit-report-chart, .report-advice, svg, .report-footer")).map((block) => {
      const bounds = block.getBoundingClientRect()
      return { top: (bounds.top - rect.top) * 2, bottom: (bounds.bottom - rect.top) * 2 }
    })
    // 忽略版面末尾的纯白留白，防止只因底部 padding 多出空白页。
    const contentHeight = Math.min(canvas.height, Math.ceil(Math.max(...protectedBlocks.map(block => block.bottom))) + 12)
    let offset = 0
    while (offset < contentHeight) {
      let end = Math.min(contentHeight, offset + Math.floor(pageHeight))
      // 尽量在表格行和段落之间分页，避免切断一位学生的信息。
      const crossed = protectedBlocks.find(block => block.top < end && block.bottom > end && block.top > offset + 100)
      if (crossed) end = Math.floor(crossed.top)
      const page = document.createElement("canvas")
      page.width = canvas.width
      page.height = Math.max(1, end - offset)
      page.getContext("2d")!.drawImage(canvas, 0, offset, canvas.width, page.height, 0, 0, canvas.width, page.height)
      if (offset) pdf.addPage()
      pdf.addImage(page.toDataURL("image/png"), "PNG", margin, margin, width, page.height / page.width * width)
      offset = end
    }
    const count = pdf.getNumberOfPages()
    pdf.setFontSize(8)
    pdf.setTextColor(135, 150, 125)
    for (let page = 1; page <= count; page++) {
      pdf.setPage(page)
      pdf.text(`${page} / ${count}`, 200, 292, { align: "right" })
    }
    return pdf.output("blob")
  } finally {
    host.remove()
  }
}
