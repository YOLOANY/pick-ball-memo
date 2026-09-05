// pages/ball/publish.js
// 约球帖子发布页逻辑
// 职责：
//   1. 维护表单数据 formData
//   2. 提供项目 / 时间 / 人数 / 招募范围等交互
//   3. 时间选择支持两种方式：滚动选择（日期 picker + 时间 picker 两个独立）/ 文本输入（日期 + 时间两个独立输入框）
//   4. 日期和时间分开：改其中一个不会影响另一个
//   5. 默认时间 = 进入页面时「当前时间 + 3 小时」，向上取整到 5 分钟
//   6. 提交时进行基础校验，再调用 ballAdd 云函数写入云数据库 ball_posts 集合

const app = getApp();

// 工具：某年某月有多少天
// 关键：month 取 1-12；用 new Date(year, month, 0) 取得当月最后一天
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 工具：把分钟数向上取整到 5 的倍数
function ceilToFive(min) {
  return Math.ceil(min / 5) * 5;
}

// 工具：获取「当前时间 + 3 小时」，向上取整到 5 分钟
// 关键：返回新的 Date 实例，避免污染 Date.now()
function getDefaultDate() {
  const d = new Date();
  d.setHours(d.getHours() + 3);
  let mi = ceilToFive(d.getMinutes());
  if (mi >= 60) {
    d.setHours(d.getHours() + 1);
    mi = 0;
  }
  d.setMinutes(mi);
  d.setSeconds(0, 0);
  return d;
}

// 工具：把 Date 格式化为 "YYYY-MM-DD HH:mm"
function formatDateTime(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

// 工具：把 Date 格式化为 "YYYY-MM-DD"
function formatDateOnly(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// 工具：把 Date 格式化为 "HH:mm"
function formatTimeOnly(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mi}`;
}

Page({
  data: {
    // 表单数据：所有用户输入最终汇总到这里
    formData: {
      sport: '',            // 运动项目枚举：tennis / basketball / ...
      time: '',             // 约球时间（已格式化的字符串 YYYY-MM-DD HH:mm）
      location: '',         // 地点
      needCount: 2,         // 需要人数（不含发起人）
      scope: 'all',         // 招募范围：all / college / grade
      contact: '',          // 联系方式（选填）
      remark: '',           // 备注说明
      recruitDeadline: 0,        // 招募截止时间戳（毫秒）；0 = 不自动截止
      recruitDeadlineText: '',   // 招募截止时间显示文案
      remindEnabled: false        // 是否为自己开启「提前 2 小时提醒」
    },

    // 招募截止时间选择弹层：date + time picker 同屏可调
    deadlinePickerVisible: false,
    deadlineDate: '',            // YYYY-MM-DD
    deadlineTime: '',            // HH:MM
    deadlineDateStart: '',       // 今天
    deadlineDateEnd: '',         // 30 天后

    // ============ 时间选择：滚动 vs 输入 双模式 ============
    // 关键：日期 / 时间 完全分开——可以只改日期不动时间，或只改时间不动日期
    timeMode: 'scroll',   // 'scroll' | 'input'
    // 滚动模式：两个独立 picker（date picker + time picker）
    timeDateStart: '',    // 今天（picker 的可选起点）
    timeDateEnd: '',      // 30 天后（picker 的可选终点）
    timeDate: '',         // YYYY-MM-DD
    timeTime: '',         // HH:mm
    // 输入模式：两个独立文本输入（日期 + 时间）
    timeInputDate: '',    // YYYY-MM-DD
    timeInputTime: '',    // HH:mm
    timeInputError: '',   // 整体错误（如"日期 + 时间合起来在过去"）

    // 运动项目可选列表
    // emoji 字段只用于前端展示，提交到数据库时只保留 value
    sportList: [
      { value: 'tennis',     label: '网球',   emoji: '🎾' },
      { value: 'basketball', label: '篮球',   emoji: '🏀' },
      { value: 'badminton',  label: '羽毛球', emoji: '🏸' },
      { value: 'football',   label: '足球',   emoji: '⚽' },
      { value: 'pingpong',   label: '乒乓球', emoji: '🏓' },
      { value: 'volleyball', label: '排球',   emoji: '🏐' }
    ],

    // 招募范围
    scopeList: [
      { value: 'all',     label: '全校同学' },
      { value: 'college', label: '本院同学' },
      { value: 'grade',   label: '同年级'   }
    ],

    // 提交中状态：用于控制按钮 loading
    submitting: false
  },

  // ============ 生命周期 ============
  onLoad() {
    // 默认选中第一个运动项目，给用户一个友好起点
    this.setData({
      'formData.sport': this.data.sportList[0].value
    });

    // 关键：默认时间 = 当前时间 + 3 小时，向上取整到 5 分钟
    const defaultDate = getDefaultDate();
    this._initTimePicker(defaultDate);

    // 初始化截止时间 picker 的可选日期范围：今天 ~ 30 天后
    const today = this._formatDate(new Date());
    const d30 = new Date();
    d30.setDate(d30.getDate() + 30);
    const maxDate = this._formatDate(d30);
    let initDate = today;
    let initTime = '12:00';
    if (this.data.formData.recruitDeadline) {
      const d = new Date(this.data.formData.recruitDeadline);
      if (Number.isFinite(d.getTime()) && d.getTime() > Date.now()) {
        initDate = this._formatDate(d);
        initTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    this.setData({
      deadlineDateStart: today,
      deadlineDateEnd: maxDate,
      deadlineDate: initDate,
      deadlineTime: initTime
    });
  },

  // 初始化时间选择器（日期 + 时间 两个独立值）
  // 关键：根据传入的 Date d 同时更新 formData.time / timeDate / timeTime / timeInputDate / timeInputTime
  //      调用前应保证 d 在未来
  _initTimePicker(d) {
    const dateStr = formatDateOnly(d);
    const timeStr = formatTimeOnly(d);
    const todayStr = formatDateOnly(new Date());
    // 关键：约球时间 picker 的可选终点设为「今天 + 2 年」
    // 之前的 30 天太短，提前规划的 2027 年滚不进去
    // （招募截止时间 deadline 那个 picker 仍然保持 30 天，不受影响）
    const dFar = new Date();
    dFar.setDate(dFar.getDate() + 730);
    const maxDateStr = formatDateOnly(dFar);

    this.setData({
      'formData.time': formatDateTime(d),
      timeDateStart: todayStr,
      timeDateEnd: maxDateStr,
      timeDate: dateStr,
      timeTime: timeStr,
      timeInputDate: dateStr,
      timeInputTime: timeStr,
      timeInputError: ''
    });
  },

  // ============ 表单交互 ============
  // 选中运动项目
  onSelectSport(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({ 'formData.sport': value });
  },

  // 选中招募范围
  onSelectScope(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({ 'formData.scope': value });
  },

  // 通用 input / textarea 输入处理
  // 关键：value 在 e.detail.value，data-field 在 e.currentTarget.dataset
  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`formData.${field}`]: value });
  },

  // 兜底：blur 时也同步一次，防止某些情况 bindinput 不触发
  onInputBlur(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    if (value !== undefined) {
      this.setData({ [`formData.${field}`]: value });
    }
  },

  // 人数 +1
  onCountPlus() {
    const cur = this.data.formData.needCount;
    if (cur >= 20) {
      wx.showToast({ title: '最多招募 20 人', icon: 'none' });
      return;
    }
    this.setData({ 'formData.needCount': cur + 1 });
  },

  // 人数 -1
  onCountMinus() {
    const cur = this.data.formData.needCount;
    if (cur <= 1) return;
    this.setData({ 'formData.needCount': cur - 1 });
  },

  // ============ 时间选择：模式切换 ============
  // 在「滚动」和「输入」两种方式之间切换
  // 关键：日期/时间是分开的——切到 input 时把 timeDate/timeTime 复制到 input；
  //      切回 scroll 时把 input 复制回 picker
  onSwitchTimeMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.timeMode) return;
    if (mode === 'input') {
      // 进入输入模式：把滚动模式的 date / time 同步到两个输入框
      this.setData({
        timeMode: 'input',
        timeInputDate: this.data.timeDate,
        timeInputTime: this.data.timeTime,
        timeInputError: ''
      });
    } else {
      // 进入滚动模式：先用输入值回填 picker，再用 _initTimePicker 重建
      // 关键：先按当前 input 值（可能用户改过）→ 同步到 picker；若输入合法则保留，否则 fallback 默认
      const inDate = (this.data.timeInputDate || '').trim();
      const inTime = (this.data.timeInputTime || '').trim();
      if (this._isValidDateStr(inDate) && this._isValidTimeStr(inTime)) {
        this.setData({
          timeMode: 'scroll',
          timeDate: inDate,
          timeTime: inTime
        });
      } else {
        // 输入有误：用默认时间，提示用户
        const d = getDefaultDate();
        this._initTimePicker(d);
        this.setData({ timeMode: 'scroll' });
        wx.showToast({ title: '输入有误，已恢复默认', icon: 'none' });
      }
    }
  },

  // ============ 时间选择：滚动模式（date picker + time picker） ============
  // 用户改了日期
  // 关键：只改日期，不动时间；如果日期 + 时间 合起来在过去 → 拒绝并提示
  onTimeDateChange(e) {
    const newDate = e.detail.value;
    if (!newDate) return;
    const combinedTs = new Date(`${newDate} ${this.data.timeTime}:00`).getTime();
    if (Number.isFinite(combinedTs) && combinedTs <= Date.now()) {
      return wx.showToast({ title: '日期 + 时间已在过去，请调大', icon: 'none' });
    }
    this.setData({
      timeDate: newDate,
      timeInputDate: newDate
    });
    this._syncTimeFromParts();
  },

  // 用户改了时间
  // 关键：只改时间，不动日期；如果日期 + 时间 合起来在过去 → 拒绝并提示
  onTimeTimeChange(e) {
    const newTime = e.detail.value;
    if (!newTime) return;
    const combinedTs = new Date(`${this.data.timeDate} ${newTime}:00`).getTime();
    if (Number.isFinite(combinedTs) && combinedTs <= Date.now()) {
      return wx.showToast({ title: '日期 + 时间已在过去，请调大', icon: 'none' });
    }
    this.setData({
      timeTime: newTime,
      timeInputTime: newTime
    });
    this._syncTimeFromParts();
  },

  // ============ 时间选择：输入模式（日期 + 时间 两个独立输入框） ============
  onTimeInputPartChange(e) {
    const { part } = e.currentTarget.dataset;
    if (!part) return;
    let v = String(e.detail.value || '');
    if (part === 'date') {
      // 日期：只允许数字 + - /
      v = v.replace(/[^\d\-/]/g, '');
    } else if (part === 'time') {
      // 时间：智能自动打冒号
      // 关键 UX：用户连续输数字时，实时解析出一个合理的时间
      //   1 位 → "H"
      //   2 位 → "HH"
      //   3 位 → "H:MM"（首位小时，后两位分钟）
      //     若后两位 > 59（无效分钟）→ 回退用前两位作分钟（"183" → "1:18"）
      //   4 位 → "HH:MM"
      //   5 位 → "H:MM"（第 3 位小时，最后两位分钟；前两位忽略）
      //     若最后两位 > 59 → 回退用第 3、4 位作分钟（"16395" → "3:39"）
      v = this._autoFormatTimeInput(v);
    }
    if (part === 'date') this.setData({ timeInputDate: v, timeInputError: '' });
    else if (part === 'time') this.setData({ timeInputTime: v, timeInputError: '' });
  },

  // 智能格式化时间输入（核心算法）
  // 入参：原始字符串（含任意字符）
  // 出参：格式化后的 "H:MM" / "HH:MM" 字符串
  // 关键：
  //   - 任何非法字符（冒号、空格、字母）都会被剥掉
  //   - 最多取前 5 位数字
  //   - 时刻尽力解析出一个合法时间（hour < 24, minute < 60）
  //   - 当首选解析方案（用末位作分钟）导致分钟 > 59 时，自动回退到备用方案
  _autoFormatTimeInput(raw) {
    const digits = String(raw || '').replace(/[^\d]/g, '').slice(0, 5);
    const n = digits.length;
    if (n === 0) return '';
    if (n <= 2) return digits;
    if (n === 3) {
      // H:MM - 首位小时，后两位分钟
      const h = digits[0];
      const last2 = digits.slice(1);
      if (parseInt(last2, 10) < 60) {
        return `${h}:${last2}`;
      }
      // 回退：分钟用前两位（如 "183" → "1:18"）
      return `${h}:${digits.slice(0, 2)}`;
    }
    if (n === 4) {
      // HH:MM
      return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }
    // n === 5
    // H:MM - 第 3 位小时，最后两位分钟；前两位忽略
    const h = digits[2];
    const last2 = digits.slice(3);
    if (parseInt(last2, 10) < 60) {
      return `${h}:${last2}`;
    }
    // 回退：分钟用第 3、4 位（如 "16395" → "3:39"）
    return `${h}:${digits.slice(2, 4)}`;
  },

  // blur 某一格：只校验当前 part
  // 关键：日期 / 时间 完全独立——只恢复输错的**那一格**，其他格保持原样
  onTimeInputPartBlur(e) {
    const { part } = e.currentTarget.dataset;
    if (part === 'date') this._validateAndRestoreDate();
    else if (part === 'time') this._validateAndRestoreTime();
  },

  // 校验日期输入；失败时只恢复日期格，时间格保持原样
  _validateAndRestoreDate() {
    const raw = (this.data.timeInputDate || '').trim();
    if (!raw) {
      this._restoreTimePart('date');
      return;
    }
    // 接受 YYYY-MM-DD / YYYY/MM/DD
    const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!m) {
      this._restoreTimePart('date');
      return;
    }
    const y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) {
      this._restoreTimePart('date');
      return;
    }
    const d = new Date(y, mo - 1, da, 0, 0, 0, 0);
    // 关键：Date 会自动溢出（比如 2-30 → 3-2），要核对日是否被"吃"了
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
      this._restoreTimePart('date');
      return;
    }
    // 关键：日期本身合法就接受，不在这里检查"日期 + 时间合起来是否在过去"
    //       整体过去由 _syncTimeFromParts 统一提示，不破坏单格
    const norm = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    this.setData({
      timeInputDate: norm,
      timeDate: norm
    });
    this._syncTimeFromParts();
  },

  // 校验时间输入；失败时只恢复时间格，日期格保持原样
  _validateAndRestoreTime() {
    const raw = (this.data.timeInputTime || '').trim();
    if (!raw) {
      this._restoreTimePart('time');
      return;
    }
    // 接受 HH:mm
    const m = raw.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) {
      this._restoreTimePart('time');
      return;
    }
    const h = +m[1], mi = +m[2];
    if (h < 0 || h > 23 || mi < 0 || mi > 59) {
      this._restoreTimePart('time');
      return;
    }
    // 关键：时间本身合法就接受，不在这里检查"日期 + 时间合起来是否在过去"
    const norm = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    this.setData({
      timeInputTime: norm,
      timeTime: norm
    });
    this._syncTimeFromParts();
  },

  // 只恢复某一个 part 到默认值（不动其他 part）
  // 关键：恢复后必须调 _syncTimeFromParts 重新拼 formData.time
  _restoreTimePart(part) {
    const d = getDefaultDate();
    if (part === 'date') {
      const dateStr = formatDateOnly(d);
      this.setData({
        timeInputDate: dateStr,
        timeDate: dateStr
      });
      wx.showToast({ title: '日期已恢复默认', icon: 'none', duration: 1200 });
    } else if (part === 'time') {
      const timeStr = formatTimeOnly(d);
      this.setData({
        timeInputTime: timeStr,
        timeTime: timeStr
      });
      wx.showToast({ title: '时间已恢复默认', icon: 'none', duration: 1200 });
    }
    this._syncTimeFromParts();
  },

  // 同步 formData.time = "YYYY-MM-DD HH:mm" + 整体过去检查
  // 关键：日期格 / 时间格 是独立数据源，组合时再校验"合起来是否在过去"
  _syncTimeFromParts() {
    const date = this.data.timeDate;
    const time = this.data.timeTime;
    if (!date || !time) {
      this.setData({ 'formData.time': '', timeInputError: '' });
      return;
    }
    const timeStr = `${date} ${time}`;
    const ts = new Date(timeStr.replace(' ', 'T') + ':00').getTime();
    let overallErr = '';
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      overallErr = '日期 + 时间合起来在过去，请调大';
    }
    this.setData({
      'formData.time': timeStr,
      timeInputError: overallErr
    });
  },

  // 校验日期字符串是否合法（用于 onSwitchTimeMode 等场合）
  _isValidDateStr(s) {
    if (!s) return false;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
    const d = new Date(y, mo - 1, da);
    return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da;
  },

  // 校验时间字符串是否合法
  _isValidTimeStr(s) {
    if (!s) return false;
    const m = s.match(/^(\d{2}):(\d{2})$/);
    if (!m) return false;
    const h = +m[1], mi = +m[2];
    return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
  },

  // ============ 招募截止时间：弹层方式（date + time 同屏可调） ============
  onOpenDeadlinePicker() {
    let initDate = this._formatDate(new Date());
    let initTime = '12:00';
    if (this.data.formData.recruitDeadline) {
      const d = new Date(this.data.formData.recruitDeadline);
      if (Number.isFinite(d.getTime()) && d.getTime() > Date.now()) {
        initDate = this._formatDate(d);
        initTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    this.setData({
      deadlinePickerVisible: true,
      deadlineDate: initDate,
      deadlineTime: initTime
    });
  },

  onCloseDeadlinePicker() {
    this.setData({ deadlinePickerVisible: false });
  },

  onDeadlineDateChange(e) {
    this.setData({ deadlineDate: e.detail.value });
  },

  onDeadlineTimeChange(e) {
    this.setData({ deadlineTime: e.detail.value });
  },

  // 关键：点确认时做一次完整校验，避免写入过去时间
  onConfirmDeadline() {
    const { deadlineDate, deadlineTime } = this.data;
    if (!deadlineDate || !deadlineTime) {
      return wx.showToast({ title: '请选择日期和时间', icon: 'none' });
    }
    const ts = new Date(`${deadlineDate} ${deadlineTime}:00`).getTime();
    if (!Number.isFinite(ts)) {
      return wx.showToast({ title: '时间格式错误', icon: 'none' });
    }
    if (ts <= Date.now()) {
      return wx.showToast({ title: '截止时间必须在未来', icon: 'none' });
    }
    if (ts - Date.now() > 30 * 24 * 3600 * 1000) {
      return wx.showToast({ title: '不能超过 30 天', icon: 'none' });
    }
    this.setData({
      'formData.recruitDeadline': ts,
      'formData.recruitDeadlineText': `${deadlineDate} ${deadlineTime}`,
      deadlinePickerVisible: false
    });
  },

  onClearDeadline() {
    this.setData({
      'formData.recruitDeadline': 0,
      'formData.recruitDeadlineText': ''
    });
  },

  // 提醒开关
  onToggleRemind(e) {
    this.setData({ 'formData.remindEnabled': !!e.detail.value });
  },

  // 将 Date 格式化为 YYYY-MM-DD
  _formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // ============ 提交 ============
  async onSubmit() {
    if (this.data.submitting) return;

    const { formData } = this.data;

    console.log('[publish] 提交时表单数据:', JSON.stringify(formData, null, 2));

    // 1) 基础校验
    if (!formData.sport) {
      return wx.showToast({ title: '请选择运动项目', icon: 'none' });
    }
    if (!formData.time) {
      return wx.showToast({ title: '请选择约球时间', icon: 'none' });
    }
    // 关键：兜底再校验一次「不能在过去」
    const submitTs = new Date(formData.time.replace(' ', 'T') + ':00').getTime();
    if (!Number.isFinite(submitTs) || submitTs <= Date.now()) {
      return wx.showToast({ title: '约球时间必须晚于现在', icon: 'none' });
    }
    if (!formData.location || !formData.location.trim()) {
      return wx.showModal({
        title: '请填写地点',
        content: '当前 location 字段值：\n[' + (formData.location || '(空)') + ']\n\n请确保在"地点"输入框中输入了真实文字。',
        showCancel: false,
        confirmText: '去填写'
      });
    }
    if (formData.needCount < 1) {
      return wx.showToast({ title: '人数至少 1 人', icon: 'none' });
    }
    if (formData.recruitDeadline && formData.recruitDeadline <= Date.now()) {
      return wx.showToast({ title: '招募截止时间必须晚于现在', icon: 'none' });
    }

    // 2) 确保有 openid：未登录时先做静默登录
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) {
      return wx.showModal({
        title: '提示',
        content: '静默登录失败，请确认云函数 login 已部署后再试',
        showCancel: false
      });
    }

    // 3) 主动询问一次昵称头像（已存在则跳过，不阻塞）
    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    // 4) 提交云函数
    this.setData({ submitting: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: {
          type: 'add',
          payload: {
            sport: formData.sport,
            time: formData.time,
            location: formData.location.trim(),
            needCount: formData.needCount,
            scope: formData.scope,
            contact: formData.contact.trim(),
            remark: formData.remark.trim(),
            recruitDeadline: formData.recruitDeadline || 0,
            nickName: userInfo.nickName || '拾球记用户',
            avatarUrl: userInfo.avatarUrl || ''
          }
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });

        const postId = resp.result.data && resp.result.data._id;
        if (postId && formData.remindEnabled) {
          const { optInReminder } = require('../../utils/reminder.js');
          optInReminder({ postId: postId, recipientKind: 'creator' });
        }

        setTimeout(() => {
          wx.switchTab({ url: '/pages/ball/list' });
        }, 800);
      } else {
        wx.showModal({
          title: '发布失败',
          content: (resp.result && resp.result.errMsg) || '请稍后重试',
          showCancel: false
        });
      }
    } catch (err) {
      this.setData({ submitting: false });
      console.error('[ball publish] cloud call failed 真实错误:', err);
      const realErr = (err && (err.errMsg || err.message)) || JSON.stringify(err);
      wx.showModal({
        title: '发布失败 - 真实错误',
        content: realErr + '\n\n排查：\n1. cloudfunctions/ballAdd 是否上传？\n2. ball_posts 集合是否创建？\n3. env ID 是否正确？',
        showCancel: false
      });
    }
  }
});
