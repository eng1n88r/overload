<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const props = defineProps<{ text: string }>();

const html = computed(() => DOMPurify.sanitize(marked.parse(props.text, { async: false }) as string));
</script>
<template>
  <div class="md-text" v-html="html"></div>
</template>
<style scoped>
/* Notes render inside cards/alerts — keep the type scale compact. */
.md-text :deep(h1),
.md-text :deep(h2),
.md-text :deep(h3),
.md-text :deep(h4) {
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0.75rem 0 0.35rem;
}
.md-text :deep(h1:first-child),
.md-text :deep(h2:first-child),
.md-text :deep(h3:first-child) {
  margin-top: 0;
}
.md-text :deep(p) {
  margin-bottom: 0.5rem;
}
.md-text :deep(ul),
.md-text :deep(ol) {
  margin-bottom: 0.5rem;
  padding-left: 1.25rem;
}
.md-text :deep(li) {
  margin-bottom: 0.1rem;
}
.md-text :deep(> :last-child) {
  margin-bottom: 0;
}
.md-text :deep(code) {
  font-size: 0.85em;
}
.md-text :deep(table) {
  width: 100%;
  margin-bottom: 0.5rem;
}
.md-text :deep(th),
.md-text :deep(td) {
  padding: 0.15rem 0.5rem 0.15rem 0;
  text-align: left;
  border-bottom: 1px solid rgba(var(--bs-body-color-rgb), 0.15);
}
</style>
