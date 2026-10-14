<script lang="ts" setup>
import type { ReportKind } from "./report"
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
watch(() => [store.workspace.id, store.schoolClass.id, store.exam?.id, store.students.length], () => {
  if (!store.students.some(item => item.id === studentId.value)) studentId.value = store.students[0]?.id ?? ""
  if (!store.exam?.subjects.some(item => item.id === subjectId.value)) subjectId.value = store.exam?.subjects[0]?.id ?? ""
}, { immediate: true })
const report = computed(() => {
  if (!store.exam || !store.schoolClass.id || (kind.value === "student" && !studentId.value)) return null
  return buildReport(store.workspace, kind.value, kind.value === "student" ? studentId.value : subjectId.value)
})
const html = computed(() => report.value ? reportHtml(report.value) : "")
async function exportOne() {
  if (!report.value || busy.value) return
  busy.value = true
  const document = report.value
  try {
    downloadBlob(await renderPdf(document), `${document.title}-${store.exam?.name}.pdf`)
    ElMessage.success("PDF 已生成")
  } catch (error) {
    ElMessage.error(`导出失败：${(error as Error).message}`)
  } finally {
    busy.value = false
  }
}
async function exportBatch() {
  if (!store.students.length || !store.exam || busy.value) return
  const data = JSON.parse(JSON.stringify(store.workspace)) as typeof store.workspace
  const students = data.students.filter(item => item.classId === data.selectedClassId)
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
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${data.classes.find(item => item.id === data.selectedClassId)?.name}-${data.exams.find(item => item.id === data.selectedExamId)?.name}-学生报告.zip`)
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
          <el-radio-group v-model="kind" :disabled="busy">
            <el-radio-button value="class">
              班级整体报告
            </el-radio-button><el-radio-button value="subject">
              单科分析报告
            </el-radio-button><el-radio-button value="student">
              学生个人报告
            </el-radio-button>
          </el-radio-group><el-select v-if="kind === 'student'" v-model="studentId" filterable :disabled="busy" placeholder="选择学生" style="width: 190px" aria-label="报告学生">
            <el-option v-for="student in store.students" :key="student.id" :label="`${student.number} · ${student.name}`" :value="student.id" />
          </el-select><el-select v-if="kind === 'subject'" v-model="subjectId" :disabled="busy" style="width: 120px" aria-label="报告学科">
            <el-option v-for="subject in store.exam?.subjects" :key="subject.id" :label="subject.name" :value="subject.id" />
          </el-select>
        </div>
      </div><div class="report-actions">
        <el-button type="primary" :icon="Download" :loading="busy && !batchTotal" :disabled="!report || busy" @click="exportOne">
          导出当前报告 PDF
        </el-button><el-button :icon="Files" :disabled="!store.students.length || !store.exam || busy" @click="exportBatch">
          批量导出全班学生 PDF（ZIP）
        </el-button>
      </div><el-alert v-if="batchTotal" type="info" :closable="false" :title="`正在生成 ${progress} / ${batchTotal} 份报告，请保持页面打开`">
        <el-progress :percentage="Math.round(progress / batchTotal * 100)" /><el-button text @click="cancelBatch = true">
          取消批量导出
        </el-button>
      </el-alert><p class="hint">
        报告含学情统计、近期成绩和规则生成的学习 / 教学建议。全班批量导出为每位学生各一份 PDF，打包为 ZIP。中文使用图像方式保留，导出内容与预览一致。
      </p>
    </section><div v-if="html" class="report-preview section-gap" aria-label="报告预览" v-html="html" /><section v-else class="panel empty-state section-gap">
      <h2>准备好第一份成长报告</h2><p>选择考试并添加学生后，可以在这里预览并导出。</p><router-link to="/scores">
        <el-button type="primary">
          去录入成绩
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
