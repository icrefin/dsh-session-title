/**
 * Dictionaries for the settings page.
 *
 * `en` is the reference dictionary; every other language must cover the same
 * keys, so a missing translation is a type error rather than an empty control.
 * Product names, field ids and the provider/model values are never translated.
 *
 * @module dsh-session-title/client/locales
 */

export const en = {
  nav: 'Session titles',
  title: 'Session titles',
  description:
    'Names each session after the tasks in its log, then revises the name as later rounds of work move it on.',
  effectiveInherited: 'Following each session’s own model',
  effectivePinned: 'Naming with a pinned model',
  readOnly: 'This host does not accept settings writes.',

  modelGroup: 'Naming model',
  modelGroupHint:
    'The model that reads the work digest and proposes the title. It runs as one small auxiliary request, never inside the conversation.',
  modeInherit: 'Follow each session’s model',
  modeInheritHint:
    'Use the same provider and model the session itself uses, read from its logged request route.',
  modePinned: 'Always use one model',
  modePinnedHint:
    'Pin the route for every session. Useful when titles should run on a smaller or cheaper model than the conversation.',
  providerLabel: 'Provider',
  modelLabel: 'Model',
  modelHint:
    'Choose an advertised model, or type any model id this host accepts. Leave the provider empty to inherit.',
  catalogLoading: 'Reading the model catalog…',
  catalogFailed: 'The model catalog could not be read. You can still type a provider and model id.',
  modelNotListed: 'The catalog lists no models for this provider. Type a model id.',
  providerNotListed: 'the pinned provider is not registered on this host',

  titleGroup: 'Title length',
  titleGroupHint: 'A target, not a hard limit: the model is asked to aim near it.',
  wordsLabel: 'Words (non-CJK)',
  cjkLabel: 'Characters (CJK)',

  cadenceGroup: 'When a title is revised',
  cadenceGroupHint:
    'A revision costs one auxiliary request and one title event. These gates keep an idle session from paying for either.',
  turnsLabel: 'Completed turns between revisions',
  stepsLabel: 'Completed steps inside a turn between revisions',
  intervalLabel: 'Minimum gap between revisions (seconds)',
  onTurnEndLabel: 'Revise when a turn ends',
  onStepEndLabel: 'Revise mid-turn at step boundaries',
  childSessionsLabel: 'Also title subagent sessions',
  digestTurnsLabel: 'Turns carried into the work digest',

  save: 'Save',
  reset: 'Reset',
  saved: 'Settings saved. The next title request uses them.',
  saveFailed: 'The host refused the change. The previous settings stand.',
  invalidNumber: 'Enter a whole number within the allowed range.',
  pinnedIncomplete: 'Choose both a provider and a model, or follow the session’s model.',
  unsaved: 'Unsaved changes',
} as const

/** Keys of the reference dictionary. */
export type MessageKey = keyof typeof en

/** The translate seat bound to this namespace. */
export type PageTranslate = (key: MessageKey) => string

export const zh: Record<MessageKey, string> = {
  nav: '会话标题',
  title: '会话标题',
  description: '按会话日志里的实际工作命名，并在后续工作推进时更新这个名字。',
  effectiveInherited: '跟随每个会话自身的模型',
  effectivePinned: '使用固定的模型命名',
  readOnly: '此宿主不接受设置写入。',

  modelGroup: '命名模型',
  modelGroupHint: '读取工作摘要并给出标题的模型。它只发起一次小型辅助请求，不进入对话。',
  modeInherit: '跟随每个会话的模型',
  modeInheritHint: '使用会话自身记录在请求路由中的 provider 与模型。',
  modePinned: '始终使用同一模型',
  modePinnedHint: '为所有会话固定路由。适合让标题使用比对话更小或更便宜的模型。',
  providerLabel: '服务方',
  modelLabel: '模型',
  modelHint: '从已提供的模型中选择，或直接输入宿主接受的模型 id。',
  catalogLoading: '正在读取模型目录…',
  catalogFailed: '无法读取模型目录。你仍可直接输入服务方与模型 id。',
  modelNotListed: '该服务方没有列出模型。请直接输入模型 id。',
  providerNotListed: '固定使用的服务方未在此宿主注册',

  titleGroup: '标题长度',
  titleGroupHint: '这是目标值，不是硬限制：模型被要求尽量接近它。',
  wordsLabel: '词数（非中日韩）',
  cjkLabel: '字数（中日韩）',

  cadenceGroup: '何时更新标题',
  cadenceGroupHint: '一次更新等于一次辅助请求加一条标题事件。以下条件避免空闲会话付出这些代价。',
  turnsLabel: '两次更新之间的完成轮数',
  stepsLabel: '同一轮内两次更新之间的完成步数',
  intervalLabel: '两次更新之间的最小间隔（秒）',
  onTurnEndLabel: '一轮结束时更新',
  onStepEndLabel: '在一轮内的步骤边界更新',
  childSessionsLabel: '同时为子代理会话命名',
  digestTurnsLabel: '工作摘要包含的轮数',

  save: '保存',
  reset: '重置',
  saved: '设置已保存，下一次标题请求将使用它们。',
  saveFailed: '宿主拒绝了此修改，原设置保持不变。',
  invalidNumber: '请输入允许范围内的整数。',
  pinnedIncomplete: '请同时选择服务方和模型，或改为跟随会话模型。',
  unsaved: '有未保存的修改',
}