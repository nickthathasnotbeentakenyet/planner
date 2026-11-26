const TAGS = ['работа', 'дом', 'активность', 'отдых', 'другое'];

// Пастельная палитра для тегов (bg — фон карточек, chart — цвет на графиках и в легенде)
const TAG_STYLES = {
  'работа':     { bg: '#E3ECFA', chart: '#8EB2E5' },
  'дом':        { bg: '#FDF0D5', chart: '#E8C07D' },
  'активность': { bg: '#E1F3E8', chart: '#88C9A1' },
  'отдых':      { bg: '#EFE6FA', chart: '#B69CE0' },
  'другое':     { bg: '#EBECEF', chart: '#A9B0BC' }
};

function generateTimeSlots() {
  const slots = [];
  for (let h = 8; h <= 22; h++) {
    const hh = String(h).padStart(2, '0');
    if (h >= 12 && h < 18) {
      slots.push(hh + ':00');
      slots.push(hh + ':30');
    } else {
      slots.push(hh + ':00');
    }
  }
  return slots;
}
const TIME_SLOTS = generateTimeSlots();

function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function getCurrentSlotStr() {
  if (currentDate !== getTodayStr()) return null;
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (h < 8 || h > 22) return null;

  const hh = String(h).padStart(2, '0');
  if (h >= 12 && h < 18) {
    return m < 30 ? hh + ':00' : hh + ':30';
  }
  return hh + ':00';
}


function formatRussianDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formatted = dateObj.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}


let currentDate = getTodayStr();
let db = JSON.parse(localStorage.getItem('planner_db')) || {
  days: {},
  templates: [
    { id: 't1', text: 'Утренняя зарядка', tag: 'активность' },
    { id: 't2', text: 'Проверка почты', tag: 'работа' }
  ],
  backlog: [],
  monthlyArchive: {}
};

let dragPayload = null;

function saveDB() {
  recalculateMonthlyStats();
  localStorage.setItem('planner_db', JSON.stringify(db));
  scheduleCloudPush();
}

function getDayData(dateStr) {
  if (!db.days[dateStr]) {
    const slotsObj = {};
    TIME_SLOTS.forEach(t => {
      slotsObj[t] = { main: null, backup: null };
    });
    db.days[dateStr] = { slots: slotsObj, notes: '' };
  }
  return db.days[dateStr];
}

function populateTagSelects() {
  ['tplTag', 'backlogTag'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = TAGS.map(t => '<option value="' + t + '">' + t + '</option>').join('');
  });
}

function enableInlineEdit(spanEl, currentText, onSave) {
  spanEl.title = 'Двойной клик для редактирования';
  spanEl.ondblclick = (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = currentText;

    let saved = false;
    const finish = (apply) => {
      if (saved) return;
      saved = true;
      const val = input.value.trim();
      if (apply && val && val !== currentText) {
        onSave(val);
      } else {
        renderAll();
      }
    };

    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);

    spanEl.replaceWith(input);
    input.focus();
    input.select();
  };
}

// Прогресс дня: красный < 33%, жёлтый 33-66%, зелёный > 66%
function renderDayProgress() {
  const day = getDayData(currentDate);
  let filledSlotsCount = 0;
  let completedSlotsCount = 0;

  TIME_SLOTS.forEach(time => {
    const s = day.slots[time];
    const hasMain = Boolean(s.main);
    const hasBackup = Boolean(s.backup);

    if (hasMain || hasBackup) {
      filledSlotsCount++;
      if ((hasMain && s.main.done) || (hasBackup && s.backup.done)) {
        completedSlotsCount++;
      }
    }
  });

  const percent = filledSlotsCount === 0 ? 0 : Math.round((completedSlotsCount / filledSlotsCount) * 100);
  const fillEl = document.getElementById('topProgressFill');
  
  fillEl.style.width = percent + '%';
  if (percent < 33) {
    fillEl.style.backgroundColor = '#E58A8A';
  } else if (percent <= 66) {
    fillEl.style.backgroundColor = '#EBC86E';
  } else {
    fillEl.style.backgroundColor = '#82C99B';
  }

  document.getElementById('dayProgressText').textContent = percent + '% (' + completedSlotsCount + '/' + filledSlotsCount + ' слотов)';
}

function recalculateMonthlyStats() {
  const currentMonth = currentDate.slice(0, 7);
  const stats = {};
  TAGS.forEach(t => {
    stats[t] = { total: 0, done: 0 };
  });
  let grandTotal = 0;

  Object.keys(db.days).forEach(dateKey => {
    if (dateKey.startsWith(currentMonth)) {
      const daySlots = db.days[dateKey].slots;
      Object.values(daySlots).forEach(pair => {
        ['main', 'backup'].forEach(type => {
          const task = pair[type];
          if (task) {
            const tag = TAGS.includes(task.tag) ? task.tag : 'другое';
            stats[tag].total++;
            grandTotal++;
            if (task.done) stats[tag].done++;
          }
        });
      });
    }
  });

  db.monthlyArchive[currentMonth] = { grandTotal: grandTotal, tags: stats };
}

function renderCharts() {
  const currentMonth = currentDate.slice(0, 7);
  document.getElementById('statsMonthLabel').textContent = currentMonth;
  document.getElementById('statsMonthLabel2').textContent = currentMonth;

  const data = db.monthlyArchive[currentMonth] || { grandTotal: 0, tags: {} };
  const distContainer = document.getElementById('chartDistribution');
  const compContainer = document.getElementById('chartCompletion');

  // 1. Бублик (доля тегов) + легенда
  let currentAngle = 0;
  const gradientStops = [];
  let distLegendHtml = '<div class="legend-list">';

  TAGS.forEach(tag => {
    const tagData = data.tags[tag] || { total: 0, done: 0 };
    const pct = data.grandTotal === 0 ? 0 : Math.round((tagData.total / data.grandTotal) * 100);
    const exactDeg = data.grandTotal === 0 ? 0 : (tagData.total / data.grandTotal) * 360;
    const color = TAG_STYLES[tag].chart;

    if (exactDeg > 0) {
      gradientStops.push(color + ' ' + currentAngle + 'deg ' + (currentAngle + exactDeg) + 'deg');
      currentAngle += exactDeg;
    }

    distLegendHtml +=
      '<div class="legend-item">' +
        '<span class="legend-dot" style="background:' + color + '"></span>' +
        '<span>' + tag + ': <strong>' + pct + '%</strong> (' + tagData.total + ')</span>' +
      '</div>';
  });
  distLegendHtml += '</div>';

  const donutBg = gradientStops.length > 0
    ? 'conic-gradient(' + gradientStops.join(', ') + ')'
    : '#EAE6DF';

  distContainer.innerHTML =
    '<div class="donut-chart" style="background: ' + donutBg + ';">' +
      '<div class="donut-hole">' +
        '<span>Всего</span>' +
        '<strong>' + data.grandTotal + '</strong>' +
      '</div>' +
    '</div>' +
    distLegendHtml;

  // 2. Цветные столбцы (% выполнения по тегам) + легенда
  let colsHtml = '<div class="columns-chart">';
  let compLegendHtml = '<div class="legend-list">';

  TAGS.forEach(tag => {
    const tagData = data.tags[tag] || { total: 0, done: 0 };
    const compPct = tagData.total === 0 ? 0 : Math.round((tagData.done / tagData.total) * 100);
    const color = TAG_STYLES[tag].chart;

    colsHtml +=
      '<div class="col-item" title="' + tag + ': ' + compPct + '% (' + tagData.done + '/' + tagData.total + ')">' +
        '<span class="col-val">' + compPct + '%</span>' +
        '<div class="col-bar" style="height: ' + compPct + '%; background: ' + color + ';"></div>' +
      '</div>';

    compLegendHtml +=
      '<div class="legend-item">' +
        '<span class="legend-dot" style="background:' + color + '"></span>' +
        '<span>' + tag + ': <strong>' + compPct + '%</strong> (' + tagData.done + '/' + tagData.total + ')</span>' +
      '</div>';
  });

  colsHtml += '</div>';
  compLegendHtml += '</div>';
  compContainer.innerHTML = colsHtml + compLegendHtml;
}

function renderSlots() {
  const container = document.getElementById('slotsContainer');
  const day = getDayData(currentDate);
  container.innerHTML = '';
  const activeSlot = getCurrentSlotStr();

  TIME_SLOTS.forEach(time => {
    const row = document.createElement('div');
    row.className = 'slot-row';

    const timeLabel = document.createElement('div');
    timeLabel.className = 'slot-time';
    timeLabel.textContent = time;
    if (time === activeSlot) {
      row.classList.add('is-current-slot');
      const dot = document.createElement('span');
      dot.className = 'now-dot';
      dot.title = 'Текущий временной слот';
      timeLabel.appendChild(dot);
    }
    row.appendChild(timeLabel);

    ['main', 'backup'].forEach(type => {
      const zone = document.createElement('div');
      zone.className = 'drop-zone';

      const task = day.slots[time][type];

      if (task) {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        const styleObj = TAG_STYLES[task.tag] || TAG_STYLES['другое'];
        card.style.backgroundColor = styleObj.bg;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = task.done;
        cb.onchange = () => {
          task.done = cb.checked;
          saveDB();
          renderAll();
        };

        const span = document.createElement('span');
        span.className = 'task-text';
        span.textContent = task.text;
        if (task.done) {
          span.style.textDecoration = 'line-through';
          span.style.opacity = '0.65';
        }
        enableInlineEdit(span, task.text, (newText) => {
          task.text = newText;
          saveDB();
          renderAll();
        });
        const tagSel = document.createElement('select');
        TAGS.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t;
          if (t === task.tag) opt.selected = true;
          tagSel.appendChild(opt);
        });
        tagSel.onchange = () => {
          task.tag = tagSel.value;
          saveDB();
          renderAll();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'del-btn';
        delBtn.textContent = '×';
        delBtn.onclick = () => {
          day.slots[time][type] = null;
          saveDB();
          renderAll();
        };

        card.append(cb, span, tagSel, delBtn);

        card.ondragstart = (e) => {
          dragPayload = { source: 'slot', time: time, type: type, task: task };
          e.dataTransfer.effectAllowed = 'move';
        };

        zone.appendChild(card);
      } else {
        zone.classList.add('is-empty');
        const placeholder = document.createElement('span');
        placeholder.className = 'empty-hint';
        placeholder.textContent = type === 'main' ? '+ Основной план' : '+ Бэкап-план';
        zone.appendChild(placeholder);

        zone.onclick = () => {
          if (zone.querySelector('input')) return;
          zone.innerHTML = '';
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'edit-input';
          input.placeholder = type === 'main' ? 'Основная задача...' : 'Бэкап-задача...';

          let saved = false;
          const finish = (apply) => {
            if (saved) return;
            saved = true;
            const val = input.value.trim();
            if (apply && val) {
              day.slots[time][type] = { text: val, tag: 'работа', done: false };
              saveDB();
            }
            renderAll();
          };

          input.onkeydown = (ev) => {
            if (ev.key === 'Enter') finish(true);
            if (ev.key === 'Escape') finish(false);
          };
          input.onblur = () => finish(true);

          zone.appendChild(input);
          input.focus();
        };
      }


      zone.ondragover = (e) => e.preventDefault();
      zone.ondrop = (e) => {
        e.preventDefault();
        if (!dragPayload) return;

        const targetTask = day.slots[time][type];

        if (dragPayload.source === 'template') {
          if (!targetTask) {
            day.slots[time][type] = { text: dragPayload.task.text, tag: dragPayload.task.tag, done: false };
          } else {
alert('Шаблон можно перетянуть только на пустой таймслот!');
}
} else if (dragPayload.source === 'slot') {
if (dragPayload.time === time && dragPayload.type === type) return;
day.slots[dragPayload.time][dragPayload.type] = targetTask;
day.slots[time][type] = dragPayload.task;
} else if (dragPayload.source === 'backlog') {
db.backlog.splice(dragPayload.index, 1);
if (targetTask) {
db.backlog.push({ id: Date.now().toString(), text: targetTask.text, tag: targetTask.tag });
}
day.slots[time][type] = { text: dragPayload.task.text, tag: dragPayload.task.tag, done: false };
}
dragPayload = null;
saveDB();
renderAll();
};
row.appendChild(zone);
});
container.appendChild(row);
});
}
function renderTemplates() {
  const list = document.getElementById('templatesList');
  list.innerHTML = '';

  db.templates.forEach((tpl, idx) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.draggable = true;
    const styleObj = TAG_STYLES[tpl.tag] || TAG_STYLES['другое'];
    item.style.backgroundColor = styleObj.bg;

    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.textContent = tpl.tag;

    const textSpan = document.createElement('span');
    textSpan.className = 'task-text';
    textSpan.textContent = tpl.text;

    enableInlineEdit(textSpan, tpl.text, (newText) => {
      tpl.text = newText;
      saveDB();
      renderTemplates();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '×';
    delBtn.onclick = () => {
      db.templates.splice(idx, 1);
      saveDB();
      renderTemplates();
    };

    item.append(pill, textSpan, delBtn);

    item.ondragstart = () => {
      dragPayload = { source: 'template', task: tpl };
    };

    list.appendChild(item);
  });
}

function renderBacklog() {
  const list = document.getElementById('backlogList');
  list.innerHTML = '';

  db.backlog.forEach((bTask, idx) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.draggable = true;
    const styleObj = TAG_STYLES[bTask.tag] || TAG_STYLES['другое'];
    item.style.backgroundColor = styleObj.bg;

    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.textContent = bTask.tag;

    const textSpan = document.createElement('span');
    textSpan.className = 'task-text';
    textSpan.textContent = bTask.text;

    enableInlineEdit(textSpan, bTask.text, (newText) => {
      bTask.text = newText;
      saveDB();
      renderBacklog();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '×';
    delBtn.onclick = () => {
      db.backlog.splice(idx, 1);
      saveDB();
      renderBacklog();
    };

    item.append(pill, textSpan, delBtn);

    item.ondragstart = () => {
      dragPayload = { source: 'backlog', index: idx, task: bTask };
    };

    list.appendChild(item);
  });
}


const backlogZone = document.getElementById('backlogDropZone');
backlogZone.ondragover = (e) => e.preventDefault();
backlogZone.ondrop = (e) => {
e.preventDefault();
if (dragPayload && dragPayload.source === 'slot') {
const day = getDayData(currentDate);
day.slots[dragPayload.time][dragPayload.type] = null;
db.backlog.push({
id: Date.now().toString(),
text: dragPayload.task.text,
tag: dragPayload.task.tag
});
dragPayload = null;
saveDB();
renderAll();
}
};
document.getElementById('addTplBtn').onclick = () => {
const inp = document.getElementById('tplInput');
const tag = document.getElementById('tplTag').value;
if (inp.value.trim()) {
db.templates.push({ id: Date.now().toString(), text: inp.value.trim(), tag: tag });
inp.value = '';
saveDB();
renderTemplates();
}
};
document.getElementById('addBacklogBtn').onclick = () => {
const inp = document.getElementById('backlogInput');
const tag = document.getElementById('backlogTag').value;
if (inp.value.trim()) {
db.backlog.push({ id: Date.now().toString(), text: inp.value.trim(), tag: tag });
inp.value = '';
saveDB();
renderBacklog();
}
};
const notesEl = document.getElementById('dayNotes');
notesEl.oninput = () => {
const day = getDayData(currentDate);
day.notes = notesEl.value;
saveDB();
};
const datePicker = document.getElementById('datePicker');
datePicker.onchange = () => {
if (datePicker.value) {
currentDate = datePicker.value;
renderAll();
}
};
function shiftDate(daysDelta) {
  const [y, m, d] = currentDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d + daysDelta);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  currentDate = year + '-' + month + '-' + day;
  renderAll();
}


document.getElementById('prevDayBtn').onclick = () => shiftDate(-1);
document.getElementById('nextDayBtn').onclick = () => shiftDate(1);

// Экспорт базы в JSON-файл
document.getElementById('exportBtn').onclick = () => {
  const dataStr = JSON.stringify(db, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'planner_backup_' + getTodayStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  document.getElementById('backupMenu').removeAttribute('open');
};

// Импорт базы из JSON-файла
const importInput = document.getElementById('importFileInput');
document.getElementById('importBtn').onclick = () => {
  importInput.click();
};

importInput.onchange = (e) => {
  const file = e.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed && typeof parsed === 'object' && parsed.days) {
        db = parsed;
        saveDB();
        renderAll();
        alert('Резервная копия успешно загружена!');
      } else {
        alert('Неверный формат файла резервной копии.');
      }
    } catch (err) {
      alert('Ошибка чтения файла.');
    }
    importInput.value = '';
    document.getElementById('backupMenu').removeAttribute('open');
  };
  reader.readAsText(file);
};

// Закрывать меню «Данные» при клике вне него
document.addEventListener('click', (e) => {
  const menu = document.getElementById('backupMenu');
  if (menu && menu.hasAttribute('open') && !menu.contains(e.target)) {
    menu.removeAttribute('open');
  }
});

document.getElementById('todayBtn').onclick = () => {
currentDate = getTodayStr();
renderAll();
};
function renderAll() {
document.getElementById('displayDate').textContent = formatRussianDate(currentDate);
datePicker.value = currentDate;
notesEl.value = getDayData(currentDate).notes || '';
recalculateMonthlyStats();
renderDayProgress();
renderCharts();
renderSlots();
renderTemplates();
renderBacklog();
}

// === ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ ЧЕРЕЗ GITHUB GIST ===
let cloudConfig = JSON.parse(localStorage.getItem('planner_cloud')) || { token: '', gistId: '' };
let pushTimer = null;

function setSyncStatus(state) {
  const dot = document.getElementById('syncStatusDot');
  if (!dot) return;
  if (!cloudConfig.token || !cloudConfig.gistId) {
    dot.textContent = '▾';
    dot.style.color = '';
  } else if (state === 'syncing') {
    dot.textContent = '↻';
    dot.style.color = '#8EB2E5';
  } else if (state === 'ok') {
    dot.textContent = '●';
    dot.style.color = '#82C99B';
  } else if (state === 'err') {
    dot.textContent = '!';
    dot.style.color = '#E58A8A';
  }
}

function scheduleCloudPush() {
  if (!cloudConfig.token || !cloudConfig.gistId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToCloud, 1500);
}

async function pushToCloud() {
  if (!cloudConfig.token || !cloudConfig.gistId) return;
  setSyncStatus('syncing');
  try {
    const res = await fetch('https://api.github.com/gists/' + cloudConfig.gistId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + cloudConfig.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: {
          'planner_db.json': {
            content: JSON.stringify(db, null, 2)
          }
        }
      })
    });
    if (!res.ok) {
      console.error('GitHub PATCH error:', res.status, await res.text());
      setSyncStatus('err');
      return;
    }
    setSyncStatus('ok');
  } catch (e) {
    console.error('Cloud push catch:', e);
    setSyncStatus('err');
  }
}

async function pullFromCloud(silent) {
  if (!cloudConfig.token || !cloudConfig.gistId) return;
  setSyncStatus('syncing');
  try {
    const res = await fetch('https://api.github.com/gists/' + cloudConfig.gistId + '?t=' + Date.now(), {
      headers: {
        'Authorization': 'Bearer ' + cloudConfig.token,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('GitHub GET error:', res.status, errText);
      setSyncStatus('err');
      if (!silent) alert('Ошибка GitHub (' + res.status + '): проверь Token и Gist ID.');
      return;
    }
    const data = await res.json();
    const file = data.files && data.files['planner_db.json'];
    if (!file) {
      setSyncStatus('err');
      if (!silent) alert('В этом Gist не найден файл planner_db.json! Проверь имя файла в Gist.');
      return;
    }
    if (file.content) {
      const remoteDb = JSON.parse(file.content);
      if (remoteDb && remoteDb.days) {
        db = remoteDb;
        localStorage.setItem('planner_db', JSON.stringify(db));
        renderAll();
        setSyncStatus('ok');
        if (!silent) alert('Данные успешно загружены из облака!');
      } else {
        // Если в Gist пока пустой объект {} — отправляем туда текущую локальную базу
        await pushToCloud();
        if (!silent) alert('Облако подключено, текущая база отправлена в Gist!');
      }
    }
  } catch (e) {
    console.error('Cloud pull catch:', e);
    setSyncStatus('err');
    if (!silent) alert('Ошибка подключения: ' + e.message);
  }
}


const tokenInputEl = document.getElementById('cloudTokenInput');
const gistInputEl = document.getElementById('cloudGistInput');

if (tokenInputEl && gistInputEl) {
  tokenInputEl.value = cloudConfig.token || '';
  gistInputEl.value = cloudConfig.gistId || '';
}

document.getElementById('saveCloudBtn').onclick = () => {
  const token = tokenInputEl.value.trim();
  const gistId = gistInputEl.value.trim();

  cloudConfig = { token: token, gistId: gistId };
  updateCloudFormUI(false);
  localStorage.setItem('planner_cloud', JSON.stringify(cloudConfig));

  if (!token || !gistId) {
    setSyncStatus('');
    alert('Настройки облака очищены.');
    return;
  }

  setSyncStatus('syncing');
  pullFromCloud(false);
  document.getElementById('backupMenu').removeAttribute('open');
};


document.getElementById('syncNowBtn').onclick = () => {
  document.getElementById('backupMenu').removeAttribute('open');
  if (!cloudConfig.token || !cloudConfig.gistId) {
    alert('Сначала укажи Token и Gist ID в пункте «Облако (GitHub Gist)».');
    return;
  }
  pullFromCloud(false);
};

// Автоматически подтягиваем свежие данные при открытии страницы и при возврате во вкладку
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    pullFromCloud(true);
  }
});

function updateCloudFormUI(forceEdit) {
  const formEl = document.getElementById('cloudFormFields');
  const barEl = document.getElementById('cloudConnectedBar');
  if (!formEl || !barEl) return;

  const isConfigured = Boolean(cloudConfig.token && cloudConfig.gistId);
  if (isConfigured && !forceEdit) {
    formEl.style.display = 'none';
    barEl.style.display = 'flex';
  } else {
    formEl.style.display = 'flex';
    barEl.style.display = 'none';
  }
}

document.getElementById('editCloudBtn').onclick = (e) => {
  e.stopPropagation();
  updateCloudFormUI(true);
};


populateTagSelects();
renderAll();
setSyncStatus('syncing');
updateCloudFormUI(false);
pullFromCloud(true);
setInterval(renderSlots, 60000);