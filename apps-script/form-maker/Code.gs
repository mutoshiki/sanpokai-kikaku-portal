const BACKEND_VERSION = 'editor-share-v4-20260820';

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('山歩会企画フォームメーカー')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * Web画面から受け取った企画情報をもとにGoogleフォームを作成
 */
function createForm(data) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const planName = cleanText_(data.planName, 100);
    const editorEmail = cleanText_(data.editorEmail, 254).toLowerCase();
    const eventDate = cleanText_(data.eventDate, 30);
    const deadline = cleanText_(data.deadline, 30);
    const description = cleanText_(data.description, 3000);

    if (!planName) {
      throw new Error('企画名を入力してください。');
    }

    if (!isValidEmail_(editorEmail)) {
      throw new Error('有効な編集者メールアドレスを入力してください。');
    }

    const form = FormApp.create(`${planName} 応募フォーム`);

    form.setDescription(
      buildDescription_({
        eventDate: eventDate,
        deadline: deadline,
        description: description
      })
    );

    form.setConfirmationMessage(
      '回答ありがとうございました！\n企画担当者からの連絡をお待ちください。'
    );

    form.setAcceptingResponses(true);

    const editorResult = grantEditorAccess_(form, editorEmail);

    form.addSectionHeaderItem()
      .setTitle('参加者情報');

    form.addTextItem()
      .setTitle('氏名')
      .setRequired(true);

    form.addTextItem()
      .setTitle('学籍番号')
      .setRequired(true);

    form.addMultipleChoiceItem()
      .setTitle('学年')
      .setChoiceValues([
        '1年',
        '2年',
        '3年',
        '4年',
        '大学院',
        'その他'
      ])
      .setRequired(true);

    form.addTextItem()
      .setTitle('学部・学科')
      .setRequired(true);

    form.addTextItem()
      .setTitle('LINEの表示名')
      .setRequired(true);

    const carQuestion = form.addMultipleChoiceItem();

    carQuestion
      .setTitle('車出しはできますか？')
      .setRequired(true);

    const carSection = form.addPageBreakItem()
      .setTitle('車出しについて');

    form.addTextItem()
      .setTitle('車種')
      .setHelpText('例：スバル インプレッサ')
      .setRequired(true);

    form.addTextItem()
      .setTitle('運転者を除いて何人乗せられますか？')
      .setHelpText('数字で入力してください。')
      .setRequired(true);

    form.addParagraphTextItem()
      .setTitle('車についての備考')
      .setHelpText('集合場所・荷物・運転可能時間など、必要な場合のみ記入してください。');

    const finalSection = form.addPageBreakItem()
      .setTitle('その他');

    carQuestion.setChoices([
      carQuestion.createChoice('はい', carSection),
      carQuestion.createChoice('いいえ', finalSection)
    ]);

    carSection.setGoToPage(finalSection);

    form.addParagraphTextItem()
      .setTitle('自由記述')
      .setHelpText('連絡事項や質問などがあれば記入してください。');

    const result = {
      success: true,
      backendVersion: BACKEND_VERSION,
      title: form.getTitle(),
      formId: form.getId(),
      editorEmail: editorEmail,
      editorGranted: editorResult.granted,
      editorMethod: editorResult.method || '',
      editorWarning: editorResult.warning,
      editUrl: form.getEditUrl(),
      responseUrl: form.getPublishedUrl(),
      createdAt: Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        'yyyy/MM/dd HH:mm'
      )
    };

    saveCreationHistory_(result);

    return result;

  } catch (error) {
    console.error(error);

    throw new Error(
      error && error.message
        ? error.message
        : 'フォームの作成に失敗しました。'
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      // lock取得前に失敗した場合は無視
    }
  }
}


/**
 * GoogleフォームはDrive上のファイルでもあるため、Driveの共有権限として
 * 編集者を追加する。Drive共有が例外になった場合のみForm.addEditor()へ
 * フォールバックする。
 *
 * addEditor() が例外なく完了した時点で共有要求はGoogleに受理されている。
 * getEditors() は権限反映の遅延などで即時確認できないことがあるため、
 * 成功判定には使わない。
 */
function grantEditorAccess_(form, editorEmail) {
  const errors = [];

  try {
    DriveApp.getFileById(form.getId()).addEditor(editorEmail);
    return { granted: true, method: 'drive', warning: '' };
  } catch (error) {
    errors.push('Drive共有: ' + getErrorMessage_(error));
    console.error('Drive editor sharing failed:', error);
  }

  try {
    form.addEditor(editorEmail);
    return { granted: true, method: 'forms', warning: '' };
  } catch (error) {
    errors.push('Forms共有: ' + getErrorMessage_(error));
    console.error('Form editor sharing failed:', error);
  }

  return {
    granted: false,
    method: '',
    warning:
      'フォームは作成されましたが、編集者へのアクセス権を追加できませんでした。' +
      ' 原因: ' + errors.join(' / ')
  };
}


function getErrorMessage_(error) {
  if (!error) return '不明なエラー';
  if (error.message) return String(error.message);
  return String(error);
}


/**
 * フォーム作成履歴をScript Propertiesへ保存。
 * 公開Webアプリから全履歴を読み出すAPIは用意せず、編集URLの漏えいを防ぐ。
 */
function saveCreationHistory_(result) {
  const properties = PropertiesService.getScriptProperties();
  const indexKey = 'FORM_HISTORY_INDEX';
  const entryPrefix = 'FORM_HISTORY_';
  const historyLimit = 100;
  const entryKey =
    entryPrefix + Date.now() + '_' + Utilities.getUuid().replace(/-/g, '');

  const entry = {
    createdAt: result.createdAt,
    title: result.title,
    formId: result.formId,
    editorEmail: result.editorEmail,
    editorGranted: result.editorGranted,
    editorMethod: result.editorMethod || '',
    backendVersion: result.backendVersion || '',
    responseUrl: result.responseUrl,
    editUrl: result.editUrl
  };

  properties.setProperty(entryKey, JSON.stringify(entry));

  let index = [];

  try {
    index = JSON.parse(properties.getProperty(indexKey) || '[]');

    if (!Array.isArray(index)) {
      index = [];
    }
  } catch (error) {
    index = [];
  }

  index.unshift(entryKey);

  const oldKeys = index.splice(historyLimit);
  properties.setProperty(indexKey, JSON.stringify(index));

  oldKeys.forEach(function (key) {
    properties.deleteProperty(key);
  });
}


function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}


function buildDescription_(data) {
  const lines = [];

  if (data.eventDate) {
    lines.push(`開催日：${formatDate_(data.eventDate)}`);
  }

  if (data.deadline) {
    lines.push(`回答期限：${formatDateTime_(data.deadline)}`);
  }

  if (lines.length > 0 && data.description) {
    lines.push('');
  }

  if (data.description) {
    lines.push(data.description);
  }

  return lines.join('\n');
}


function cleanText_(value, maxLength) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .trim()
    .substring(0, maxLength);
}


function formatDate_(value) {
  if (!value) return '';

  const parts = value.split('-');

  if (parts.length !== 3) {
    return value;
  }

  return `${Number(parts[0])}年${Number(parts[1])}月${Number(parts[2])}日`;
}


function formatDateTime_(value) {
  if (!value) return '';

  const normalized = value.replace('T', ' ');
  const parts = normalized.split(' ');

  const date = formatDate_(parts[0]);

  if (!parts[1]) {
    return date;
  }

  return `${date} ${parts[1]}`;
}


/**
 * 所有者アカウントで一度手動実行し、Forms + Driveの権限を承認する。
 */
function authorizeOnce() {
  const form = FormApp.create('山歩会フォームメーカー 権限確認用');
  const file = DriveApp.getFileById(form.getId());

  file.getEditors();

  Logger.log(form.getEditUrl());
  return form.getEditUrl();
}
