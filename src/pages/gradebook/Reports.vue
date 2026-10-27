<script lang="ts" setup>
import type { ReportKind } from "./report"
import type { Workspace } from "./types"
import { Download, Files } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { renderPdf } from "./export-pdf"
import { downloadBlob } from "./files"
import { buildReport, reportHtml } from "./report"

defineOptions({ name: "GradebookReports" })
const store = useGradebookStore()
const kind = ref<ReportKind>("class")
const studentId = ref("")
const subjectId = ref("")
const busy = ref(false)
const progress = ref(0)
const batchTotal = ref(0)
const cancelBatch = ref(false)
function availableStudents(data: Workspace) {
  const students = data.students.filter(student => student.classId === data.selectedClassId)
  if (data.exams.some(exam => exam.id === data.selectedExamId)) return students
  const ids = new Set((data.unitPlans ?? []).filter(plan => plan.classId === data.selectedClassId).flatMap(plan => plan.entries.map(entry => entry.studentId)))
  return students.filter(student => ids.has(student.id))
}
const reportableStudents = computed(() => availableStudents(store.workspace))
watch(() => [store.workspace.id, store.schoolClass.id, store.exam?.id, reportableStudents.value.map(student => student.id).join(","), store.workspace.unitPlans], () => {
  if (!reportableStudents.value.some(item => item.id === studentId.value)) studentId.value = reportableStudents.value[0]?.id ?? ""
  if (!store.exam?.subjects.some(item => item.id === subjectId.value)) subjectId.value = store.exam?.subjects[0]?.id ?? ""
  if (!store.exam && reportableStudents.value.length) kind.value = "student"
}, { immediate: true, deep: true })
const report = computed(() => {
  if (!store.schoolClass.id || (!store.exam && kind.value !== "student") || (kind.value === "student" && !reportableStudents.value.some(student => student.id === studentId.value)) || (kind.value === "subject" && !subjectId.value)) return null
  return buildReport(store.workspace, kind.value, kind.value === "student" ? studentId.value : subjectId.value)
})
const html = computed(() => report.value ? reportHtml(report.value) : "")
const emptyHint = computed(() => {
  if (!store.schoolClass.id) return "请先选择或新建班级，再导入考试成绩或单元计划。"
  if (!store.exam && kind.value !== "student") return "班级整体报告和单科分析报告需要普通考试；有单元记录时，可切换到学生个人报告。"
  if (!store.exam) return "当前班级暂无可生成个人报告的单元记录，请先导入单元目标与分层教学数据。"
  return "选择考试并添加学生后，可以在这里预览并导出。"
})
async function exportOne() {
  if (!report.value || busy.value) return
  busy.value = true
  const document = report.value
  const suffix = store.exam?.name ?? "单元教学"
  try {
    downloadBlob(await renderPdf(document), `${document.title}-${suffix}.pdf`)
    ElMessage.success("PDF 已生成")
  } catch (error) {
    ElMessage.error(`导出失败：${(error as Error).message}`)
  } finally {
    busy.value = false
  }
}
async function exportBatch() {
  if (!reportableStudents.value.length || busy.value) return
  const data = JSON.parse(JSON.stringify(store.workspace)) as typeof store.workspace
  const students = availableStudents(data)
  busy.value = true
  progress.value = 0
  batchTotal.value = students.length
  cancelBatch.value = false
  try {
    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    for (const student of students) {
      if (cancelBatch.value) break
      const document = buildReport(data, "student", student.id)
      zip.file(`${student.number}-${student.name}.pdf`.replace(/[<>:"/\\|?*]/g, "_"), await renderPdf(document))
      progress.value++
    }
    if (cancelBatch.value) {
      ElMessage.info("已取消，未下载不完整的报告包")
      return
    }
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${data.classes.find(item => item.id === data.selectedClassId)?.name}-${data.exams.find(item => item.id === data.selectedExamId)?.name ?? "单元教学"}-学生报告.zip`)
    ElMessage.success(`已打包 ${progress.value} 份独立学生 PDF`)
  } catch (error) {
    ElMessage.error(`批量导出失败：${(error as Error).message}`)
  } finally {
    busy.value = false
    batchTotal.value = 0
  }
}
</script>

<template>
  <div>
    <section class="panel">
      <div class="toolbar">
        <div class="toolbar-group">
          <el-radio-group v-model="kind" :disabled="busy" aria-label="报告类型">
            <el-radio-button value="class">
              班级整体报告
            </el-radio-button><el-radio-button value="subject">
              单科分析报告
            </el-radio-button><el-radio-button value="student">
              学生个人报告
            </el-radio-button>
          </el-radio-group><el-select v-if="kind === 'student'" v-model="studentId" filterable :disabled="busy" placeholder="选择学生" style="width: 190px" aria-label="报告学生">
            <el-option v-for="student in reportableStudents" :key="student.id" :label="`${student.number} · ${student.name}`" :value="student.id" />
          </el-select><el-select v-if="kind === 'subject'" v-model="subjectId" :disabled="busy" style="width: 120px" aria-label="报告学科">
            <el-option v-for="subject in store.exam?.subjects" :key="subject.id" :label="subject.name" :value="subject.id" />
          </el-select>
        </div>
      </div><div class="report-actions">
        <el-button type="primary" :icon="Download" :loading="busy && !batchTotal" :disabled="!report || busy" aria-label="导出当前报告 PDF" @click="exportOne">
          导出当前报告 PDF
        </el-button><el-button :icon="Files" :disabled="!reportableStudents.length || busy" aria-label="批量导出学生 PDF" @click="exportBatch">
          批量导出学生 PDF（{{ reportableStudents.length }} 份 ZIP）
        </el-button>
      </div><el-alert v-if="batchTotal" type="info" :closable="false" :title="`正在生成 ${progress} / ${batchTotal} 份报告，请保持页面打开`">
        <el-progress :percentage="Math.round(progress / batchTotal * 100)" /><el-button text aria-label="取消批量导出" @click="cancelBatch = true">
          取消批量导出
        </el-button>
      </el-alert><p class="hint">
        报告含学情统计、近期成绩和规则生成的学习 / 教学建议。个人报告还包含单元目标、分层、作业任务及学生管理中维护的教师评价，展示当前保存的记录；来源未提供日期的单元记录不绑定所选考试。中文使用图像方式保留，导出内容与预览一致。
      </p><p v-if="!store.exam" class="hint">
        当前没有普通考试，批量仅导出本班有单元记录的 {{ reportableStudents.length }} 位学生，每人一份 PDF，打包为 ZIP；未导入单元记录的学生不生成空报告。
      </p>
    </section><div v-if="html" class="report-preview section-gap" aria-label="报告预览" v-html="html" /><section v-else class="panel empty-state section-gap">
      <h2>准备好第一份成长报告</h2><p>{{ emptyHint }}</p><router-link :to="store.exam ? '/scores' : '/unit-teaching'">
        <el-button type="primary">
          {{ store.exam ? '去录入成绩' : '去导入单元计划' }}
        </el-button>
      </router-link>
    </section>
  </div>
</template>

<style scoped>
.report-preview {
  overflow: auto;
  padding: 25px;
  background: #e9ede4;
  border-radius: 10px;
}
.report-preview :deep(.print-report) {
  margin: 0 auto;
  box-shadow: 0 4px 20px #3246330d;
}
@media (max-width: 650px) {
  .report-preview {
    padding: 12px;
  }
}
</style>
