<div class="toast" id="toast" role="status" aria-live="polite"></div>

<div class="guest-name-dialog" id="guestNameDialog" role="dialog" aria-modal="true" aria-labelledby="guestNameTitle" hidden>
  <section class="guest-name-panel">
    <div class="guest-name-heading">
      <p class="eyebrow">вход в комнату</p>
      <h2 id="guestNameTitle">Как вас зовут?</h2>
      <p>Имя будет видно участникам этой голосовой комнаты.</p>
    </div>

    <form class="guest-name-form" id="guestNameForm">
      <label class="field" for="guestNameInput">
        <span>Ваше имя</span>
        <input id="guestNameInput" maxlength="40" autocomplete="name" placeholder="Ваше имя">
      </label>
      <p class="guest-name-error" id="guestNameError" role="alert" aria-live="polite"></p>
      <button class="primary-button" id="guestNameSubmitButton" type="submit">Войти в комнату</button>
    </form>
  </section>
</div>

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
