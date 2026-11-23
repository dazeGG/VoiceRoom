// Call phrases used by the portable views and their browser controls. Russian uses the source phrase.
export const callMessages = new Map<string, { en: string; fr: string }>([
  ['{p0} мс', { en: '{p0} ms', fr: '{p0} ms' }],
  [
    '{p0}: вы в комнате без микрофона',
    { en: '{p0}: you are in a room without a microphone', fr: '{p0} : vous êtes dans un salon sans micro' }
  ],
  [
    '{p0}. Откройте контекстное меню Shift+F10 или клавишей меню.',
    {
      en: '{p0}. Open the context menu Shift+F10 or the menu key.',
      fr: '{p0}. Ouvrez le menu contextuel Maj+F10 ou la touche menu.'
    }
  ],
  ['0 участников', { en: '0 participants', fr: '0 participant' }],
  ['большая задержка', { en: 'long delay', fr: 'long délai' }],
  [
    'Браузер заблокировал воспроизведение звука',
    { en: 'The browser has blocked sound playback', fr: 'Le navigateur a bloqué la lecture du son' }
  ],
  [
    'Браузер не отдал видео экрана',
    { en: 'Browser did not show screen video', fr: "Le navigateur n'a pas affiché la vidéo à l'écran" }
  ],
  [
    'В голосах собеседников слышны разрывы, оценка по самому звуку, а не по пингу',
    {
      en: 'There are gaps in the voices of the interlocutors, the assessment is based on the sound itself, and not on the ping',
      fr: "Il y a des trous dans les voix des interlocuteurs, l'évaluation se base sur le son lui-même, et non sur le ping"
    }
  ],
  ['В комнате', { en: 'In the room', fr: 'Dans le salon' }],
  [
    'В режиме Push-to-talk удерживайте назначенную клавишу',
    {
      en: 'In Push-to-talk mode, hold the assigned key',
      fr: 'En mode Push-to-talk, maintenez la touche attribuée enfoncée'
    }
  ],
  ['вас плохо слышно', { en: 'it’s hard to hear you', fr: "c'est difficile de t'entendre" }],
  ['ваш', { en: 'yours', fr: 'le vôtre' }],
  ['Ваш стрим', { en: 'Your stream', fr: 'Votre flux' }],
  ['Введите имя', { en: 'Enter name', fr: 'Entrez le nom' }],
  [
    'Введите имя, чтобы войти в комнату',
    { en: 'Enter your name to enter the room', fr: 'Entrez votre nom pour entrer dans le salon' }
  ],
  ['Включить звук', { en: 'Unmute', fr: 'Activer le son' }],
  ['Включить звук стрима', { en: 'Unmute stream', fr: 'Activer le flux' }],
  ['Включить камеру', { en: 'Turn on camera', fr: 'Activer la caméra' }],
  ['Включить микрофон', { en: 'Turn on microphone', fr: 'Activer le microphone' }],
  ['вы', { en: 'you', fr: 'toi' }],
  [
    'Выбор динамика недоступен в этой среде',
    {
      en: 'Speaker selection is not available in this environment',
      fr: "La sélection des enceintes n'est pas disponible dans cet environnement"
    }
  ],
  ['Выбрать динамик', { en: 'Select speaker', fr: 'Sélectionnez le haut-parleur' }],
  ['Выбрать камеру', { en: 'Select camera', fr: 'Sélectionnez la caméra' }],
  ['Выбрать микрофон', { en: 'Select microphone', fr: 'Sélectionnez le microphone' }],
  ['Выйти из полноэкранного режима', { en: 'Exit full screen mode', fr: 'Quitter le mode plein écran' }],
  ['Выйти со стрима', { en: 'Leave stream', fr: 'Quitter le flux' }],
  ['Выкл', { en: 'Off', fr: 'Désactivé' }],
  ['Выключить звук', { en: 'Mute', fr: 'Muet' }],
  ['Выключить звук стрима', { en: 'Mute stream', fr: 'Flux muet' }],
  ['Выключить камеру', { en: 'Turn off camera', fr: 'Éteignez la caméra' }],
  ['Выключить микрофон', { en: 'Mute microphone', fr: 'Microphone muet' }],
  ['Гейт', { en: 'Gate', fr: 'Porte' }],
  ['Гейт выключен', { en: 'Gate off', fr: 'Porte fermée' }],
  ['Гейт: {p0} dB', { en: 'Gate: {p0} dB', fr: 'Seuil : {p0} dB' }],
  [
    'Голос доходит с заметной задержкой: пинг, буфер воспроизведения и кодек вместе дают больше 400 мс',
    {
      en: 'The voice arrives with a noticeable delay: ping, playback buffer and codec together give more than 400 ms',
      fr: 'La voix arrive avec un retard notable : le ping, le tampon de lecture et le codec donnent ensemble plus de 400 ms'
    }
  ],
  ['Голос нестабилен', { en: 'Voice is unstable', fr: 'La voix est instable' }],
  ['Голос подключен', { en: 'Voice connected', fr: 'Voix connectée' }],
  ['Голос потерян', { en: 'Voice lost', fr: 'Voix perdue' }],
  ['Голосовая комната', { en: 'Voice room', fr: 'Salon vocal' }],
  ['Голосовой канал LiveKit подключен', { en: 'LiveKit voice channel connected', fr: 'Canal vocal LiveKit connecté' }],
  ['Гость', { en: 'Guest', fr: 'Invité' }],
  ['готово', { en: 'ready', fr: 'prêt' }],
  ['Громкость микрофона', { en: 'Microphone volume', fr: 'Volume du microphone' }],
  ['Громкость стрима', { en: 'Stream volume', fr: 'Volume du flux' }],
  ['Демонстрация остановлена', { en: 'Demonstration stopped', fr: 'Manifestation arrêtée' }],
  ['Демонстрация отменена', { en: 'Demonstration cancelled.', fr: 'Manifestation annulée.' }],
  ['Демонстрация уже завершена', { en: 'Demo now completed', fr: 'Démo maintenant terminée' }],
  ['джиттер {p0} мс', { en: 'jitter {p0} ms', fr: 'gigue {p0} ms' }],
  ['Динамик', { en: 'Speaker', fr: 'Haut-parleur' }],
  [
    'Динамик недоступен, звук идёт через системный',
    {
      en: 'The speaker is unavailable, the sound comes through the system',
      fr: 'Le haut-parleur est indisponible, le son passe par le système'
    }
  ],
  ['Динамик переключен', { en: 'Speaker switched', fr: 'Haut-parleur commuté' }],
  ['Другой камеры нет', { en: 'No other camera', fr: 'Aucune autre caméra' }],
  ['Закончить стрим', { en: 'End stream', fr: 'Fin du flux' }],
  ['Закрыть просмотр экрана', { en: 'Close screen viewing', fr: "Fermer l'affichage de l'écran" }],
  ['Звук заблокирован', { en: 'Sound blocked', fr: 'Son bloqué' }],
  ['Звук стрима пропал', { en: 'The stream sound disappeared', fr: 'Le son du flux a disparu' }],
  ['Имя сохранено', { en: 'Name saved', fr: 'Nom enregistré' }],
  ['Камера', { en: 'Camera', fr: 'Caméra' }],
  [
    'Камера занята другим приложением',
    { en: 'Camera is occupied by another application', fr: 'La caméra est occupée par une autre application' }
  ],
  ['Камера не найдена', { en: 'Camera not found', fr: 'Caméra introuvable' }],
  [
    'Камера недоступна в этом браузере',
    { en: 'Camera is not available in this browser', fr: "La caméra n'est pas disponible dans ce navigateur" }
  ],
  ['Камера отключилась', { en: 'Camera turned off', fr: 'Caméra éteinte' }],
  [
    'Канал событий комнаты восстанавливается',
    { en: 'Room event channel is being restored', fr: 'Le canal des événements du salon est en cours de restauration' }
  ],
  [
    'Канал событий комнаты подключен',
    { en: 'Room event channel connected', fr: "Canal d'événement de salon connecté" }
  ],
  [
    'Картинка продолжает идти. Перезапустите демонстрацию, чтобы вернуть звук.',
    {
      en: 'The picture continues to roll. Restart the demo to get sound back.',
      fr: "L'image continue de défiler. Redémarrez la démo pour récupérer le son."
    }
  ],
  [
    'Компьютер перегружен: включён облегчённый шумодав',
    {
      en: 'Computer overloaded: lightweight noise reduction enabled',
      fr: 'Ordinateur surchargé : réduction du bruit légère activée'
    }
  ],
  [
    'Медиасоединение до LiveKit потеряно',
    { en: 'Media connection to LiveKit lost', fr: 'Connexion multimédia à LiveKit perdue' }
  ],
  ['Микрофон', { en: 'Microphone', fr: 'Micro' }],
  [
    'Микрофон ещё занят прошлой операцией: попробуйте через несколько секунд',
    {
      en: 'The microphone is still busy with the previous operation: try again in a few seconds',
      fr: "Le microphone est toujours occupé avec l'opération précédente : réessayez dans quelques secondes"
    }
  ],
  [
    'Микрофон найден: включите его кнопкой микрофона',
    {
      en: 'Microphone found: turn it on with the microphone button',
      fr: 'Microphone trouvé : allumez-le avec le bouton microphone'
    }
  ],
  [
    'Микрофон отключился: вы в комнате без микрофона',
    {
      en: 'Microphone muted: you are in a room without a microphone',
      fr: 'Micro coupé : vous êtes dans un salon sans micro'
    }
  ],
  ['Микрофон переключен', { en: 'Microphone switched', fr: 'Microphone commuté' }],
  ['Микрофон переподключен', { en: 'Microphone reconnected', fr: 'Microphone reconnecté' }],
  [
    'Микрофон перестал работать: вы в комнате без микрофона',
    {
      en: 'The microphone has stopped working: you are in a room without a microphone',
      fr: 'Le micro ne fonctionne plus : vous êtes dans un salon sans micro'
    }
  ],
  [
    'Микрофон перестал работать: выберите его заново',
    {
      en: 'Microphone stopped working: select it again',
      fr: 'Le microphone ne fonctionne plus : sélectionnez-le à nouveau'
    }
  ],
  ['Микрофон подключен', { en: 'Microphone connected', fr: 'Microphone connecté' }],
  ['Микрофона нет: подключить', { en: 'No microphone: connect', fr: 'Pas de microphone : connectez-vous' }],
  ['Настройки динамика', { en: 'Speaker settings', fr: 'Paramètres des haut-parleurs' }],
  ['Настройки камеры', { en: 'Camera settings', fr: "Paramètres de l'appareil photo" }],
  ['Настройки микрофона', { en: 'Microphone settings', fr: 'Paramètres du microphone' }],
  [
    'Не удалось включить браузерный шумодав',
    { en: 'Failed to enable browser denoising', fr: "Échec de l'activation du débruitage du navigateur" }
  ],
  ['Не удалось включить камеру', { en: 'Failed to turn on the camera', fr: "Échec de l'allumage de la caméra" }],
  [
    'Не удалось включить облегчённый шумодав',
    { en: 'Failed to enable lightweight noise reduction', fr: "Échec de l'activation de la réduction légère du bruit" }
  ],
  ['Не удалось переключить динамик', { en: 'Failed to switch speaker', fr: 'Échec du changement de haut-parleur' }],
  ['Не удалось переключить микрофон', { en: 'Failed to switch microphone', fr: 'Échec du changement de microphone' }],
  [
    'Не удалось переключить полноэкранный режим',
    { en: 'Failed to switch full screen mode', fr: 'Échec du changement de mode plein écran' }
  ],
  [
    'Не удалось переключить шумодав',
    { en: 'Failed to switch noise reduction', fr: 'Échec de la commutation de la réduction du bruit' }
  ],
  [
    'Не удалось подключить голосовой канал',
    { en: 'Failed to connect voice channel', fr: 'Échec de la connexion du canal vocal' }
  ],
  ['Не удалось подключить микрофон', { en: 'Failed to connect microphone', fr: 'Échec de la connexion du microphone' }],
  ['Не удалось показать экран', { en: 'Failed to show screen', fr: "Échec de l'affichage de l'écran" }],
  ['Не удалось применить гейт', { en: 'Failed to apply gate', fr: "Échec de l'application de la porte" }],
  [
    'Нет доступа к камере: разрешите её в браузере',
    {
      en: 'Camera cannot be accessed: allow it in your browser',
      fr: "La caméra n'est pas accessible : autorisez-la dans votre navigateur"
    }
  ],
  ['Нет маршрута к голосу', { en: 'No route to voice', fr: 'Aucune voie vers la voix' }],
  ['Открыть стрим на весь экран', { en: 'Open stream in full screen', fr: 'Ouvrir le flux en plein écran' }],
  ['Ошибка подключения', { en: 'Connection error', fr: 'Erreur de connexion' }],
  ['Перезапустить', { en: 'Restart', fr: 'Redémarrer' }],
  ['Переподключение голоса', { en: 'Voice reconnection', fr: 'Reconnexion vocale' }],
  ['Пинг до LiveKit {p0}', { en: 'Ping to LiveKit {p0}', fr: 'Ping vers LiveKit {p0}' }],
  ['Плитки комнаты', { en: 'Room Tiles', fr: 'Tuiles de salon' }],
  ['Плохая связь', { en: 'Poor connection', fr: 'Mauvaise connexion' }],
  ['Подключаем голосовой канал', { en: 'Connecting the voice channel', fr: 'Connexion du canal vocal' }],
  [
    'Подключаем канал событий комнаты',
    { en: 'Connecting the room event channel', fr: "Connexion du canal d'événement du salon" }
  ],
  ['Подключение', { en: 'Connection', fr: 'Connexion' }],
  ['Подключение голоса', { en: 'Voice connection', fr: 'Connexion vocale' }],
  ['Подключение к серверу', { en: 'Connect to server', fr: 'Connectez-vous au serveur' }],
  ['Подключение к стриму {p0}', { en: 'Connect to stream {p0}', fr: 'Connectez-vous pour diffuser {p0}' }],
  ['Подключение к экрану', { en: 'Connect to screen', fr: "Se connecter à l'écran" }],
  ['Подключить микрофон', { en: 'Connect microphone', fr: 'Connecter le microphone' }],
  ['Показать снова', { en: 'Show again', fr: 'Afficher à nouveau' }],
  ['Показать экран', { en: 'Show screen', fr: "Afficher l'écran" }],
  ['Покинуть звонок', { en: 'Leave call', fr: "Quitter l'appel" }],
  ['Полноэкранный режим недоступен', { en: 'Full screen mode not available', fr: 'Mode plein écran non disponible' }],
  ['Порог гейта в децибелах', { en: 'Gate threshold in decibels', fr: 'Seuil de porte en décibels' }],
  ['потери к вам {p0}%', { en: 'loss to you {p0}%', fr: 'perte pour vous {p0} %' }],
  ['потери от вас {p0}%', { en: 'losses from you {p0}%', fr: 'pertes de votre part {p0}%' }],
  ['Предыдущие участники', { en: 'Previous participants', fr: 'Anciens participants' }],
  ['Развернуть стрим {p0}', { en: 'Expand stream {p0}', fr: 'Développer le flux {p0}' }],
  ['Свернуть пользователей', { en: 'Collapse users', fr: 'Réduire les utilisateurs' }],
  ['Связь', { en: 'Communication', fr: 'Communication' }],
  [
    'Сервер загружен: стрим идёт в {p0} вместо {p1}',
    {
      en: 'The server is busy: sharing at {p0} instead of {p1}',
      fr: 'Le serveur est occupé : partage en {p0} au lieu de {p1}'
    }
  ],
  ['Сервер на связи', { en: 'Server is online', fr: 'Le serveur est en ligne' }],
  ['Сервер переподключается', { en: 'Server is reconnecting', fr: 'Le serveur se reconnecte' }],
  ['Сигнал переподключается', { en: 'Signal reconnecting', fr: 'Reconnexion du signal' }],
  ['Системная', { en: 'System', fr: 'Système' }],
  ['Системный', { en: 'System', fr: 'Système' }],
  ['Следующие участники', { en: 'Next members', fr: 'Membres suivants' }],
  [
    'Служебное соединение LiveKit восстанавливается',
    {
      en: 'LiveKit service connection is being restored',
      fr: 'La connexion au service LiveKit est en cours de restauration'
    }
  ],
  ['Смотреть стрим', { en: 'Watch stream', fr: 'Regarder le flux' }],
  ['Смотреть стрим {p0}', { en: 'Watch stream {p0}', fr: 'Regarder le flux {p0}' }],
  ['Смотреть экран', { en: 'Watch screen', fr: 'Écran de montre' }],
  ['{p0} и ещё {p1}', { en: '{p0} and {p1} more', fr: '{p0} et {p1} de plus' }],
  ['Смотрят стрим', { en: 'Watching the stream', fr: 'Regarder le flux' }],
  ['Смотрят: 0', { en: 'Views: 0', fr: 'Vues : 0' }],
  ['Сначала подключитесь к комнате', { en: 'Connect to the room first', fr: "Connectez-vous d'abord à le salon" }],
  ['Сначала сохраните имя', { en: 'Save the name first', fr: "Enregistrez d'abord le nom" }],
  [
    'Собеседники слышат разрывы в вашем голосе, оценка по самому звуку, а не по пингу',
    {
      en: 'Interlocutors hear breaks in your voice, assessed by the sound itself, not by ping',
      fr: 'Les interlocuteurs entendent des cassures dans votre voix, évaluées par le son lui-même et non par le ping'
    }
  ],
  [
    'собеседников плохо слышно',
    { en: 'the interlocutors are hard to hear', fr: 'les interlocuteurs sont difficiles à entendre' }
  ],
  ['Сохраните новое имя', { en: 'Save new name', fr: 'Enregistrer le nouveau nom' }],
  ['Стрим', { en: 'Stream', fr: 'Flux' }],
  ['Стрим {p0}', { en: 'Stream {p0}', fr: 'Flux {p0}' }],
  ['Стрим запущен: {p0}, без звука', { en: 'Stream started: {p0}, no sound', fr: 'Flux démarré : {p0}, pas de son' }],
  [
    'Стрим запущен: {p0}, без звука. Safari обычно не дает выбор системного звука для демонстрации.',
    {
      en: "Stream started: {p0}, no sound. Safari usually doesn't give you a choice of system audio to display.",
      fr: "Flux démarré : {p0}, pas de son. Safari ne vous propose généralement pas le choix de l'audio système à afficher."
    }
  ],
  [
    'Стрим запущен: {p0}, звук включен',
    { en: 'Stream started: {p0}, sound on', fr: 'Flux démarré : {p0}, son activé' }
  ],
  ['Управление голосом', { en: 'Voice control', fr: 'Commande vocale' }],
  ['через ретранслятор', { en: 'via repeater', fr: 'via répéteur' }],
  ['через TCP (UDP недоступен)', { en: 'via TCP (UDP not available)', fr: 'via TCP (UDP non disponible)' }],
  ['Шумовой гейт', { en: 'Noise Gate', fr: 'Porte antibruit' }],
  ['Шумодав: {p0}', { en: 'Noise reduction: {p0}', fr: 'Réduction du bruit : {p0}' }],
  ['Шумоподавление', { en: 'Noise reduction', fr: 'Réduction du bruit' }],
  [
    'LiveKit восстанавливает голосовой канал',
    { en: 'LiveKit restores voice channel', fr: 'LiveKit restaure le canal vocal' }
  ],
  [
    'LiveKit не смог установить медиасоединение',
    {
      en: 'LiveKit was unable to establish a media connection',
      fr: "LiveKit n'a pas pu établir une connexion multimédia"
    }
  ],
  ['Push-to-talk: микрофон закрыт', { en: 'Push-to-talk: microphone closed', fr: 'Push-to-talk : microphone fermé' }],
  ['Push-to-talk: микрофон открыт', { en: 'Push-to-talk: microphone open', fr: 'Push-to-talk : microphone ouvert' }],
  [
    'RNNoise остановился: включён браузерный шумодав',
    {
      en: 'RNNoise stopped: browser noise reduction enabled',
      fr: 'RNNoise arrêté : réduction du bruit du navigateur activée'
    }
  ]
]);
