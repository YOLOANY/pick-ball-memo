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

    // ============ 时间选择：仿 iOS 闹钟（双列滚轮 + 点击输入合一） ============
    // 关键：去掉了「滚动 / 输入」tab 切换；同一个时间从「滚轮」和「键盘输入」两条路都能改
    // 关键：formData.time 始终 = "YYYY-MM-DD HH:mm"，与之前完全一致
    timeDate: '',                  // YYYY-MM-DD（日期行）
    timeDateStart: '',             // 今天
    timeDateEnd: '',               // 今天 + 730 天（约 2 年）
    // 顶部大字显示 + 滚轮位置
    displayHour: '00',             // 大字显示的小时（HH）
    displayMinute: '00',           // 大字显示的分钟（mm）
    // 滚轮数据源
    hourList: Array.from({ length: 24 }, (_, i) => ({
      v: i, l: String(i).padStart(2, '0')
    })),
    minuteList: Array.from({ length: 60 }, (_, i) => ({
      v: i, l: String(i).padStart(2, '0')
    })),
    // picker-view 的选中下标（与滚轮 / 输入框 / formData.time 完全一致，零误差）
    hourIndex: 0,
    minuteIndex: 0,
    // 键盘输入：两个小 input（小时 / 分钟），中间冒号永远是独立的 <text>
    editHour: '',                  // 小时 input 的值（1-2 位数字）
    editMinute: '',                // 分钟 input 的值（1-2 位数字）
    focusMinute: false,            // 输满 2 位小时后自动 focus 到分钟
    // 翻转动画：每次时间变化时，顶部大字 time-display 触发一次翻转动画
    flipping: false,
    // 错误提示
    timeError: '',                 // 整体校验错误（如"已在过去"）

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

  // 初始化时间选择器（仿 iOS 闹钟）
  // 关键：根据传入的 Date d 同时更新 formData.time / timeDate / displayHour / displayMinute
  //      滚轮位置 hourScrollTop = 160 + h * 80
  //      调用前应保证 d 在未来
  _initTimePicker(d) {
    const dateStr = formatDateOnly(d);
    const todayStr = formatDateOnly(new Date());
    // 关键：约球时间 picker 的可选终点设为「今天 + 2 年」
    // 之前的 30 天太短，提前规划的 2027 年滚不进去
    // （招募截止时间 deadline 那个 picker 仍然保持 30 天，不受影响）
    const dFar = new Date();
    dFar.setDate(dFar.getDate() + 730);
    const maxDateStr = formatDateOnly(dFar);

    const h = d.getHours();
    const mi = d.getMinutes();

    this.setData({
      'formData.time': formatDateTime(d),
      timeDateStart: todayStr,
      timeDateEnd: maxDateStr,
      timeDate: dateStr,
      displayHour: String(h).padStart(2, '0'),
      displayMinute: String(mi).padStart(2, '0'),
      hourIndex: h,
      minuteIndex: mi,
      editHour: String(h).padStart(2, '0'),
      editMinute: String(mi).padStart(2, '0'),
      flipping: false,
      timeError: ''
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

  // ============ 时间选择：仿 iOS 闹钟（日期 + 时间，分开两栏） ============
  // 关键：去掉了「滚动 / 输入」tab 切换；同一个时间从「滚轮」和「键盘输入」两条路都能改
  // 关键：日期 / 时间 是分开的两块；改其中一块不会影响另一块

  // 日期行 picker 变化（点击时间行的「日期」格触发）
  onTimeDateChange(e) {
    const newDate = e.detail.value;
    if (!newDate) return;
    this.setData({ timeDate: newDate });
    this._syncTimeToFormData();
  },

  // 顶部 time-display 内的 input 获得焦点：把对应的 editHour/editMinute 同步为当前显示值
  onDisplayFocus(e) {
    const { part } = e.currentTarget.dataset;
    if (part === 'hour') {
      this.setData({ editHour: this.data.displayHour });
    } else if (part === 'minute') {
      this.setData({ editMinute: this.data.displayMinute });
    }
  },

  // 顶部 input 实时输入：只允许数字，最多 2 位
  // 关键：冒号是独立的 <text>，永远不会消失
  onDisplayInput(e) {
    const { part } = e.currentTarget.dataset;
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 2);
    if (part === 'hour') {
      this.setData({ editHour: v });
      // 关键：输满 2 位时自动 focus 到分钟 input（用 focusMinute 标志）
      if (v.length === 2) {
        this.setData({ focusMinute: true });
        // 重置标志，避免下次 focus 时再次触发
        setTimeout(() => this.setData({ focusMinute: false }), 100);
      }
    } else if (part === 'minute') {
      this.setData({ editMinute: v });
    }
  },

  // 顶部 input 失焦：分别校验小时 / 分钟
  // 关键：单栏非法时只恢复那一栏，另一栏不动
  onDisplayBlur(e) {
    const { part } = e.currentTarget.dataset;
    if (part === 'hour') this._validateAndApplyHour();
    else if (part === 'minute') this._validateAndApplyMinute();
  },

  // 校验并应用小时 input
  _validateAndApplyHour() {
    const raw = (this.data.editHour || '').trim();
    if (!raw) {
      // 空：恢复成当前 displayHour
      this.setData({ editHour: this.data.displayHour });
      return;
    }
    const h = parseInt(raw, 10);
    if (!Number.isFinite(h) || h < 0 || h > 23) {
      this.setData({ editHour: this.data.displayHour });
      wx.showToast({ title: '小时应在 0-23', icon: 'none', duration: 1200 });
      return;
    }
    // 合法：更新 displayHour + hourIndex + editHour，触发翻转动画
    const hh = String(h).padStart(2, '0');
    this.setData({
      displayHour: hh,
      hourIndex: h,
      editHour: hh,
      flipping: true
    });
    this._syncTimeToFormData();
    setTimeout(() => this.setData({ flipping: false }), 400);
  },

  // 校验并应用分钟 input
  _validateAndApplyMinute() {
    const raw = (this.data.editMinute || '').trim();
    if (!raw) {
      this.setData({ editMinute: this.data.displayMinute });
      return;
    }
    const mi = parseInt(raw, 10);
    if (!Number.isFinite(mi) || mi < 0 || mi > 59) {
      this.setData({ editMinute: this.data.displayMinute });
      wx.showToast({ title: '分钟应在 0-59', icon: 'none', duration: 1200 });
      return;
    }
    const mmi = String(mi).padStart(2, '0');
    this.setData({
      displayMinute: mmi,
      minuteIndex: mi,
      editMinute: mmi,
      flipping: true
    });
    this._syncTimeToFormData();
    setTimeout(() => this.setData({ flipping: false }), 400);
  },

  // 内部：把 (h, mi) 写入 picker-view 下标 + 顶部显示 + 触发翻转动画
  // 关键：picker-view 用 value 数组 + 自带动画，零误差对齐
  // 关键：editValue 始终与 displayHour:displayMinute 保持一致（input 直接显示当前时间）
  _setTime(h, mi, animate) {
    const hh = String(h).padStart(2, '0');
    const mmi = String(mi).padStart(2, '0');
    const update = {
      displayHour: hh,
      displayMinute: mmi,
      hourIndex: h,
      minuteIndex: mi,
      editHour: hh,
      editMinute: mmi,
      timeError: ''
    };
    if (animate) update.flipping = true;
    this.setData(update);
    this._syncTimeToFormData();
    if (animate) {
      // 翻转动画持续 400ms，到时间后清掉 flipping class
      setTimeout(() => this.setData({ flipping: false }), 400);
    }
  },

  // 内部：恢复时间到默认（现在 + 3 小时）
  // 关键：用户输入非法时，整个时间（hour+minute）恢复到默认，不影响 date
  _restoreTime() {
    const d = getDefaultDate();
    // 注意：不要在调用 _setTime 之前 setData editValue，_setTime 会自己同步
    this._setTime(d.getHours(), d.getMinutes(), true);
    wx.showToast({ title: '已恢复默认时间', icon: 'none', duration: 1200 });
  },

  // picker-view 用户开始拖动：只记录，不立即翻转动画（避免拖动中持续闪）
  onPickerStart() {
    // no-op：留个钩子给未来扩展
  },

  // picker-view 滚动结束 / 选中变化（自带 snap + 中心对齐）
  // 关键：e.detail.value 是 [hourIndex, minuteIndex]，零误差
  onPickerViewChange(e) {
    const val = e.detail.value || [];
    const h = Math.max(0, Math.min(23, val[0] || 0));
    const mi = Math.max(0, Math.min(59, val[1] || 0));
    const hh = String(h).padStart(2, '0');
    const mmi = String(mi).padStart(2, '0');
    this.setData({
      hourIndex: h,
      minuteIndex: mi,
      displayHour: hh,
      displayMinute: mmi,
      editHour: hh,
      editMinute: mmi,
      flipping: true
    });
    this._syncTimeToFormData();
    setTimeout(() => this.setData({ flipping: false }), 400);
  },

  // 同步 formData.time = "YYYY-MM-DD HH:mm" + 整体过去检查
  // 关键：日期 / 小时 / 分钟 是三个独立数据源，组合时再校验"合起来是否在过去"
  _syncTimeToFormData() {
    const date = this.data.timeDate;
    const h = parseInt(this.data.displayHour, 10) || 0;
    const mi = parseInt(this.data.displayMinute, 10) || 0;
    if (!date) {
      this.setData({ 'formData.time': '', timeError: '' });
      return;
    }
    const timeStr = `${date} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    const ts = new Date(timeStr.replace(' ', 'T') + ':00').getTime();
    let overallErr = '';
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      overallErr = '日期 + 时间已在过去，请调大';
    }
    this.setData({
      'formData.time': timeStr,
      timeError: overallErr
    });
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
