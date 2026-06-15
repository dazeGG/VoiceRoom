<div class="toast" id="toast" role="status" aria-live="polite"></div>

<div class="screen-source-dialog" id="screenSourceDialog" role="dialog" aria-modal="true" aria-labelledby="screenSourceTitle" hidden>
  <section class="screen-source-panel">
    <div class="screen-source-heading">
      <div>
        <p class="eyebrow">источник</p>
        <h2 id="screenSourceTitle">Что показать</h2>
      </div>
      <button class="screen-source-close" id="screenSourceCloseButton" type="button" aria-label="Отменить выбор" data-icon="close"></button>
    </div>
    <div class="screen-source-options" id="screenSourceOptions"></div>
  </section>
</div>

<template id="participantTemplate">
  <article class="participant" data-peer-id="">
    <div class="participant-screen-meta" hidden></div>
    <div class="voice-ring" aria-hidden="true">
      <span class="avatar"></span>
    </div>
    <div class="participant-copy">
      <h2>
        <span class="participant-name">Участник</span>
        <span class="participant-muted-icon" data-icon="mic-muted" aria-label="Микрофон выключен" title="Микрофон выключен"></span>
        <span class="participant-deafened-icon" data-icon="headphones-muted" aria-label="Звук выключен" title="Звук выключен"></span>
      </h2>
      <p></p>
      <button class="participant-screen-action" type="button" hidden>
        <span data-icon="watch-screen" aria-hidden="true"></span>
        <span>Смотреть экран</span>
      </button>
    </div>
  </article>
</template>
