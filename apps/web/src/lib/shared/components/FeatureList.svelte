<script lang="ts">
  import './feature-list.css';

  let { items }: { items: { title: string; desc: string }[] } = $props();
</script>

<ul class="feature-list">
  {#each items as item, i}
    <li class="feature">
      <span class="feature-num">{String(i + 1).padStart(2, '0')}</span>
      <div class="feature-body">
        <p class="feature-title">{item.title}</p>
        <p class="feature-desc">{item.desc}</p>
      </div>
    </li>
  {/each}
</ul>
