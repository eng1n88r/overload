<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useAppOptionStore } from '@/stores/app-option';
import { useProgress, type ProgressFinisher } from '@marcoschulte/vue3-progress';
import AppSidebar from '@/components/app/Sidebar.vue';
import AppHeader from '@/components/app/Header.vue';
import { useTheme } from '@/composables/theme';
import router from './router';

const appOption = useAppOptionStore();
const theme = useTheme();

onMounted(() => theme.restoreTheme());

const progresses = [] as ProgressFinisher[];

router.beforeEach(async () => {
	progresses.push(useProgress().start());
	appOption.appSidebarMobileToggled = false;
	appOption.appSidebarToggled = false;
	document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  
  const targetElm = Array.prototype.slice.call(document.querySelectorAll('.app-sidebar .menu-submenu')) as HTMLElement[];
  targetElm.map(function(elm) {
  	elm.style.display = '';
  });
})
router.afterEach(async () => {
	progresses.pop()?.finish();
})

document.querySelector('body')!.classList.add('app-init');
</script>

<template>
	<div class="app" v-bind:class="{
		'app-sidebar-toggled': appOption.appSidebarToggled && !appOption.appSidebarCollapsed,
		'app-sidebar-collapsed': appOption.appSidebarCollapsed,
		'app-sidebar-mobile-toggled': appOption.appSidebarMobileToggled,
		'app-content-full-width': appOption.appSidebarHide,
		'app-without-sidebar': appOption.appSidebarHide,
		'app-without-header': appOption.appHeaderHide,
	}">
		<vue3-progress-bar />
		<app-header v-if="!appOption.appHeaderHide" />
		<app-sidebar v-if="!appOption.appSidebarHide" />
		<div class="app-content" v-bind:class="appOption.appContentClass">
			<router-view></router-view>
		</div>
	</div>
</template>
