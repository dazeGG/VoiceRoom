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

<style>
  :global(.feature-list) {
    list-style: none;
    margin: 44px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 500px;
  }
  :global(.feature) {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  :global(.feature-num) {
    flex: none;
    width: 20px;
    padding-top: 2px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--feature-num-ink, var(--warm-650));
  }
  :global(.feature-title) {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--feature-title-ink, var(--warm-150));
    letter-spacing: -0.01em;
  }
  :global(.feature-desc) {
    margin: 3px 0 0;
    font-size: 14px;
    color: var(--feature-desc-ink, var(--warm-560));
    line-height: 1.5;
  }
</style>
