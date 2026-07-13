<script lang="ts">
  import type { MascotIconProps } from './types';

  let { variant = 'blink', size = 44, class: className = '' }: MascotIconProps = $props();

  const uid = $props.id();
  const maskId = `mascot-band-${uid}`;
</script>

<svg
  class="mascot-icon mascot-icon--{variant} {className}"
  viewBox="0 0 100 100"
  width={size}
  height={size}
  aria-hidden="true"
>
  <defs>
    <mask id={maskId}>
      <rect width="100" height="100" fill="white" />
      <rect x="10" y="44" width="80" height="22" fill="black" />
    </mask>
  </defs>

  {#if variant === 'scare'}
    <g class="mascot-scare">
      <path
        class="mascot-head"
        mask="url(#{maskId})"
        d="M20 38 L20 10 L41 29 L59 29 L80 10 L80 38 Q85 46 85 56 Q85 86 50 86 Q15 86 15 56 Q15 46 20 38 Z"
      />
      <g class="mascot-eyes-fade">
        <circle cx="38" cy="55" r="6.5" class="mascot-eye" />
        <circle cx="62" cy="55" r="6.5" class="mascot-eye" />
      </g>
      <g class="mascot-x-fade">
        <path d="M32.5 49.5 L43.5 60.5 M43.5 49.5 L32.5 60.5" />
        <path d="M56.5 49.5 L67.5 60.5 M67.5 49.5 L56.5 60.5" />
      </g>
    </g>
  {:else}
    <path
      class="mascot-head"
      mask="url(#{maskId})"
      d="M20 38 L20 10 L41 29 L59 29 L80 10 L80 38 Q85 46 85 56 Q85 86 50 86 Q15 86 15 56 Q15 46 20 38 Z"
    />
    <g class="mascot-eyes">
      <circle cx="38" cy="55" r="6.5" class="mascot-eye" />
      <circle cx="62" cy="55" r="6.5" class="mascot-eye" />
    </g>
  {/if}
</svg>

<style>
  .mascot-head {
    fill: var(--accent);
  }

  .mascot-eye {
    fill: var(--accent);
  }

  .mascot-icon--blink .mascot-eyes {
    transform-origin: 50px 55px;
    animation: mascot-blink 4.2s ease-in-out infinite;
  }

  .mascot-icon--look .mascot-eyes {
    animation: mascot-look 5.5s ease-in-out infinite;
  }

  @keyframes mascot-blink {
    0%, 91%, 100% { transform: scaleY(1); }
    94%, 96% { transform: scaleY(0.12); }
  }

  @keyframes mascot-look {
    0%, 22% { transform: translateX(0); }
    32%, 52% { transform: translateX(7px); }
    62%, 84% { transform: translateX(-7px); }
    94%, 100% { transform: translateX(0); }
  }

  .mascot-icon--scare {
    cursor: pointer;
  }

  .mascot-scare {
    transform-origin: 50px 60px;
    animation: mascot-scare 1.8s ease-out forwards;
  }

  .mascot-eyes-fade {
    animation: mascot-eyes-out 1.8s linear forwards;
  }

  .mascot-x-fade {
    opacity: 0;
    fill: none;
    stroke: var(--accent);
    stroke-width: 4;
    stroke-linecap: round;
    animation: mascot-x-in 1.8s linear forwards;
  }

  /* Hovering replays the scare: swap to identically-defined "-replay" keyframes,
     since re-triggering the same forwards animation name is a no-op in CSS. */
  .mascot-icon--scare:hover .mascot-scare { animation-name: mascot-scare-replay; }
  .mascot-icon--scare:hover .mascot-eyes-fade { animation-name: mascot-eyes-out-replay; }
  .mascot-icon--scare:hover .mascot-x-fade { animation-name: mascot-x-in-replay; }

  @keyframes mascot-scare {
    0% { transform: none; }
    8% { transform: translateY(-5px); }
    14% { transform: translate(-2.5px, 0); }
    20% { transform: translate(2.5px, 0); }
    26% { transform: translate(-1.5px, 0); }
    32%, 55% { transform: none; }
    70%, 100% { transform: translateY(2px) rotate(-2deg); }
  }
  @keyframes mascot-scare-replay {
    0% { transform: none; }
    8% { transform: translateY(-5px); }
    14% { transform: translate(-2.5px, 0); }
    20% { transform: translate(2.5px, 0); }
    26% { transform: translate(-1.5px, 0); }
    32%, 55% { transform: none; }
    70%, 100% { transform: translateY(2px) rotate(-2deg); }
  }

  @keyframes mascot-eyes-out {
    0%, 45% { opacity: 1; }
    52%, 100% { opacity: 0; }
  }
  @keyframes mascot-eyes-out-replay {
    0%, 45% { opacity: 1; }
    52%, 100% { opacity: 0; }
  }

  @keyframes mascot-x-in {
    0%, 52% { opacity: 0; }
    60%, 100% { opacity: 1; }
  }
  @keyframes mascot-x-in-replay {
    0%, 52% { opacity: 0; }
    60%, 100% { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .mascot-eyes,
    .mascot-scare,
    .mascot-eyes-fade {
      animation: none !important;
    }
    .mascot-eyes-fade {
      opacity: 0 !important;
    }
    .mascot-x-fade {
      animation: none !important;
      opacity: 1 !important;
    }
  }
</style>
