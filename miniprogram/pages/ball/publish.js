// pages/ball/publish.js
// 约球帖子发布页逻辑
// 职责：
//   1. 维护表单数据 formData
//   2. 提供项目 / 时间 / 人数 / 招募范围等交互
//   3. 时间选择支持两种方式：滚动选择（multiSelector 5 列）/ 文本输入（YYYY-MM-DD HH:mm）
//   4. 默认时间 = 进入页面时「当前时间 + 3 小时」，向上取整到 5 分钟
//   5. 提交时进行基础校验，再调用 ballAdd 云函数写入云数据库 ball_posts 集合

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
    // 关键：默认 scroll（更直观），用户可一键切到 input 精确输入
    timeMode: 'scroll',
    // 滚动模式的 multiSelector 5 列：年 / 月 / 日 / 时 / 分（5 分钟粒度）
    timePickerColumns: [[], [], [], [], []],
    timePickerIndex: [0, 0, 0, 0, 0],
    // 输入模式的文本值
    timeInputValue: '',
    // 输入模式校验错误提示
    timeInputError: '',

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
    // 用途：用户进入页面就能直接看到一个合理的未来时间，省得每次都点选
    const defaultDate = getDefaultDate();
    this._initTimePicker(defaultDate);

    // 初始化截止时间 picker 的可选日期范围：今天 ~ 30 天后
    const today = this._formatDate(new Date());
    const d30 = new Date();
    d30.setDate(d30.getDate() + 30);
    const maxDate = this._formatDate(d30);
    // 关键：如果已有 recruitDeadline，用它做初始值；否则用"今天 + 1 天 12:00"
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

  // 初始化时间选择器（滚动模式的 5 列数据 + 输入框的初值）
  // 关键：根据传入的 Date d 同时更新 formData.time / timeInputValue / timePickerIndex
  //      调用前应保证 d 在未来
  _initTimePicker(d) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;  // 1-12
    const day = d.getDate();         // 1-31
    const hour = d.getHours();       // 0-23
    const minute = d.getMinutes();   // 0, 5, 10, ..., 55

    const years = [String(year), String(year + 1)];
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const days = Array.from(
      { length: getDaysInMonth(year, month) },
      (_, i) => String(i + 1).padStart(2, '0')
    );
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    // 分钟粒度：5 分钟一档，共 12 档（00, 05, 10, ..., 55）
    const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

    const timeStr = formatDateTime(d);

    this.setData({
      'formData.time': timeStr,
      timeInputValue: timeStr,
      timeInputError: '',
      timePickerColumns: [years, months, days, hours, minutes],
      timePickerIndex: [0, month - 1, day - 1, hour, Math.floor(minute / 5)]
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
  // 关键：切换时同步一下 formData.time → timeInputValue / picker index
  //      避免模式间出现值不一致
  onSwitchTimeMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.timeMode) return;
    if (mode === 'input') {
      // 进入输入模式：把当前 time 同步到 input
      this.setData({
        timeMode: 'input',
        timeInputValue: this.data.formData.time,
        timeInputError: ''
      });
    } else {
      // 进入滚动模式：根据当前 time 重建 picker 5 列
      const t = this.data.formData.time;
      let d = getDefaultDate();
      if (t) {
        const m = t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
        if (m) {
          d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
        }
      }
      this._initTimePicker(d);
      this.setData({ timeMode: 'scroll' });
    }
  },

  // ============ 时间选择：滚动模式（multiSelector 5 列） ============
  // 5 列：年 / 月 / 日 / 时 / 分（分是 5 分钟粒度）
  onTimePickerChange(e) {
    const [yi, mi, di, hi, mni] = e.detail.value;
    const cols = this.data.timePickerColumns;
    const y = cols[0][yi];
    const mo = cols[1][mi];
    const da = cols[2][di];
    const h = cols[3][hi];
    const mn = cols[4][mni];
    const timeStr = `${y}-${mo}-${da} ${h}:${mn}`;
    // 关键校验：不能选过去
    const ts = new Date(timeStr.replace(' ', 'T')).getTime();
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      return wx.showToast({ title: '时间必须晚于现在', icon: 'none' });
    }
    this.setData({
      'formData.time': timeStr,
      timeInputValue: timeStr,
      timeInputError: ''
    });
  },

  // 当用户切换了"年"或"月"列时，需要重建"日"列以匹配当月天数
  // 关键：2 月 28/29 天、4/6/9/11 月 30 天、其余 31 天，不重建会出 bug
  onTimePickerColumnChange(e) {
    const { column, value } = e.detail;
    const cols = this.data.timePickerColumns.map((c) => c.slice());
    const idx = this.data.timePickerIndex.slice();
    idx[column] = value;
    if (column === 0 || column === 1) {
      // 重新计算当月天数
      const year = parseInt(cols[0][idx[0]], 10);
      const month = parseInt(cols[1][idx[1]], 10);
      const dim = getDaysInMonth(year, month);
      const newDays = Array.from({ length: dim }, (_, i) => String(i + 1).padStart(2, '0'));
      cols[2] = newDays;
      // 关键：若原选中的"日"在新的月份里不存在（如 31 → 30 天的月），夹到月末
      if (idx[2] >= dim) idx[2] = dim - 1;
    }
    this.setData({ timePickerColumns: cols, timePickerIndex: idx });
  },

  // ============ 时间选择：输入模式 ============
  onTimeInputChange(e) {
    // 只同步输入框值，不立刻校验（避免每打一个字就弹错误）
    this.setData({ timeInputValue: e.detail.value, timeInputError: '' });
  },

  // 关键：blur 时做严格校验
  // 接受格式：YYYY-MM-DD HH:mm（也兼容 YYYY/MM/DD HH:mm）
  // 不通过时 → 自动恢复为「当前时间 + 3 小时」默认时间，并提示用户已恢复
  // 关键：所有错误分支都走 _restoreDefaultTime，确保 formData.time 永远有合法值
  onTimeInputBlur() {
    const raw = (this.data.timeInputValue || '').trim();
    if (!raw) {
      this._restoreDefaultTime('输入为空，已恢复默认时间');
      return;
    }
    const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
    if (!m) {
      this._restoreDefaultTime('格式不对，已恢复默认时间');
      return;
    }
    const y = +m[1], mo = +m[2], da = +m[3], h = +m[4], mi = +m[5];
    if (mo < 1 || mo > 12 || da < 1 || da > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) {
      this._restoreDefaultTime('时间数值不合法，已恢复默认时间');
      return;
    }
    const d = new Date(y, mo - 1, da, h, mi, 0, 0);
    // 关键：Date 会自动溢出（比如 2-30 → 3-2），要核对日是否被"吃"了
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
      this._restoreDefaultTime('日期不存在，已恢复默认时间');
      return;
    }
    if (d.getTime() <= Date.now()) {
      this._restoreDefaultTime('时间不能在过去，已恢复默认时间');
      return;
    }
    const norm = formatDateTime(d);
    this.setData({
      'formData.time': norm,
      timeInputValue: norm,
      timeInputError: ''
    });
  },

  // 关键：恢复默认时间（重新计算「现在 + 3 小时」）
  // 用途：用户输入了无效时间，blur 时自动回滚到一个永远合法的值
  // 同时同步刷新滚动模式的 5 列数据，切换模式时不会看到陈旧索引
  _restoreDefaultTime(tipMsg) {
    const d = getDefaultDate();
    // 用 _initTimePicker 同时刷新 formData.time / timeInputValue / picker 5 列
    this._initTimePicker(d);
    // _initTimePicker 已经写了 formData.time 和 timeInputValue，
    // 这里再补一条轻提示，让用户知道发生了什么
    if (tipMsg) {
      wx.showToast({
        title: tipMsg,
        icon: 'none',
        duration: 1800
      });
    }
  },

  // ============ 招募截止时间：弹层方式（date + time 同屏可调） ============
  onOpenDeadlinePicker() {
    // 关键：每次打开都用 formData 里已存在的值回填
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
    // 30 天限制与后端保持一致
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

    // 调试：打印真实表单数据
    console.log('[publish] 提交时表单数据:', JSON.stringify(formData, null, 2));

    // 1) 基础校验
    if (!formData.sport) {
      return wx.showToast({ title: '请选择运动项目', icon: 'none' });
    }
    if (!formData.time) {
      return wx.showToast({ title: '请选择约球时间', icon: 'none' });
    }
    // 关键：兜底再校验一次「不能在过去」——滚动模式/输入模式都有过这道校验，
    //      但用户可能从「输入模式」切走时残留了无效字符串，再卡一次防止脏数据进库
    const submitTs = new Date(formData.time.replace(' ', 'T')).getTime();
    if (!Number.isFinite(submitTs) || submitTs <= Date.now()) {
      return wx.showToast({ title: '约球时间必须晚于现在', icon: 'none' });
    }
    if (!formData.location || !formData.location.trim()) {
      // 把实际值也提示出来，方便排查
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
    //    失败也不影响发布，云函数会用默认昵称
    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    // 4) 提交云函数
    this.setData({ submitting: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        // 约定云函数入参：type=add, payload=帖子内容
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
            // 招募截止时间戳（毫秒）；0 = 不自动截止
            recruitDeadline: formData.recruitDeadline || 0,
            // 冗余存储昵称头像，方便列表展示免 join
            nickName: userInfo.nickName || '拾球记用户',
            avatarUrl: userInfo.avatarUrl || ''
          }
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });

        // 如果用户勾选了「提前 2 小时提醒」→ 弹订阅授权并写记录
        // 关键：optInReminder 内部会调 wx.requestSubscribeMessage
        //       仍处于「发布」按钮 tap 触发的 async 链上（无 setTimeout 间隔），合规
        const postId = resp.result.data && resp.result.data._id;
        if (postId && formData.remindEnabled) {
          // 懒加载：避免冷启动一次性 require 全部 utils
          const { optInReminder } = require('../../utils/reminder.js');
          optInReminder({ postId: postId, recipientKind: 'creator' });
        }

        // 关键：ball/list 是 tabBar 页面，redirectTo 会失败，必须用 switchTab
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
