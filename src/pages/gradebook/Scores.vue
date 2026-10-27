<script lang="ts" setup>
import type { ImportPreview, RankedStudent } from "./types"
import { Download, EditPen, Plus, Upload } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import ExamDialog from "./components/ExamDialog.vue"
import RankChange from "./components/RankChange.vue"
import ScoreDialog from "./components/ScoreDialog.vue"
import StudentDialog from "./components/StudentDialog.vue"
import { exportWorkbook, parseScoreMatrix, readScoreFile } from "./files"

defineOptions({ name: "GradebookScores" })
const store = useGradebookStore()
const examVisible = ref(false)
const studentVisible = ref(false)
const scoreVisible = ref(false)
const editingId = ref("")
const isLoading = ref(false)
const input = useTemplateRef<HTMLInputElement>("input")
const preview = ref<ImportPreview | null>(null)
const previewVisible = ref(false)
const sheets = ref<{ name: string, matrix: unknown[][] }[]>([])
const selectedSheet = ref(0)
const query = ref("")
const page = ref(1)
const importContext = computed(() => JSON.stringify([store.workspace.id, store.workspace.selectedClassId, store.exam?.id, store.exam?.subjects]))
let readRequest = 0
const filtered = computed(() =>
  store.rows.filter(
    row => row.name.includes(query.value) || row.number.includes(query.value)
  )
)
const paged = computed(() =>
  filtered.value.slice((page.value - 1) * 15, page.value * 15)
)
watch(
  [
    query,
    importContext
  ],
  () => {
    page.value = 1
    preview.value = null
    previewVisible.value = false
    readRequest++
    isLoading.value = false
  }
)
watch(selectedSheet, parseSheet)
function parseSheet() {
  if (!store.exam || !sheets.value[selectedSheet.value]) return
  preview.value = parseScoreMatrix(
    sheets.value[selectedSheet.value].matrix,
    store.exam,
    store.schoolClass.name
  )
}
async function pickFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !store.exam) return
  const request = ++readRequest
  const context = importContext.value
  isLoading.value = true
  try {
    const loaded = await readScoreFile(file)
    if (request !== readRequest || context !== importContext.value) return
    sheets.value = loaded
    selectedSheet.value = 0
    parseSheet()
    previewVisible.value = true
  } catch (error) {
    if (request === readRequest) ElMessage.error(`读取失败：${(error as Error).message}`)
  } finally {
    if (request === readRequest) isLoading.value = false
    if (input.value) input.value.value = ""
  }
}
async function confirmImport() {
  if (!preview.value?.rows.length || preview.value.errors.length) return
  const context = importContext.value
  const rows = preview.value.rows
  try {
    await ElMessageBox.confirm(
      `将导入 ${preview.value.rows.length} 条成绩。同班同学号已有成绩的匹配科目将被更新，包括用空白覆盖为缺考。是否继续？`,
      "确认导入",
      { confirmButtonText: "确认导入", cancelButtonText: "取消" }
    )
    if (context !== importContext.value || preview.value?.rows !== rows) return ElMessage.error("考试或学科配置已变化，请重新上传成绩文件")
    store.importScores(rows)
    previewVisible.value = false
    ElMessage.success("导入成功，排名与分析已自动更新")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}
function edit(row?: RankedStudent) {
  editingId.value = row?.id ?? ""
  scoreVisible.value = true
}
async function download(template = false) {
  if (!template && !store.exam) return
  isLoading.value = true
  try {
    await exportWorkbook(
      store.exam,
      store.schoolClass.id ? store.schoolClass.name : "",
      template ? undefined : store.rows,
      template ? store.workspace.subjects : undefined
    )
  } catch (error) {
    ElMessage.error((error as Error).message)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div>
    <section class="panel import-panel">
      <div>
        <span class="import-illustration"><el-icon><Upload /></el-icon></span>
        <!-- <h2>把成绩交给青禾，把时间留给学生</h2> -->
        <p>
          支持 Excel (.xlsx) / UTF-8
          CSV。识别学科列，自动计算总分、平均分与排名。
        </p>
        <p class="hint">
          支持「序号、姓名、性别、各科成绩」成绩单，序号仅用于排序；无学号时按班级和姓名匹配。底部平均分行自动跳过，缺考请留空。
        </p>
        <p class="hint">
          模板包含语文、数学、英语、道法、物理、化学、生物、历史、地理。未开设的学科可删除整列；已有考试只导入已设置的学科。
        </p>
        <p v-if="store.exam" class="hint">
          本次考试配置学科：{{ store.exam.subjects.map(subject => subject.name).join('、') }}。文件中的其他学科列不导入；可在班级设置的考试记录中编辑配置。
        </p>
      </div>
      <div class="import-actions">
        <el-button
          type="primary"
          :icon="Upload"
          :loading="isLoading"
          :disabled="!store.exam || !store.schoolClass.id"
          @click="input?.click()"
        >
          上传成绩文件
        </el-button><el-button
          :icon="Download"
          :loading="isLoading"
          @click="download(true)"
        >
          下载 Excel 模板
        </el-button><el-button :icon="Plus" @click="examVisible = true">
          新建考试
        </el-button>
      </div>
      <input
        ref="input"
        type="file"
        accept=".xlsx,.csv"
        hidden
        @change="pickFile"
      >
    </section>
    <section class="panel section-gap">
      <div class="toolbar">
        <div class="toolbar-group">
          <h2>成绩明细</h2>
          <span class="subtle-tag">{{ filtered.length }} 人</span><el-input
            v-model="query"
            placeholder="搜索姓名 / 学号"
            clearable
            aria-label="搜索成绩"
          />
        </div>
        <div class="toolbar-group">
          <el-button
            :icon="Plus"
            :disabled="!store.schoolClass.id"
            @click="studentVisible = true"
          >
            添加学生
          </el-button><el-button
            :icon="EditPen"
            :disabled="!store.exam || !store.students.length"
            @click="edit()"
          >
            手动录入
          </el-button><el-button
            :icon="Download"
            :disabled="!store.exam || !store.rows.length"
            @click="download()"
          >
            导出明细
          </el-button>
        </div>
      </div>
      <el-table :data="paged" empty-text="请添加学生并新建考试，或上传成绩文件">
        <el-table-column prop="number" label="学号" width="90" />
        <el-table-column
          prop="name"
          label="姓名"
          width="100"
          fixed
        /><el-table-column prop="gender" label="性别" width="60" /><el-table-column
          v-for="subject in store.exam?.subjects"
          :key="subject.id"
          :label="subject.name"
          min-width="80"
          align="center"
        >
          <template #default="{ row }">
            <span
              :class="
                typeof row.scores[subject.id] === 'number'
                  && row.scores[subject.id] < subject.pass
                  ? 'negative'
                  : ''
              "
            >{{ row.scores[subject.id] ?? "—" }}</span>
          </template>
        </el-table-column><el-table-column label="总分" min-width="80" align="center">
          <template #default="{ row }">
            <strong>{{ row.total ?? "—" }}</strong>
          </template>
        </el-table-column><el-table-column
          prop="average"
          label="平均分"
          min-width="80"
          align="center"
        /><el-table-column
          prop="rank"
          label="班级排名"
          min-width="85"
          align="center"
        /><el-table-column
          prop="gradeRank"
          label="跨班排名"
          min-width="85"
          align="center"
        /><el-table-column label="进退步" min-width="95" align="center">
          <template #default="{ row }">
            <RankChange :value="row.change" />
          </template>
        </el-table-column><el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button text type="primary" @click="edit(row as RankedStudent)">
              录入/修改
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="15"
          :total="filtered.length"
          layout="total, prev, pager, next"
        />
      </div>
      <p class="hint">
        缺考或未录入科目按 0 分计入总分与班级、跨班排名，平均分按本次考试全部学科计算；同分并列。单科仍显示缺考标记。
      </p>
    </section>
    <ExamDialog v-model="examVisible" /><StudentDialog
      v-model="studentVisible"
    /><ScoreDialog v-model="scoreVisible" :student-id="editingId" />
    <el-dialog v-model="previewVisible" title="导入预览" width="850px">
      <el-select v-model="selectedSheet" aria-label="选择工作表">
        <el-option
          v-for="(sheet, i) in sheets"
          :key="sheet.name"
          :label="sheet.name"
          :value="i"
        />
      </el-select>
      <p class="hint section-gap">
        识别 {{ preview?.rows.length }} 位学生 · 学科：{{
          preview?.subjects.join("、")
        }}
        · 缺少的学科列保留原成绩，存在的空白分数将记录为缺考。
        未配置到本次考试的学科列不会导入。
        未填学号时按同班姓名匹配，新学生自动生成内部学号；重名请填写学号。
      </p>
      <el-alert
        v-if="preview?.errors.length"
        type="error"
        title="请修正以下问题后重新上传（未写入任何数据）"
        :closable="false"
      >
        <ul>
          <li v-for="error in preview.errors.slice(0, 20)" :key="error">
            {{ error }}
          </li>
        </ul>
        <p v-if="preview.errors.length > 20">
          另有 {{ preview.errors.length - 20 }} 项错误。
        </p>
      </el-alert><el-table :data="preview?.rows.slice(0, 20)" max-height="360">
        <el-table-column prop="line" label="行" width="55" /><el-table-column
          prop="number"
          label="学号"
          width="90"
        /><el-table-column
          prop="name"
          label="姓名"
          width="100"
        /><el-table-column prop="gender" label="性别" width="60" /><el-table-column
          prop="className"
          label="班级"
          min-width="130"
        /><el-table-column
          v-for="subject in store.exam?.subjects"
          :key="subject.id"
          :label="subject.name"
          width="80"
        >
          <template #default="{ row }">
            {{ row.scores[subject.id] ?? "—" }}
          </template>
        </el-table-column>
      </el-table>
      <p class="hint">
        仅预览前 20 行，确认后导入全部有效记录。
      </p>
      <template #footer>
        <el-button @click="previewVisible = false">
          取消
        </el-button><el-button
          type="primary"
          :disabled="!preview?.rows.length || !!preview?.errors.length"
          @click="confirmImport"
        >
          确认导入 {{ preview?.rows.length }} 条
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.import-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 25px;
  background: #f0f4eb;
  border-color: #dfe8d7;
  padding: 30px;
}
.import-illustration {
  width: 43px;
  height: 43px;
  display: grid;
  place-items: center;
  background: #e2ecdc;
  color: #769768;
  border-radius: 11px;
  font-size: 24px;
  margin-bottom: 18px;
}
.import-panel h2 {
  margin-bottom: 12px;
}
.import-panel p {
  color: #8c9b80;
  font-size: 11px;
  line-height: 1.9;
}
.import-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.import-actions .el-button {
  margin-left: 0;
}
@media (max-width: 650px) {
  .import-panel {
    flex-direction: column;
    align-items: stretch;
    padding: 22px;
  }
  .import-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
