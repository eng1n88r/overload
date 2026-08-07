<script lang="ts">
import { Tooltip } from 'bootstrap';
import { defineComponent } from 'vue';

export default defineComponent({
	mounted() {
		// expand
		(this.$refs.toggler as HTMLElement).onclick = function(e: MouseEvent) {
			e.preventDefault();

			const target = (this as HTMLElement).closest('.card') as HTMLElement;
			const targetClass = 'card-expand';

			if (document.body.classList.contains(targetClass) && target.classList.contains(targetClass)) {
				target.removeAttribute('style');
				target.classList.remove(targetClass);
				document.body.classList.remove(targetClass);
			} else {
				document.body.classList.add(targetClass);
				target.classList.add(targetClass);
			}

			window.dispatchEvent(new Event('resize'));
		};

		new Tooltip(this.$refs.toggler as HTMLElement, {
			title: 'Expand / Compress',
			placement: 'bottom',
			trigger: 'hover',
			container: 'body'
		});
	}
})
</script>
<template>
	<a href="#" data-toggle="card-expand" ref="toggler" class="text-white text-opacity-50 text-decoration-none"><i class="ti ti-arrows-maximize"></i></a>
</template>
