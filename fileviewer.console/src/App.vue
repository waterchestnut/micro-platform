<script setup lang="ts">
import { isEmbedded } from '@/utils/embed'
</script>

<template>
  <div :class="['app-container', { 'is-embedded': isEmbedded() }]">
    <router-view />
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-container.is-embedded {
  height: calc(100vh - 64px);
}
</style>
