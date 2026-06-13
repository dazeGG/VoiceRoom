<div class="stage-strip" id="stageStrip" aria-label="Плитки комнаты">
  <div class="stage-strip-bar" hidden>
    <div class="stage-strip-title">
      <span class="stage-strip-kicker" id="stageStripKicker">В комнате</span>
      <strong id="stageStripSummary">0 участников</strong>
    </div>
    <button class="strip-toggle-button" id="stripToggleButton" type="button" aria-label="Свернуть пользователей" aria-pressed="false" data-icon="chevron-down" hidden></button>
  </div>

  <div class="tile-grid" id="tileGrid" data-count="0">
    <div class="stream-tiles" id="streamTiles" hidden></div>
    <div class="participants" id="participants" data-count="0" aria-live="polite"></div>

    <div class="empty-room" id="emptyRoom">
      <span class="empty-orbit" aria-hidden="true"></span>
      <p>Здесь пока тихо</p>
    </div>
  </div>
</div>
