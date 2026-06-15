<div class="screen-stage" id="screenStage" hidden>
  <video class="screen-video" id="screenVideo" autoplay playsinline></video>
  <div class="screen-placeholder" id="screenPlaceholder">Подключение к экрану</div>
  <div class="screen-meta" id="screenMeta" hidden>
    <span class="screen-meta-live" aria-hidden="true"></span>
    <span class="screen-meta-title" id="screenMetaTitle"></span>
    <span class="screen-meta-sep" id="screenMetaSepProfile" aria-hidden="true">·</span>
    <span class="screen-meta-detail" id="screenMetaQuality"></span>
    <span class="screen-meta-sep" id="screenMetaSepFps" aria-hidden="true">·</span>
    <span class="screen-meta-detail" id="screenMetaFps"></span>
    <span class="screen-meta-sep" id="screenMetaSepViewers" aria-hidden="true">·</span>
    <span class="screen-meta-detail screen-meta-viewers" id="screenMetaViewers"></span>
    <span class="screen-meta-detail screen-meta-stats" id="screenMetaStats" hidden></span>
  </div>
  <div class="screen-view-controls" id="screenViewControls" hidden>
    <div class="stream-volume-control" id="streamVolumeControl">
      <button class="screen-control-button stream-volume-button" id="streamVolumeButton" type="button" aria-label="Выключить звук стрима" aria-pressed="false">
        <span class="stream-volume-icon stream-volume-icon-on" data-icon="volume-on" aria-hidden="true"></span>
        <span class="stream-volume-icon stream-volume-icon-off" data-icon="volume-off" aria-hidden="true"></span>
      </button>
      <div class="stream-volume-popover" id="streamVolumePopover">
        <input class="stream-volume-slider" id="streamVolumeSlider" type="range" min="0" max="200" value="50" aria-label="Громкость стрима">
      </div>
    </div>

    <button class="screen-control-button screen-fullscreen-button" id="screenFullscreenButton" type="button" aria-label="Открыть стрим на весь экран" aria-pressed="false">
      <span class="screen-fullscreen-icon screen-fullscreen-icon-enter" data-icon="fullscreen-enter" aria-hidden="true"></span>
      <span class="screen-fullscreen-icon screen-fullscreen-icon-exit" data-icon="fullscreen-exit" aria-hidden="true"></span>
    </button>
  </div>
</div>
