<script lang="ts">
  import FeatureList from '$lib/shared/components/FeatureList.svelte';
  import { START_FEATURES } from '$lib/features/shared-content/start-features';
</script>

<section class="start-copy" aria-labelledby="startTitle">
  <h1 class="hero-title" id="startTitle">Голосовая комната без лишних дверей</h1>
  <p class="hero-lead">Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.</p>

  <FeatureList items={START_FEATURES} />
</section>
