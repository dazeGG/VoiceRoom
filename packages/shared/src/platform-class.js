'use strict';

const PLATFORM_CLASS_CONTRACT = 'voice-room.platform-class/v1';
const PLATFORM_CLASSES = Object.freeze({
  desktop: 'desktop',
  mobile: 'mobile',
  unknown: 'unknown'
});

function normalizedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function classifyPlatform(input = {}) {
  if (input.desktopBridge === true) return PLATFORM_CLASSES.desktop;

  if (typeof input.userAgentDataMobile === 'boolean') {
    return input.userAgentDataMobile ? PLATFORM_CLASSES.mobile : PLATFORM_CLASSES.desktop;
  }

  const userAgent = normalizedString(input.userAgent);
  const platform = normalizedString(input.platform);
  const maxTouchPoints = Number.isFinite(input.maxTouchPoints) ? Number(input.maxTouchPoints) : 0;

  if (/android|iphone|ipod|windows phone|mobile/i.test(userAgent)) return PLATFORM_CLASSES.mobile;
  if (/ipad/i.test(userAgent)) return PLATFORM_CLASSES.mobile;
  if (/^MacIntel$/i.test(platform) && maxTouchPoints > 1) return PLATFORM_CLASSES.mobile;

  if (/windows|macintosh|cros|x11|linux/i.test(userAgent)) return PLATFORM_CLASSES.desktop;
  if (/^win|^mac|^linux/i.test(platform)) return PLATFORM_CLASSES.desktop;
  return PLATFORM_CLASSES.unknown;
}

function platformPolicy(platformClass) {
  const normalized = Object.values(PLATFORM_CLASSES).includes(platformClass)
    ? platformClass
    : PLATFORM_CLASSES.unknown;
  return {
    contractVersion: PLATFORM_CLASS_CONTRACT,
    platformClass: normalized,
    desktopAllowed: normalized !== PLATFORM_CLASSES.mobile
  };
}

function classifyPlatformPolicy(input = {}) {
  return platformPolicy(classifyPlatform(input));
}

module.exports = {
  PLATFORM_CLASS_CONTRACT,
  PLATFORM_CLASSES,
  classifyPlatform,
  classifyPlatformPolicy,
  platformPolicy
};
