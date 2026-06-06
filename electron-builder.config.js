'use strict';

module.exports = {
  appId: 'ru.dazinho.voiceroom',
  productName: 'Voice Room',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'dist'
  },
  files: [
    'electron/main.js',
    'electron/preload.js',
    'electron/runtime-config.json',
    'package.json'
  ],
  mac: {
    category: 'public.app-category.social-networking',
    hardenedRuntime: false,
    icon: 'assets/logo/icon.icns',
    identity: null,
    target: [
      {
        target: 'dmg',
        arch: ['arm64', 'x64']
      }
    ],
    extendInfo: {
      NSMicrophoneUsageDescription: 'Voice Room использует микрофон для голосового чата.',
      NSScreenCaptureDescription: 'Voice Room использует запись экрана для демонстрации экрана участникам комнаты.',
      NSAudioCaptureUsageDescription: 'Voice Room использует системный звук во время демонстрации экрана, если он доступен.',
      NSCameraUsageDescription: 'Voice Room не использует камеру, но системный WebRTC-диалог может запросить это разрешение.'
    }
  },
  win: {
    icon: 'assets/logo/icon.ico',
    target: [
      {
        target: 'portable',
        arch: ['x64']
      }
    ]
  }
};
