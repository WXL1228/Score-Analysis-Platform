<script lang="ts" setup>
import { ArrowRight, Bell, DataAnalysis, DataLine, Document, EditPen, Files, Reading, Setting, Upload, User, UserFilled } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"

const store = useGradebookStore()
const route = useRoute()
const menuOpen = ref(false)
const nav = [
  { path: "/dashboard", title: "成绩总览", icon: DataAnalysis },
  { path: "/scores", title: "成绩录入", icon: EditPen },
  { path: "/students", title: "学生管理", icon: User },
  { path: "/analysis", title: "学科分析", icon: Reading },
  { path: "/trends", title: "趋势追踪", icon: DataLine },
  { path: "/reports", title: "报告中心", icon: Document }
]
const exams = computed(() => [...store.workspace.exams].sort((a, b) => b.date.localeCompare(a.date)))
const alertCount = computed(() => store.rows.filter(row => row.warnings.length).length)
watch(() => route.path, () => {
  menuOpen.value = false
})
</script>

<template>
  <div class="gradebook-shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <router-link to="/dashboard" class="brand">
        <span class="brand-mark"><el-icon><Reading /></el-icon></span>
        <div><strong>成绩分析平台</strong><small>让每一份成长被看见</small></div>
      </router-link>
      <div class="nav-caption">
        教学工作台 <span>WORKSPACE</span>
      </div>
      <nav aria-label="主导航">
        <router-link v-for="item in nav" :key="item.path" :to="item.path" :class="{ active: route.path === item.path }">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.title }}</span>
          <span v-if="item.path === '/students'" class="nav-count">{{ store.students.length }}</span>
        </router-link>
      </nav>
      <div class="sidebar-bottom">
        <div class="local-card">
          <el-icon><Files /></el-icon><strong>你的专属教学档案</strong><p>数据保存在此浏览器<br>建议定期备份，安心留存</p><router-link to="/settings">
            备份与恢复 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <router-link class="settings-link" to="/settings" :class="{ active: route.path === '/settings' }">
          <el-icon><Setting /></el-icon>班级设置
        </router-link>
        <div class="teacher-avatar">
          <span role="img" aria-label="教师头像"><el-icon :size="18"><UserFilled /></el-icon></span><div><strong>{{ store.workspace.teacher || '教师档案' }}</strong><small>{{ store.workspace.name }}</small></div><router-link to="/settings" aria-label="管理档案">
            <el-icon><Setting /></el-icon>
          </router-link>
        </div>
      </div>
    </aside>
    <button v-if="menuOpen" class="sidebar-mask" aria-label="关闭菜单" @click="menuOpen = false" />
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <button class="mobile-menu" aria-label="打开菜单" @click="menuOpen = !menuOpen">
            ☰
          </button><span>教学工作台</span><el-icon><ArrowRight /></el-icon><strong>{{ route.meta.title }}</strong>
        </div>
        <div class="topbar-actions">
          <span class="save-status" :class="{ error: store.saveError || store.loadError }"><i />{{ store.saveError || store.loadError ? '保存需要处理' : '已自动保存到本机' }}</span><router-link to="/students" class="bell-link" :aria-label="`${alertCount} 位需要关注的学生`">
            <el-icon><Bell /></el-icon><i v-if="alertCount" />
          </router-link><span class="mini-avatar" role="img" aria-label="教师头像"><el-icon :size="18"><UserFilled /></el-icon></span>
        </div>
      </header>
      <main class="workspace-main">
        <el-alert v-if="store.loadError || store.saveError" :title="store.loadError || store.saveError" type="error" :closable="false" show-icon class="storage-alert" />
        <div v-if="store.workspace.demo" class="demo-banner">
          <span>示例档案 · 以下为演示数据，你可以自由体验全部功能。</span><router-link to="/settings">
            新建我的档案 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <div class="page-heading">
          <div>
            <div class="eyebrow">
              QINGHE · GRADEBOOK
            </div><h1>{{ route.meta.title }}</h1><p>用清晰的数据，陪伴每一个学生向前。</p>
          </div><router-link v-if="route.path !== '/scores' && route.path !== '/settings'" to="/scores">
            <el-button type="primary" :icon="Upload">
              导入成绩
            </el-button>
          </router-link>
        </div>
        <div class="context-bar">
          <div class="context-controls">
            <span class="context-label">当前班级</span><el-select v-model="store.workspace.selectedClassId" placeholder="请先添加班级" aria-label="当前班级" class="class-select">
              <el-option v-for="group in store.workspace.classes" :key="group.id" :label="group.name" :value="group.id" />
            </el-select><span class="context-separator" /><span class="context-label">考试</span><el-select v-model="store.workspace.selectedExamId" placeholder="请先新建考试" aria-label="当前考试" class="exam-select">
              <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
            </el-select>
          </div>
          <span class="context-date">{{ store.exam?.date || '暂无考试' }}<span> · {{ store.students.length }} 位学生</span></span>
        </div>
        <el-alert v-if="!store.workspace.classes.length" type="info" :closable="false" show-icon class="storage-alert" title="暂无班级，请先到班级设置中添加班级。">
          <router-link to="/settings" class="text-link">
            去添加班级
          </router-link>
        </el-alert>
        <router-view />
        <footer class="page-footer">
          <span>成绩分析平台 · 记录成绩，更关注成长</span><span>{{ store.savedAt ? `上次保存 ${store.savedAt}` : '浏览器本地存储' }}</span>
        </footer>
      </main>
    </div>
  </div>
</template>
