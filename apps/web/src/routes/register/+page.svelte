<script lang="ts">
  import HomePage from '$lib/features/home/HomePage.svelte';
</script>

<svelte:head>
  <title>Регистрация · VoiceRoom</title>
  <meta name="theme-color" content="#131416" />
</svelte:head>

<HomePage initialAuthMode="register" />
