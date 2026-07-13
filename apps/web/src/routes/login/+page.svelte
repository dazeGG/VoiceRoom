<script lang="ts">
  import HomePage from '$lib/features/home/HomePage.svelte';
</script>

<svelte:head>
  <title>Вход · Voice Room</title>
  <meta name="theme-color" content="#10110f">
</svelte:head>

<HomePage initialAuthMode="login" />
