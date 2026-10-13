<script lang="ts" setup>
const { value } = defineProps<{ value: number | null }>()
</script>

<template>
  <span class="rank-change" :class="value === null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative'">
    {{ value === null ? '暂无对比' : value === 0 ? '— 持平' : value > 0 ? `↑ ${value} 名` : `↓ ${-value} 名` }}
  </span>
</template>
