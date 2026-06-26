let elementsRoot: ParentNode = document;

export function setElementsRoot(root: ParentNode): void {
  elementsRoot = root;
}

function $<T extends Element>(selector: string): T {
  const element = elementsRoot.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export const elements = {
  get brand() { return $<HTMLAnchorElement>('.brand'); },

  get createRoomButton() { return $<HTMLButtonElement>('#createRoomButton'); },
  get deviceMenuButton() { return $<HTMLButtonElement>('#deviceMenuButton'); },
  get devicePopover() { return $<HTMLElement>('#devicePopover'); },
  get dockConnection() { return $<HTMLElement>('#dockConnection'); },
  get dockConnectionLabel() { return $<HTMLElement>('#dockConnectionLabel'); },
  get emptyRoom() { return $<HTMLElement>('#emptyRoom'); },
  get emptyRoomAvatar() { return $<HTMLElement>('#emptyRoomAvatar'); },
  get gateThresholdSlider() { return $<HTMLInputElement>('#gateThresholdSlider'); },
  get gateThresholdValue() { return $<HTMLOutputElement>('#gateThresholdValue'); },
  get guestNameDialog() { return $<HTMLElement>('#guestNameDialog'); },
  get guestNameError() { return $<HTMLElement>('#guestNameError'); },
  get guestNameForm() { return $<HTMLFormElement>('#guestNameForm'); },
  get guestNameInput() { return $<HTMLInputElement>('#guestNameInput'); },
  get joinByCodeButton() { return $<HTMLButtonElement>('#joinByCodeButton'); },
  get leaveButton() { return $<HTMLButtonElement>('#leaveButton'); },
  get micGateMarker() { return $<HTMLElement>('#micGateMarker'); },
  get micLevelFill() { return $<HTMLElement>('#micLevelFill'); },
  get micLevelTrack() { return $<HTMLElement>('#micLevelTrack'); },
  get muteButton() { return $<HTMLButtonElement>('#muteButton'); },
  get muteText() { return $<HTMLElement>('#muteText'); },

  get notFoundScreen() { return $<HTMLElement>('#notFoundScreen'); },
  get outputButton() { return $<HTMLButtonElement>('#outputButton'); },

  get outputMenuButton() { return $<HTMLButtonElement>('#outputMenuButton'); },
  get outputPopover() { return $<HTMLElement>('#outputPopover'); },
  get outputText() { return $<HTMLElement>('#outputText'); },
  get participants() { return $<HTMLElement>('#participants'); },
  get roomCodeInput() { return $<HTMLInputElement>('#roomCodeInput'); },
  get roomCodeText() { return $<HTMLElement>('#roomCodeText'); },
  get roomEmojiBadge() { return $<HTMLElement>('#roomEmojiBadge'); },
  get roomScreen() { return $<HTMLElement>('#roomScreen'); },
  get roomTitle() { return $<HTMLElement>('#roomTitle'); },
  get topbarRoomHeading() { return $<HTMLElement>('.topbar-room-heading'); },
  get missingRoomCode() { return $<HTMLElement>('#missingRoomCode'); },
  get screenButton() { return $<HTMLButtonElement>('#screenButton'); },
  get screenExitButton() { return $<HTMLButtonElement>('#screenExitButton'); },
  get screenFullscreenButton() { return $<HTMLButtonElement>('#screenFullscreenButton'); },
  get screenMeta() { return $<HTMLElement>('#screenMeta'); },
  get screenMetaFps() { return $<HTMLElement>('#screenMetaFps'); },
  get screenMetaQuality() { return $<HTMLElement>('#screenMetaQuality'); },
  get screenMetaSepFps() { return $<HTMLElement>('#screenMetaSepFps'); },
  get screenMetaSepProfile() { return $<HTMLElement>('#screenMetaSepProfile'); },
  get screenMetaSepViewers() { return $<HTMLElement>('#screenMetaSepViewers'); },
  get screenMetaStats() { return $<HTMLElement>('#screenMetaStats'); },
  get screenMetaTitle() { return $<HTMLElement>('#screenMetaTitle'); },
  get screenMetaViewers() { return $<HTMLElement>('#screenMetaViewers'); },
  get screenPlaceholder() { return $<HTMLElement>('#screenPlaceholder'); },
  get screenSourceCloseButton() { return $<HTMLButtonElement>('#screenSourceCloseButton'); },
  get screenSourceDialog() { return $<HTMLElement>('#screenSourceDialog'); },
  get screenSourceOptions() { return $<HTMLElement>('#screenSourceOptions'); },
  get screenStage() { return $<HTMLElement>('#screenStage'); },
  get screenText() { return $<HTMLElement>('#screenText'); },
  get screenVideo() { return $<HTMLVideoElement>('#screenVideo'); },
  get screenViewControls() { return $<HTMLElement>('#screenViewControls'); },
  get soundButton() { return $<HTMLButtonElement>('#soundButton'); },
  get stageStripKicker() { return $<HTMLElement>('#stageStripKicker'); },
  get stageStripSummary() { return $<HTMLElement>('#stageStripSummary'); },
  get startForm() { return $<HTMLFormElement>('#startForm'); },
  get startNameInput() { return $<HTMLInputElement>('#startNameInput'); },
  get startNameStatus() { return $<HTMLElement>('#startNameStatus'); },
  get startScreen() { return $<HTMLElement>('#startScreen'); },
  get statusPill() { return $<HTMLElement>('#statusPill'); },
  get statusText() { return $<HTMLElement>('#statusText'); },
  get tileGrid() { return $<HTMLElement>('#tileGrid'); },
  get streamTiles() { return $<HTMLElement>('#streamTiles'); },
  get streamVolumeControl() { return $<HTMLElement>('#streamVolumeControl'); },
  get streamVolumeButton() { return $<HTMLButtonElement>('#streamVolumeButton'); },
  get streamVolumeSlider() { return $<HTMLInputElement>('#streamVolumeSlider'); },
  get stripToggleButton() { return $<HTMLButtonElement>('#stripToggleButton'); },
  get template() { return $<HTMLTemplateElement>('#participantTemplate'); },
  get toast() { return $<HTMLElement>('#toast'); }
};
