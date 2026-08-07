<script setup lang="ts">
import { useAppOptionStore } from '@/stores/app-option';
import { useAuthStore } from '@/stores/auth';
import { RouterLink, useRouter } from 'vue-router';
import ColorModeSwitch from '@/components/app/ColorModeSwitch.vue';
import ThemeColorPicker from '@/components/app/ThemeColorPicker.vue';

const appOption = useAppOptionStore();
const auth = useAuthStore();
const router = useRouter();

async function logout() {
	await auth.logout();
	router.push('/login');
}

function toggleAppSidebarCollapsed() {
	if (!appOption.appSidebarHide) {
		if (appOption.appSidebarCollapsed) {
			appOption.appSidebarToggled = !appOption.appSidebarToggled;
		} else if (appOption.appSidebarToggled) {
			appOption.appSidebarToggled = !appOption.appSidebarToggled;
		}
		appOption.appSidebarCollapsed = !appOption.appSidebarCollapsed;
	}
}
function toggleAppSidebarMobileToggled() {
	appOption.appSidebarMobileToggled = !appOption.appSidebarMobileToggled;
}
</script>
<template>
	<div id="header" class="app-header">
		<!-- BEGIN desktop-toggler -->
		<div class="desktop-toggler">
			<button type="button" class="menu-toggler" v-on:click="toggleAppSidebarCollapsed">
				<span class="bar"></span>
				<span class="bar"></span>
				<span class="bar"></span>
			</button>
		</div>
		<!-- BEGIN desktop-toggler -->
		
		<!-- BEGIN mobile-toggler -->
		<div class="mobile-toggler">
			<button type="button" class="menu-toggler" v-on:click="toggleAppSidebarMobileToggled">
				<span class="bar"></span>
				<span class="bar"></span>
				<span class="bar"></span>
			</button>
		</div>
		<!-- END mobile-toggler -->
		
		<!-- BEGIN brand -->
		<div class="brand">
			<RouterLink to="/" class="brand-logo">
				<span class="brand-img">
					<i class="ti ti-barbell text-theme"></i>
				</span>
				<span class="brand-text">OVERLOAD</span>
			</RouterLink>
		</div>
		<!-- END brand -->
		
		<!-- BEGIN menu -->
		<div class="menu">
			<color-mode-switch />
			<theme-color-picker />
			<div class="menu-item dropdown dropdown-mobile-full">
				<a href="#" data-bs-toggle="dropdown" data-bs-display="static" class="menu-link">
					<div class="menu-img online">
						<img v-if="auth.user?.avatar" :src="auth.user.avatar" class="w-100 h-100 rounded-circle object-fit-cover" alt="avatar" />
						<div v-else class="d-flex align-items-center justify-content-center w-100 h-100 bg-inverse bg-opacity-25 text-inverse text-opacity-50 rounded-circle overflow-hidden">
							<i class="ti ti-user-circle fs-32px mb-n3"></i>
						</div>
					</div>
					<div class="menu-text d-sm-block d-none w-auto text-truncate" style="max-width: 280px">{{ auth.user?.email ?? '' }}</div>
				</a>
				<div class="dropdown-menu dropdown-menu-end me-lg-3 mt-1">
					<RouterLink to="/settings" class="dropdown-item d-flex align-items-center">SETTINGS <i class="ti ti-adjustments ms-auto text-theme fs-16px my-n1"></i></RouterLink>
					<div class="dropdown-divider"></div>
					<a href="#" @click.prevent="logout" class="dropdown-item d-flex align-items-center">LOGOUT <i class="ti ti-logout ms-auto text-theme fs-16px my-n1"></i></a>
				</div>
			</div>
		</div>
		<!-- END menu -->
		
	</div>
</template>
