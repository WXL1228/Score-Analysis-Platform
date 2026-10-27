<script lang="ts" setup>
import type { ClassInitialization, ImportPreview, Subject } from "../types"
import { Upload } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { inferSubjects, parseClassScoreMatrix, readScoreFile } from "../files"
import { validateSubjects } from "../validation"

const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const className = ref("")
const examName = ref("")
const examDate = ref("")
const fileName = ref("")
const fileError = ref("")
const isLoading = ref(false)
const setDefaultSubjects = ref(true)
const sheets = ref<{ name: string, matrix: unknown[][] }[]>([])
const selectedSheet = ref(0)
const subjectDraft = ref<(Subject & { enabled: boolean })[]>([])
const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
let readRequest = 0
let workspaceId = ""
const subjects = computed<Subject[]>(() => subjectDraft.value.filter(subject => subject.enabled).map(subject => ({ id: subject.id, name: subject.name, max: subject.max, pass: subject.pass, excellent: subject.excellent })))
const preview = computed<ImportPreview>(() => {
  const errors: string[] = []
  if (fileError.value) errors.push(fileError.value)
  if (!className.value.trim()) errors.push("请先填写班级名称")
  const subjectError = validateSubjects(subjects.value)
  if (subjectError) errors.push(subjectError)
  const sheet = sheets.value[selectedSheet.value]
  if (!sheet) errors.push("请上传可读取的成绩单")
  if (errors.length) return { rows: [], errors, subjects: subjects.value.map(subject => subject.name) }
  return parseClassScoreMatrix(sheet.matrix, subjects.value, className.value)
})
watch(visible, (value) => {
  readRequest++
  isLoading.value = false
  if (!value) return
  workspaceId = store.workspace.id
  className.value = ""
  examName.value = "首次考试"
  examDate.value = new Date().toLocaleDateString("sv-SE")
  fileName.value = ""
  fileError.value = ""
  sheets.value = []
  selectedSheet.value = 0
  subjectDraft.value = []
  setDefaultSubjects.value = true
})
function detectSubjects() {
  const sheet = sheets.value[selectedSheet.value]
  subjectDraft.value = sheet ? inferSubjects(sheet.matrix, store.workspace.subjects).map(subject => ({ ...subject, enabled: true })) : []
}
watch(selectedSheet, detectSubjects)
async function pickFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const request = ++readRequest
  fileName.value = file.name
  fileError.value = ""
  isLoading.value = true
  try {
    const loaded = await readScoreFile(file)
    if (request !== readRequest) return
    sheets.value = loaded
    selectedSheet.value = 0
    detectSubjects()
    if (examName.value === "首次考试") examName.value = file.name.replace(/\.(xlsx|csv)$/i, "").slice(0, 40)
  } catch (error) {
    if (request !== readRequest) return
    fileError.value = `读取失败：${(error as Error).message}`
    sheets.value = []
    subjectDraft.value = []
  } finally {
    if (request === readRequest) isLoading.value = false
    if (fileInput.value) fileInput.value.value = ""
  }
}
function removeFile() {
  readRequest++
  fileName.value = ""
  fileError.value = ""
  sheets.value = []
  subjectDraft.value = []
  isLoading.value = false
}
function submit() {
  if (workspaceId !== store.workspace.id) return ElMessage.error("档案已切换，请重新打开新建班级窗口")
  if (!className.value.trim()) return ElMessage.error("请输入班级名称")
  const input: ClassInitialization = { name: className.value, rows: [], setDefaultSubjects: false }
  if (fileName.value) {
    if (isLoading.value || preview.value.errors.length || !preview.value.rows.length) return ElMessage.error("请修正成绩单问题后再创建班级")
    if (!examName.value.trim() || !examDate.value) return ElMessage.error("请填写考试名称和日期")
    input.exam = { name: examName.value, date: examDate.value, subjects: subjects.value }
    input.rows = preview.value.rows
    input.setDefaultSubjects = setDefaultSubjects.value
  }
  try {
    store.initializeClass(input)
    visible.value = false
    ElMessage.success(input.exam ? `班级已创建，已初始化 ${input.rows.length} 位学生、${subjects.value.length} 门学科和首次考试成绩` : "空白班级已创建")
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建班级与成绩初始化" width="900px">
    <el-form label-position="top">
      <el-form-item label="班级名称（必填）">
        <el-input v-model="className" placeholder="例如：八年级（3）班" maxlength="40" />
      </el-form-item>
      <div class="upload-actions">
        <el-button :icon="Upload" :loading="isLoading" @click="fileInput?.click()">
          上传成绩单（可选）
        </el-button><span class="hint">{{ fileName || '支持 .xlsx / UTF-8 CSV，不上传则创建空白班级' }}</span><el-button v-if="fileName" text :disabled="isLoading" @click="removeFile">
          移除文件
        </el-button>
      </div>
      <input ref="fileInput" type="file" accept=".xlsx,.csv" hidden @change="pickFile">
      <p class="hint section-gap">
        支持「序号、姓名、性别、各科成绩」格式。序号仅用于排序，学号可选；无学号时自动生成内部编号，同班重名须填写学号。底部平均分行自动跳过；单个工作表须只包含一个班级。
      </p>
      <template v-if="fileName">
        <el-form-item v-if="sheets.length" label="工作表" class="section-gap">
          <el-select v-model="selectedSheet" aria-label="初始化工作表" :disabled="isLoading">
            <el-option v-for="(sheet, index) in sheets" :key="sheet.name" :label="sheet.name" :value="index" />
          </el-select>
        </el-form-item>
        <div class="form-grid section-gap">
          <el-form-item label="首次考试名称（必填）">
            <el-input v-model="examName" maxlength="40" />
          </el-form-item><el-form-item label="首次考试日期（必填）">
            <el-date-picker v-model="examDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
        </div>
        <h2>识别的学科与分数线</h2><p class="hint">
          可取消非学科列。同名科目沿用现有配置；新学科未标满分时默认 100 分、及格 60 分、优秀 85 分。可识别「数学（150分）」等表头，分数线可在下方调整。
        </p>
        <el-table :data="subjectDraft" max-height="290">
          <el-table-column label="导入" width="65">
            <template #default="{ row }">
              <el-checkbox v-model="row.enabled" :aria-label="`导入学科 ${row.name}`" />
            </template>
          </el-table-column><el-table-column prop="name" label="学科" min-width="100" /><el-table-column label="满分" min-width="155">
            <template #default="{ row }">
              <el-input-number v-model="row.max" :min="1" :max="10000" :precision="1" controls-position="right" :disabled="!row.enabled" :aria-label="`${row.name}满分`" />
            </template>
          </el-table-column><el-table-column label="及格分" min-width="155">
            <template #default="{ row }">
              <el-input-number v-model="row.pass" :min="0" :max="row.max" :precision="1" controls-position="right" :disabled="!row.enabled" :aria-label="`${row.name}及格分`" />
            </template>
          </el-table-column><el-table-column label="优秀分" min-width="155">
            <template #default="{ row }">
              <el-input-number v-model="row.excellent" :min="0" :max="row.max" :precision="1" controls-position="right" :disabled="!row.enabled" :aria-label="`${row.name}优秀分`" />
            </template>
          </el-table-column>
        </el-table>
        <el-checkbox v-model="setDefaultSubjects" class="section-gap">
          同步到当前档案学科设置
        </el-checkbox><p class="hint">
          勾选后，班级设置会更新为本次选中的科目，并同步已有考试中同学科的满分、及格分和优秀分；已有成绩数值保留。
        </p>
        <el-alert v-if="!isLoading && preview.errors.length" type="error" title="请修正以下问题，当前尚未创建任何数据" :closable="false" class="section-gap">
          <ul>
            <li v-for="error in preview.errors.slice(0, 10)" :key="error">
              {{ error }}
            </li>
          </ul><span v-if="preview.errors.length > 10">另有 {{ preview.errors.length - 10 }} 项错误</span>
        </el-alert>
        <div class="panel-heading section-gap">
          <h2>学生与成绩预览</h2><span class="subtle-tag">{{ preview.rows.length }} 位学生 · {{ subjects.length }} 门学科</span>
        </div>
        <el-table :data="preview.rows.slice(0, 20)" max-height="320">
          <el-table-column prop="number" label="学号" width="90" /><el-table-column prop="name" label="姓名" width="100" /><el-table-column prop="gender" label="性别" width="60" /><el-table-column v-for="subject in subjects" :key="subject.id" :label="subject.name" min-width="80">
            <template #default="{ row }">
              {{ row.scores[subject.id] ?? '缺考' }}
            </template>
          </el-table-column>
        </el-table><p class="hint">
          仅预览前 20 行，确认后导入全部记录。空白分数保留缺考标记，按 0 分计入总分与排名。
        </p>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button><el-button type="primary" :disabled="isLoading || (!!fileName && !!preview.errors.length)" @click="submit">
        {{ fileName ? '创建班级并导入成绩' : '创建空白班级' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.upload-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
