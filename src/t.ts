const ru = {
  appTitle: 'ATest Generator',
  appSubtitle: 'Автоматическая генерация тестов',
  
  btnGenerate: 'Сгенерировать тесты',
  btnInit: 'Инициализация',
  btnInitDone: 'Инициализировано',
  btnAutoOn: 'Вкл. Авторежим',
  btnAutoOff: 'Выкл. Авторежим',

  statusWait: 'Пожалуйста, подождите...',
  statusLoadingGenerate: 'Сбор контрактов и отправка',
  statusLoadingGenerateSub: 'Отправляем файлы на сервер...',
  statusLoadingInit: 'Инициализация',
  statusError: 'Ошибка',
  statusSuccess: 'Успех',

  emptyStateTitle: 'Панель управления',
  emptyStateDesc: 'Выберите действие на панели слева.',
  
  filesReadyTitle: 'Найденные контракты',
  filesReadyDesc: 'Всего файлов:',
  noContractsTitle: 'Контракты не найдены',
  noContractsDesc: 'В папке contracts нет файлов.',

  jobQueuedTitle: 'Задача успешно отправлена!',
  jobQueuedId: 'ID задачи:',
  jobQueuedFiles: 'Файлов отправлено:',
  jobQueuedDesc: 'Нейросеть приступила к генерации тестов. Результаты появятся здесь автоматически.',

  reportTitle: 'Успешно сгенерировано',
  reportMethods: 'Методов',
  reportTests: 'Тестов',
  reportTableMethod: 'Метод',
  reportTableTests: 'Тестов',

  initReadyTitle: 'Проект инициализирован',
  initReadyDesc: 'Созданы папки contracts и Tests.',
} as const

type TranslationKey = keyof typeof ru

const en: Record<TranslationKey, string> = {
  appTitle: 'ATest Generator',
  appSubtitle: 'Automated test generation',
  
  btnGenerate: 'Generate Tests',
  btnInit: 'Initialize',
  btnInitDone: 'Initialized',
  btnAutoOn: 'Enable Auto Mode',
  btnAutoOff: 'Disable Auto Mode',

  statusWait: 'Please wait...',
  statusLoadingGenerate: 'Collecting contracts and sending',
  statusLoadingGenerateSub: 'Uploading files to server...',
  statusLoadingInit: 'Initializing',
  statusError: 'Error',
  statusSuccess: 'Success',

  emptyStateTitle: 'Control Panel',
  emptyStateDesc: 'Select an action from the sidebar.',
  
  filesReadyTitle: 'Found Contracts',
  filesReadyDesc: 'Total files:',
  noContractsTitle: 'No contracts found',
  noContractsDesc: 'There are no files in the contracts folder.',

  jobQueuedTitle: 'Job successfully submitted!',
  jobQueuedId: 'Job ID:',
  jobQueuedFiles: 'Files sent:',
  jobQueuedDesc: 'The AI has started generating tests. Results will appear here automatically.',

  reportTitle: 'Successfully generated',
  reportMethods: 'Methods',
  reportTests: 'Tests',
  reportTableMethod: 'Method',
  reportTableTests: 'Tests',

  initReadyTitle: 'Project initialized',
  initReadyDesc: 'Folders contracts and Tests have been created.',
}

const dictionaries: Record<string, Record<TranslationKey, string>> = { ru, en }

export function t(key: TranslationKey, lang: string = 'ru'): string {
  const dict = dictionaries[lang] || dictionaries['ru']
  return dict[key] || key
}